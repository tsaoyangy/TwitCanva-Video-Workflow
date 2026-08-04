import assert from "node:assert/strict";
import test from "node:test";

import { ARK_PROVIDER_PROFILES } from "../lib/ark-provider.ts";
import { createResultImageToken } from "../lib/result-image-token.ts";

const FAKE_API_KEY = "test-only-key-never-send";
const FAKE_MODEL = "test-only-model";
const SIGNING_SECRET = "test-only-independent-result-signing-secret";

function validBody(overrides = {}) {
  return {
    prompt: "把天空改成日落",
    images: ["https://input.example.com/source.png?signature=input-secret"],
    edit: { mode: "mark" },
    size: { mode: "resolution", value: "1K", ratio: "1:1" },
    outputFormat: "png",
    watermark: false,
    optimizeMode: "standard",
    ...overrides,
  };
}

let workerPromise;
async function loadWorker() {
  workerPromise ??= import(new URL("../dist/server/index.js", import.meta.url).href);
  return (await workerPromise).default;
}

async function invokeRoute({
  body = validBody(),
  upstream = () => Response.json({ data: [{ url: "https://result.example.com/image.png" }] }),
  arkTimeout = "1000",
  apiKey = FAKE_API_KEY,
  provider = "volcengine",
  model = FAKE_MODEL,
  signingSecret = SIGNING_SECRET,
  requestUrl = "http://localhost/api/generate",
  requestHeaders = {},
} = {}) {
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const previousEnv = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_PROVIDER: process.env.ARK_PROVIDER,
    ARK_MODEL_ID: process.env.ARK_MODEL_ID,
    ARK_TIMEOUT_MS: process.env.ARK_TIMEOUT_MS,
    RESULT_IMAGE_SIGNING_SECRET: process.env.RESULT_IMAGE_SIGNING_SECRET,
  };
  const calls = [];
  const errorLogs = [];
  if (apiKey === null) delete process.env.ARK_API_KEY;
  else process.env.ARK_API_KEY = apiKey;
  if (provider === null) delete process.env.ARK_PROVIDER;
  else process.env.ARK_PROVIDER = provider;
  if (model === null) delete process.env.ARK_MODEL_ID;
  else process.env.ARK_MODEL_ID = model;
  if (signingSecret === null) delete process.env.RESULT_IMAGE_SIGNING_SECRET;
  else process.env.RESULT_IMAGE_SIGNING_SECRET = signingSecret;
  process.env.ARK_TIMEOUT_MS = arkTimeout;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, ARK_PROVIDER_PROFILES[provider].generationsUrl, "route attempted an unexpected outbound request");
    calls.push({ url, init });
    return upstream({ url, init });
  };
  console.error = (...args) => errorLogs.push(args);

  try {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestHeaders },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    const text = await response.text();
    return { response, text, json: JSON.parse(text), calls, errorLogs };
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("normal route returns the structured result without creating any audit trace", async () => {
  const usage = { generated_images: 1, output_tokens: 1024, total_tokens: 1024 };
  const { response, json, text, calls } = await invokeRoute({
    body: validBody({ debug: true }),
    upstream: () => Response.json({
      model: FAKE_MODEL,
      created: 1_789_000_000,
      data: [{
        url: "https://result.example.com/image.png?signature=output-secret",
        size: "1K",
        output_format: "png",
      }],
      usage,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_API_KEY}`);
  const arkBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(arkBody).sort(), [
    "image",
    "model",
    "optimize_prompt_options",
    "output_format",
    "prompt",
    "response_format",
    "size",
    "watermark",
  ]);
  assert.equal(arkBody.model, FAKE_MODEL);
  assert.equal(arkBody.stream, undefined);
  assert.equal(arkBody.sequential_image_generation, undefined);
  assert.equal(arkBody.tools, undefined);
  assert.equal(arkBody.response_format, "url");
  assert.deepEqual(json.result, {
    url: json.result.url,
    format: "png",
    expiresAt: json.result.expiresAt,
    size: "1K",
    model: FAKE_MODEL,
    created: 1_789_000_000,
    usage,
  });
  assert.match(json.result.url, /^\/api\/result-image\?token=/);
  assert.equal(Number.isInteger(json.result.expiresAt), true);
  assert.equal(json.image, undefined);
  assert.equal(json.audit, undefined);
  assert.equal(json.debug, undefined);
  assert.doesNotMatch(text, new RegExp(FAKE_API_KEY));
});

test("route selects the exact endpoint and default model for both providers", async () => {
  for (const provider of ["volcengine", "byteplus"]) {
    const profile = ARK_PROVIDER_PROFILES[provider];
    const { response, calls } = await invokeRoute({ provider, model: null });
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, profile.generationsUrl);
    assert.equal(JSON.parse(calls[0].init.body).model, profile.defaultModel);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_API_KEY}`);
  }
});

test("localhost ?debug=1 returns a complete memory-only audit without Authorization", async () => {
  const upstreamBody = {
    model: FAKE_MODEL,
    created: 1_789_000_000,
    data: [{
      url: "https://result.example.com/image.png?signature=output-secret",
      size: "1024x1024",
      output_format: "png",
    }],
    usage: { generated_images: 1 },
    provider_debug: FAKE_API_KEY,
  };
  const { json, text, calls } = await invokeRoute({
    body: validBody({ debug: true }),
    requestUrl: "http://localhost/api/generate?debug=1",
    upstream: () => Response.json(upstreamBody, { headers: { "x-request-id": "ark-request-123" } }),
  });

  assert.equal(calls.length, 1);
  assert.equal(json.audit.traceVersion, 2);
  assert.match(json.audit.traceId, /^[0-9a-f-]{36}$/i);
  assert.equal(json.audit.retention, "memory-only");
  assert.deepEqual(json.audit.provider, {
    id: "volcengine",
    displayName: "火山方舟",
    endpoint: ARK_PROVIDER_PROFILES.volcengine.generationsUrl,
    model: FAKE_MODEL,
  });
  assert.equal(json.audit.security.authorizationCaptured, false);
  assert.equal(json.audit.clientRequest.method, "POST");
  assert.equal(json.audit.clientRequest.body, undefined, "the page injects its existing client object to avoid a duplicate large response body");
  assert.match(json.audit.clientRequest.rawBodySha256, /^[0-9a-f]{64}$/);
  assert.equal(json.audit.arkRequest.headers.authorization, "[present-but-never-captured]");
  assert.equal(json.audit.arkRequest.body.image[0], "https://input.example.com/source.png?signature=input-secret");
  assert.equal(json.audit.arkRequest.body.response_format, "url");
  assert.match(json.audit.arkRequest.rawBodySha256, /^[0-9a-f]{64}$/);
  assert.equal(json.audit.arkResponse.status, 200);
  assert.equal(json.audit.arkResponse.headers["x-request-id"], "ark-request-123");
  assert.match(json.audit.arkResponse.rawBody, /output-secret/);
  assert.doesNotMatch(json.audit.arkResponse.rawBody, new RegExp(FAKE_API_KEY));
  assert.equal(json.audit.arkResponse.parsedBody.provider_debug, "[api-key-never-captured]");
  assert.deepEqual(json.audit.arkResponse.redactions, ["api-key"]);
  assert.equal(json.audit.appResponse.status, 200);
  assert.equal(json.audit.appResponse.body.result.url, json.result.url);
  assert.equal(json.audit.appResponse.auditEnvelopeIncluded, true);
  assert.match(text, /input-secret|output-secret/);
  assert.doesNotMatch(text, new RegExp(FAKE_API_KEY));
});

test("route rejects missing/blank API keys and oversized declared bodies before Ark", async () => {
  for (const apiKey of [null, "   "]) {
    const { response, calls } = await invokeRoute({ apiKey });
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  }

  const oversized = await invokeRoute({ requestHeaders: { "Content-Length": String(48 * 1024 * 1024 + 1) } });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.calls.length, 0);
});

test("route rejects invalid provider and signing configuration before Ark", async () => {
  for (const options of [
    { provider: null },
    { provider: "global" },
    { signingSecret: null },
    { signingSecret: FAKE_API_KEY },
  ]) {
    const { response, calls } = await invokeRoute(options);
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  }
});

test("route unwraps a valid signed result reference before sending a follow-up edit to Ark", async () => {
  const source = "https://result.example.com/follow-up.png?signature=secret";
  const { token } = await createResultImageToken(source, SIGNING_SECRET);
  const { response, calls } = await invokeRoute({
    body: validBody({ images: [`/api/result-image?token=${encodeURIComponent(token)}`] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(calls[0].init.body).image, [source]);

  const expired = await invokeRoute({ body: validBody({ images: ["/api/result-image?token=invalid"] }) });
  assert.equal(expired.response.status, 410);
  assert.equal(expired.calls.length, 0);
});

test("audit requires localhost, the exact ?debug=1 query and the body flag together", async () => {
  for (const [requestUrl, body] of [
    ["http://localhost/api/generate", validBody({ debug: true })],
    ["http://localhost/api/generate?debug=true", validBody({ debug: true })],
    ["http://localhost/api/generate?debug=1", validBody({ debug: false })],
    ["https://editor.example.com/api/generate?debug=1", validBody({ debug: true })],
  ]) {
    const { json } = await invokeRoute({ body, requestUrl });
    assert.equal(json.audit, undefined, requestUrl);
    assert.equal(json.debug, undefined, requestUrl);
  }
});

test("route rejects malformed or legacy client JSON before any Ark call", async () => {
  for (const body of [
    "{not-json",
    validBody({ prompt: "  " }),
    validBody({ unknown: true }),
    validBody({ advanced: null }),
  ]) {
    const { response, calls } = await invokeRoute({ body });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  }
});

test("route converts non-JSON, top-level and item provider failures without leaking raw bodies", async () => {
  const nonJson = await invokeRoute({
    upstream: () => new Response("<html>proxy secret</html>", { status: 200 }),
  });
  assert.equal(nonJson.response.status, 502);
  assert.doesNotMatch(nonJson.text, /proxy secret/);

  const topError = await invokeRoute({
    upstream: () => Response.json({ error: { code: "BadRequest", message: "safe provider message" } }, { status: 400 }),
  });
  assert.equal(topError.response.status, 400);
  assert.equal(topError.json.error, "safe provider message");

  const redactedTopError = await invokeRoute({
    upstream: () => Response.json({
      error: {
        code: "BadRequest",
        message: "bad https://input.example.com/a.png?signature=route-secret Bearer route-token",
      },
    }, { status: 400 }),
  });
  assert.equal(redactedTopError.response.status, 400);
  assert.doesNotMatch(redactedTopError.text, /route-secret|route-token/);

  const itemError = await invokeRoute({
    upstream: () => Response.json({ data: [{ error: { code: "ItemError", message: "item failed" } }] }),
  });
  assert.equal(itemError.response.status, 502);
  assert.equal(itemError.json.error, "item failed");
});

test("audit mode preserves a non-JSON Ark body for manual inspection while the public error stays safe", async () => {
  const { response, json } = await invokeRoute({
    body: validBody({ debug: true }),
    requestUrl: "http://127.0.0.1/api/generate?debug=1",
    upstream: () => new Response("<html>raw proxy diagnostic</html>", { status: 200 }),
  });
  assert.equal(response.status, 502);
  assert.doesNotMatch(json.error, /raw proxy diagnostic/);
  assert.equal(json.audit.arkResponse.rawBody, "<html>raw proxy diagnostic</html>");
  assert.equal(json.audit.arkResponse.parsedBody, null);
});

test("route maps authentication, rate-limit and provider statuses with safe messages", async () => {
  for (const [providerStatus, expectedStatus] of [
    [401, 503],
    [403, 503],
    [429, 429],
    [500, 502],
    [599, 502],
  ]) {
    const { response, json } = await invokeRoute({
      upstream: () => Response.json(
        { error: { code: "ProviderFailure", message: `provider-${providerStatus}` } },
        { status: providerStatus, headers: providerStatus === 429 ? { "Retry-After": "7" } : {} },
      ),
    });
    assert.equal(response.status, expectedStatus);
    if (providerStatus === 429) assert.equal(response.headers.get("retry-after"), "7");
    if (providerStatus === 401 || providerStatus === 403 || providerStatus >= 500) {
      assert.doesNotMatch(json.error, new RegExp(`provider-${providerStatus}`));
    }
  }
});

test("route maps network rejection and an aborted Ark mock to 502/504", async () => {
  const network = await invokeRoute({
    upstream: () => Promise.reject(new TypeError("socket included a secret")),
  });
  assert.equal(network.response.status, 502);
  assert.doesNotMatch(network.text, /socket included a secret/);
  assert.doesNotMatch(JSON.stringify(network.errorLogs), /socket included a secret/);

  const timeout = await invokeRoute({
    arkTimeout: "1000",
    upstream: ({ init }) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  assert.equal(timeout.response.status, 504);
  assert.match(timeout.json.error, /超时/);
});
