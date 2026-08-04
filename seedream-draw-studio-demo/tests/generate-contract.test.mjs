import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_IMAGE_MIME_TYPES,
  DEFAULT_ARK_MODEL,
  MAX_ANNOTATIONS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_OUTPUT_PIXELS,
  MIN_OUTPUT_PIXELS,
  buildArkRequest,
  mapArkHttpStatus,
  parseArkResponse,
  parseClientRequest,
  redactArkRequest,
  redactArkResponse,
} from "../lib/seedream-5-pro.ts";

const HTTPS_IMAGE = "https://images.example.com/source.png?signature=input-secret";

function markRequest(overrides = {}) {
  return {
    prompt: "  把天空改成日落  ",
    images: [HTTPS_IMAGE],
    edit: { mode: "mark" },
    size: { mode: "resolution", value: "1K", ratio: "1:1" },
    outputFormat: "png",
    watermark: false,
    optimizeMode: "standard",
    ...overrides,
  };
}

function coordinateRequest(overrides = {}) {
  return markRequest({
    prompt: "替换框内物体",
    images: ["data:image/png;base64,AA=="],
    edit: {
      mode: "coordinate",
      annotations: [
        { type: "point", x: 0, y: 999 },
        { type: "bbox", x1: 0, y1: 0, x2: 999, y2: 999 },
      ],
    },
    size: { mode: "resolution", value: "2K", ratio: "16:9" },
    outputFormat: "jpeg",
    watermark: true,
    optimizeMode: "standard",
    ...overrides,
  });
}

function expectValid(input) {
  const result = parseClientRequest(input);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.value;
}

function expectInvalid(input, pattern) {
  const result = parseClientRequest(input);
  assert.equal(result.ok, false, "request unexpectedly passed validation");
  assert.match(result.error, pattern);
}

test("accepts canonical mark and coordinate requests without coercion", () => {
  const mark = expectValid(markRequest());
  assert.equal(mark.prompt, "把天空改成日落");
  assert.deepEqual(mark.edit, { mode: "mark" });
  assert.deepEqual(mark.size, { mode: "resolution", value: "1K", ratio: "1:1" });

  const coordinate = expectValid(coordinateRequest({ debug: true }));
  assert.deepEqual(coordinate.edit, coordinateRequest().edit);
  assert.equal(coordinate.size.value, "2K");
  assert.equal(coordinate.outputFormat, "jpeg");
  assert.equal(coordinate.watermark, true);
  assert.equal(coordinate.optimizeMode, "standard");
  assert.equal(coordinate.debug, true);
});

test("rejects blank, unknown and legacy advanced inputs instead of defaulting them", () => {
  expectInvalid(markRequest({ prompt: " \n\t " }), /prompt/);
  expectInvalid(markRequest({ prompt: 42 }), /prompt/);
  expectInvalid(markRequest({ unknown: true }), /未知字段/);
  expectInvalid(markRequest({ advanced: null }), /未知字段/);
  expectInvalid(markRequest({ advanced: { outputFormat: "png", watermark: false } }), /未知字段/);
  expectInvalid(null, /JSON 对象/);
  expectInvalid([], /JSON 对象/);
  expectInvalid(markRequest({ edit: { mode: "mark", annotations: [] } }), /未知字段/);
  expectInvalid(markRequest({ outputFormat: "jpg" }), /outputFormat/);
  expectInvalid(markRequest({ watermark: 0 }), /watermark/);
  expectInvalid(markRequest({ optimizeMode: "fast" }), /仅支持 standard/);
  expectInvalid(markRequest({ optimizeMode: "slow" }), /仅支持 standard/);
  expectInvalid(markRequest({ debug: "true" }), /debug/);
});

test("enforces image count and the exact supported MIME allowlist", () => {
  assert.equal(MAX_IMAGES, 10);
  expectInvalid(markRequest({ images: [] }), /1 至 10/);
  expectValid(markRequest({ images: Array.from({ length: MAX_IMAGES }, (_, index) => `https://example.com/${index}.png`) }));
  expectInvalid(markRequest({ images: Array.from({ length: MAX_IMAGES + 1 }, (_, index) => `https://example.com/${index}.png`) }), /1 至 10/);

  assert.deepEqual(ALLOWED_IMAGE_MIME_TYPES, [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "image/gif",
    "image/heic",
    "image/heif",
  ]);
  for (const mime of ALLOWED_IMAGE_MIME_TYPES) {
    expectValid(markRequest({ images: [`data:${mime};base64,AA==`] }));
  }
  for (const image of [
    "http://example.com/input.png",
    "ftp://example.com/input.png",
    "data:image/jpg;base64,AA==",
    "data:IMAGE/PNG;base64,AA==",
    "data:image/png;BASE64,AA==",
    "data:image/png;charset=utf-8;base64,AA==",
    "data:image/png,AA==",
  ]) {
    expectInvalid(markRequest({ images: [image] }), /images\[0\]/);
  }
});

test("accepts only the signed-result route shape as an internal image reference", () => {
  assert.equal(parseClientRequest(markRequest({ images: ["/api/result-image?token=payload.signature"] })).ok, true);
  for (const image of [
    "/api/result-image",
    "/api/result-image?token=",
    "/api/result-image?token=a&extra=b",
    "/api/other?token=a",
  ]) {
    expectInvalid(markRequest({ images: [image] }), /有效的 HTTPS URL/);
  }
});

test("validates base64 and measures the decoded 30MB boundary inclusively", () => {
  for (const encoded of ["", "A", "AA=A", "AA===", "AA*="]) {
    expectInvalid(markRequest({ images: [`data:image/png;base64,${encoded}`] }), /base64|data URL/);
  }

  assert.equal(MAX_IMAGE_BYTES, 30 * 1024 * 1024);
  const exactlyThirtyMb = "A".repeat((MAX_IMAGE_BYTES / 3) * 4);
  expectValid(markRequest({ images: [`data:image/png;base64,${exactlyThirtyMb}`] }));
  expectInvalid(markRequest({ images: [`data:image/png;base64,${exactlyThirtyMb}AA==`] }), /30MB/);
});

test("accepts only 1K/2K resolution mode with a bounded integer ratio", () => {
  for (const value of ["1K", "2K"]) {
    for (const ratio of ["1:16", "1:1", "16:1", "21:9"]) {
      expectValid(markRequest({ size: { mode: "resolution", value, ratio } }));
    }
  }
  for (const size of [
    { mode: "resolution", value: "4K", ratio: "1:1" },
    { mode: "resolution", value: "1k", ratio: "1:1" },
    { mode: "resolution", value: "1K", ratio: "0:1" },
    { mode: "resolution", value: "1K", ratio: "1:17" },
    { mode: "resolution", value: "1K", ratio: "17:1" },
    { mode: "resolution", value: "1K", ratio: "1.5:1" },
    { mode: "resolution", value: "1K", ratio: "1:1", width: 1024 },
  ]) {
    expectInvalid(markRequest({ size }), /size|ratio|1K|2K/);
  }
});

test("enforces explicit integer pixel boundaries without rounding or string coercion", () => {
  assert.equal(MIN_OUTPUT_PIXELS, 921_600);
  assert.equal(MAX_OUTPUT_PIXELS, 4_624_220);
  for (const [width, height] of [
    [1280, 720],
    [1634, 2830],
    [3840, 240],
    [240, 3840],
  ]) {
    expectValid(markRequest({ size: { mode: "pixels", width, height } }));
  }
  for (const [width, height] of [
    [1279, 720],
    [1634, 2831],
    [3841, 240],
    [240, 3841],
    [1024.5, 1024],
    ["1280", 720],
    [true, 921600],
  ]) {
    expectInvalid(markRequest({ size: { mode: "pixels", width, height } }), /size|width|height|像素|宽高比/);
  }
});

test("coordinates accept 0 and 999 but reject 1000, fractions and inverted boxes", () => {
  const annotations = [{ type: "point", x: 0, y: 999 }];
  expectValid(coordinateRequest({ edit: { mode: "coordinate", annotations } }));
  expectValid(coordinateRequest({ edit: { mode: "coordinate", annotations: Array.from({ length: MAX_ANNOTATIONS }, () => annotations[0]) } }));

  for (const annotation of [
    { type: "point", x: -1, y: 0 },
    { type: "point", x: 1000, y: 0 },
    { type: "point", x: 0.5, y: 0 },
    { type: "point", x: "0", y: 0 },
    { type: "bbox", x1: 500, y1: 0, x2: 499, y2: 999 },
    { type: "bbox", x1: 0, y1: 500, x2: 999, y2: 500 },
    { type: "bbox", x1: 0, y1: 0, x2: 1000, y2: 999 },
    { type: "circle", x: 0, y: 0 },
  ]) {
    expectInvalid(coordinateRequest({ edit: { mode: "coordinate", annotations: [annotation] } }), /annotations|坐标|bbox/);
  }
  expectInvalid(coordinateRequest({ edit: { mode: "coordinate", annotations: [] } }), /1 至 20/);
  expectInvalid(coordinateRequest({ edit: { mode: "coordinate", annotations: Array.from({ length: MAX_ANNOTATIONS + 1 }, () => annotations[0]) } }), /1 至 20/);
});

test("Ark payload snapshot contains only the Seedream 5.0 Pro allowlist", () => {
  const request = buildArkRequest(expectValid(coordinateRequest()), "model-under-test");
  assert.deepEqual(request, {
    model: "model-under-test",
    prompt: "请根据图1完成精准图片编辑。交互坐标定位（相对于图1，坐标范围0至999）：图1<point>0 999</point>；图1<bbox>0 0 999 999</bbox>。请严格以这些坐标定位编辑目标。用户要求：替换框内物体。输出图片比例为 16:9。仅修改坐标所指区域；保持构图、人物身份和未指定区域与原图一致，使结果自然融合。",
    image: ["data:image/png;base64,AA=="],
    size: "2K",
    optimize_prompt_options: { mode: "standard" },
    output_format: "jpeg",
    response_format: "url",
    watermark: true,
  });
  assert.deepEqual(Object.keys(request).sort(), [
    "image",
    "model",
    "optimize_prompt_options",
    "output_format",
    "prompt",
    "response_format",
    "size",
    "watermark",
  ]);
  assert.equal(request.stream, undefined);
  assert.equal(request.sequential_image_generation, undefined);
  assert.equal(request.tools, undefined);

  const explicit = buildArkRequest(expectValid(markRequest({ size: { mode: "pixels", width: 1280, height: 720 } })));
  assert.equal(explicit.model, DEFAULT_ARK_MODEL);
  assert.equal(explicit.size, "1280x720");
  assert.deepEqual(explicit.optimize_prompt_options, { mode: "standard" });
});

test("parses URL results, top-level errors, item errors and invalid/non-JSON shapes", () => {
  const usage = { generated_images: 1, output_tokens: 2048, total_tokens: 2048 };
  assert.deepEqual(parseArkResponse({
    model: DEFAULT_ARK_MODEL,
    created: 1_789_000_000,
    data: [{ url: "https://result.example.com/image.png?X-Signature=secret", size: "2K", output_format: "png" }],
    usage,
  }), {
    ok: true,
    value: {
      url: "https://result.example.com/image.png?X-Signature=secret",
      size: "2K",
      outputFormat: "png",
      model: DEFAULT_ARK_MODEL,
      created: 1_789_000_000,
      usage,
    },
  });
  assert.deepEqual(parseArkResponse({ error: { code: "SensitiveContent", message: "blocked" } }), {
    ok: false,
    error: "blocked",
    code: "SensitiveContent",
  });
  assert.deepEqual(parseArkResponse({ data: [{ error: { code: "ItemError", message: "item failed" } }] }), {
    ok: false,
    error: "item failed",
    code: "ItemError",
  });
  const sensitiveError = parseArkResponse({
    error: {
      code: "BadRequest",
      message: "bad https://input.example.com/a.png?signature=LEAK Bearer ark-LEAK token=LEAK API Key: spaced-LEAK access_token=access-LEAK",
    },
  });
  assert.equal(sensitiveError.ok, false);
  assert.doesNotMatch(JSON.stringify(sensitiveError), /signature=LEAK|ark-LEAK|token=LEAK|spaced-LEAK|access-LEAK/);
  assert.match(sensitiveError.error, /query-redacted|secret-redacted/);
  for (const payload of [
    "not JSON",
    null,
    {},
    { data: [] },
    { data: [{ url: "http://result.example.com/image.png" }] },
    { data: [{ b64_json: "AAAA" }] },
  ]) {
    assert.equal(parseArkResponse(payload).ok, false);
  }
});

test("maps provider statuses to the public API specification", () => {
  assert.equal(mapArkHttpStatus(400), 400);
  assert.equal(mapArkHttpStatus(404), 404);
  assert.equal(mapArkHttpStatus(401), 503);
  assert.equal(mapArkHttpStatus(403), 503);
  assert.equal(mapArkHttpStatus(429), 429);
  assert.equal(mapArkHttpStatus(500), 502);
  assert.equal(mapArkHttpStatus(599), 502);
  assert.equal(mapArkHttpStatus(200), 502);
  assert.equal(mapArkHttpStatus(600), 502);
});

test("debug redaction removes image bytes, signed queries, base64 and nested secrets", () => {
  const arkRequest = buildArkRequest(expectValid(coordinateRequest()));
  const redactedRequest = redactArkRequest({
    ...arkRequest,
    image: ["data:image/png;base64,TOP_SECRET_BYTES", HTTPS_IMAGE],
  });
  const requestText = JSON.stringify(redactedRequest);
  assert.doesNotMatch(requestText, /TOP_SECRET_BYTES|input-secret/);
  assert.match(requestText, /image 1/);
  assert.match(requestText, /images\.example\.com\/source\.png/);

  const redactedResponse = redactArkResponse({
    data: [{
      url: "https://result.example.com/image.png?X-Signature=output-secret",
      b64_json: "OUTPUT_BASE64_SECRET",
      nested: { data: "data:image/png;base64,NESTED_SECRET" },
    }],
    Authorization: "Bearer ark-secret",
    api_key: "ark-secret-2",
    "API Key": "ark-secret-3",
    "x-api-key": "ark-secret-4",
    access_token: "ark-secret-5",
    message: "failed for https://input.example.com/a.png?signature=message-secret Bearer message-token",
  });
  const responseText = JSON.stringify(redactedResponse);
  assert.doesNotMatch(responseText, /output-secret|OUTPUT_BASE64_SECRET|NESTED_SECRET|ark-secret|message-secret|message-token/);
  assert.match(responseText, /query-redacted/);
  assert.match(responseText, /base64-redacted/);
  assert.match(responseText, /secret-redacted/);
});
