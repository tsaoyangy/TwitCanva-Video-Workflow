import assert from "node:assert/strict";
import test from "node:test";

import { createResultImageToken } from "../lib/result-image-token.ts";

const SIGNING_SECRET = "test-result-proxy-signing-secret";
const SOURCE_URL = "https://result.example.com/large-image.png?signature=secret";

let workerPromise;
async function loadWorker() {
  workerPromise ??= import(new URL("../dist/server/index.js", import.meta.url).href);
  return (await workerPromise).default;
}

test("result image route verifies the token and streams an image without caching", async () => {
  const previousFetch = globalThis.fetch;
  const previousSigningSecret = process.env.RESULT_IMAGE_SIGNING_SECRET;
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  let fetched = 0;
  process.env.RESULT_IMAGE_SIGNING_SECRET = SIGNING_SECRET;
  globalThis.fetch = async input => {
    assert.equal(String(input), SOURCE_URL);
    fetched += 1;
    return new Response(new Blob(chunks), {
      headers: { "Content-Type": "image/png", "Content-Length": "4" },
    });
  };

  try {
    const worker = await loadWorker();
    const { token } = await createResultImageToken(SOURCE_URL, SIGNING_SECRET);
    const response = await worker.fetch(
      new Request(`http://localhost/api/result-image?token=${encodeURIComponent(token)}`),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-length"), "4");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    assert.equal(fetched, 1);

    const rejected = await worker.fetch(
      new Request("http://localhost/api/result-image?token=invalid"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(rejected.status, 410);
    assert.equal(fetched, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSigningSecret === undefined) delete process.env.RESULT_IMAGE_SIGNING_SECRET;
    else process.env.RESULT_IMAGE_SIGNING_SECRET = previousSigningSecret;
  }
});

test("result image route fails closed when the independent signing secret is missing", async () => {
  const previousSigningSecret = process.env.RESULT_IMAGE_SIGNING_SECRET;
  delete process.env.RESULT_IMAGE_SIGNING_SECRET;
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("http://localhost/api/result-image?token=invalid"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 503);
  } finally {
    if (previousSigningSecret === undefined) delete process.env.RESULT_IMAGE_SIGNING_SECRET;
    else process.env.RESULT_IMAGE_SIGNING_SECRET = previousSigningSecret;
  }
});
