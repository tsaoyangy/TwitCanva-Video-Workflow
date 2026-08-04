import assert from "node:assert/strict";
import test from "node:test";

import { createResultImageToken, verifyResultImageToken } from "../lib/result-image-token.ts";

test("result image tokens accept only the signed HTTPS URL before expiry", async () => {
  const now = 1_800_000_000_000;
  const source = "https://result.example.com/image.png?signature=secret";
  const { token, expiresAt } = await createResultImageToken(source, "signing-secret", now);

  assert.deepEqual(await verifyResultImageToken(token, "signing-secret", now + 1_000), { url: source, expiresAt });
  assert.equal(await verifyResultImageToken(`${token}x`, "signing-secret", now + 1_000), null);
  assert.equal(await verifyResultImageToken(token, "wrong-secret", now + 1_000), null);
  assert.equal(await verifyResultImageToken(token, "signing-secret", expiresAt * 1000), null);
  await assert.rejects(() => createResultImageToken("http://result.example.com/image.png", "signing-secret", now));
});
