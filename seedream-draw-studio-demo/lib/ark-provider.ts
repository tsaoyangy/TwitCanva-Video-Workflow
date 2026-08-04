export type ArkProvider = "volcengine" | "byteplus";

export type ArkProviderProfile = {
  id: ArkProvider;
  displayName: string;
  generationsUrl: string;
  defaultModel: string;
};

export type ArkProviderConfig = ArkProviderProfile & {
  apiKey: string;
  model: string;
};

export const ARK_PROVIDER_PROFILES: Record<ArkProvider, ArkProviderProfile> = {
  volcengine: {
    id: "volcengine",
    displayName: "火山方舟",
    generationsUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    defaultModel: "doubao-seedream-5-0-pro-260628",
  },
  byteplus: {
    id: "byteplus",
    displayName: "BytePlus ModelArk",
    generationsUrl: "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations",
    defaultModel: "dola-seedream-5-0-pro-260628",
  },
};

export type ArkProviderConfigResult =
  | { ok: true; value: ArkProviderConfig }
  | { ok: false; error: string };

type ArkEnvironment = Record<string, string | undefined>;

export function resolveArkProviderConfig(env: ArkEnvironment): ArkProviderConfigResult {
  const providerValue = env.ARK_PROVIDER?.trim();
  if (providerValue !== "volcengine" && providerValue !== "byteplus") {
    return {
      ok: false,
      error: "服务端 ARK_PROVIDER 必须配置为 volcengine 或 byteplus",
    };
  }

  const apiKey = env.ARK_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "服务端尚未配置 ARK_API_KEY" };
  }

  const profile = ARK_PROVIDER_PROFILES[providerValue];
  return {
    ok: true,
    value: {
      ...profile,
      apiKey,
      model: env.ARK_MODEL_ID?.trim() || profile.defaultModel,
    },
  };
}

export function resolveResultImageSigningSecret(env: ArkEnvironment) {
  const secret = env.RESULT_IMAGE_SIGNING_SECRET?.trim();
  return secret || null;
}
