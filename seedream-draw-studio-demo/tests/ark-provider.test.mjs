import assert from "node:assert/strict";
import test from "node:test";

import {
  ARK_PROVIDER_PROFILES,
  resolveArkProviderConfig,
  resolveResultImageSigningSecret,
} from "../lib/ark-provider.ts";

test("resolves the exact Volcengine endpoint and default model", () => {
  assert.deepEqual(resolveArkProviderConfig({ ARK_PROVIDER: "volcengine", ARK_API_KEY: "cn-key" }), {
    ok: true,
    value: {
      ...ARK_PROVIDER_PROFILES.volcengine,
      apiKey: "cn-key",
      model: "doubao-seedream-5-0-pro-260628",
    },
  });
});

test("resolves the exact BytePlus endpoint and default model", () => {
  assert.deepEqual(resolveArkProviderConfig({ ARK_PROVIDER: "byteplus", ARK_API_KEY: "global-key" }), {
    ok: true,
    value: {
      ...ARK_PROVIDER_PROFILES.byteplus,
      apiKey: "global-key",
      model: "dola-seedream-5-0-pro-260628",
    },
  });
});

test("allows a model override but fails closed for missing or unknown provider configuration", () => {
  const overridden = resolveArkProviderConfig({
    ARK_PROVIDER: " byteplus ",
    ARK_API_KEY: " key ",
    ARK_MODEL_ID: " custom-model ",
  });
  assert.equal(overridden.ok, true);
  assert.equal(overridden.value.model, "custom-model");
  assert.equal(overridden.value.apiKey, "key");

  for (const env of [
    { ARK_API_KEY: "key" },
    { ARK_PROVIDER: "global", ARK_API_KEY: "key" },
    { ARK_PROVIDER: "byteplus" },
  ]) assert.equal(resolveArkProviderConfig(env).ok, false);
});

test("result image signing uses only the independent application secret", () => {
  assert.equal(resolveResultImageSigningSecret({ RESULT_IMAGE_SIGNING_SECRET: " signing-secret " }), "signing-secret");
  assert.equal(resolveResultImageSigningSecret({ ARK_API_KEY: "upstream-key" }), null);
});
