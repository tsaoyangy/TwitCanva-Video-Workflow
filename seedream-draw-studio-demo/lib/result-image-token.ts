const TOKEN_TTL_SECONDS = 23 * 60 * 60;

type ResultImageTokenPayload = {
  url: string;
  expiresAt: number;
};

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid token encoding");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createResultImageToken(url: string, secret: string, now = Date.now()) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("result image URL must use HTTPS");
  const payload: ResultImageTokenPayload = {
    url,
    expiresAt: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(encodedPayload));
  return {
    token: `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`,
    expiresAt: payload.expiresAt,
  };
}

export async function verifyResultImageToken(token: string, secret: string, now = Date.now()) {
  const [encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra.length) return null;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    );
    if (!verified) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as Partial<ResultImageTokenPayload>;
    if (typeof payload.url !== "string" || typeof payload.expiresAt !== "number" || !Number.isInteger(payload.expiresAt)) return null;
    const url = new URL(payload.url);
    if (url.protocol !== "https:" || payload.expiresAt <= Math.floor(now / 1000)) return null;
    return { url: payload.url, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}
