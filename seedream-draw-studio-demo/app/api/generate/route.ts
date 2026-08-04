import type { LocalAuditTrace } from "@/lib/local-audit";
import { resolveArkProviderConfig, resolveResultImageSigningSecret } from "@/lib/ark-provider";
import { createResultImageToken, verifyResultImageToken } from "@/lib/result-image-token";
import {
  buildArkRequest,
  isLocalHostname,
  mapArkHttpStatus,
  parseArkResponse,
  parseClientRequest,
} from "@/lib/seedream-5-pro";

export const runtime = "edge";

const MAX_REQUEST_BODY_BYTES = 48 * 1024 * 1024;
const DEFAULT_ARK_TIMEOUT_MS = 180_000;
const AUTHORIZATION_PLACEHOLDER = "[present-but-never-captured]";

class RequestBodyTooLargeError extends Error {}

type ReadBody = { value: unknown; rawText: string; bytes: number };

type AuditContext = {
  traceId: string;
  capturedAt: string;
  startedAt: number;
  clientRequest: LocalAuditTrace["clientRequest"];
  arkRequest: LocalAuditTrace["arkRequest"];
  provider: LocalAuditTrace["provider"];
};

async function readJsonBody(request: Request): Promise<ReadBody> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new RequestBodyTooLargeError("请求体不能超过 48MB");
  }

  if (!request.body) return { value: null, rawText: "", bytes: 0 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyTooLargeError("请求体不能超过 48MB");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return { value: JSON.parse(text), rawText: text, bytes };
}

function arkTimeoutMs() {
  const configured = Number(process.env.ARK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000 && configured <= 300_000
    ? Math.trunc(configured)
    : DEFAULT_ARK_TIMEOUT_MS;
}

function providerErrorMessage(displayName: string, status: number, parsedError?: string) {
  if (status === 401 || status === 403) return `${displayName}鉴权或模型权限配置异常`;
  if (status === 429) return parsedError || `${displayName}请求过于频繁，请稍后重试`;
  if (status >= 500) return `${displayName}暂时不可用，请稍后重试`;
  return parsedError || `${displayName}请求失败（${status}）`;
}

function auditEnabled(request: Request, requested: boolean | undefined) {
  if (requested !== true) return false;
  try {
    const url = new URL(request.url);
    return url.searchParams.get("debug") === "1" && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function captureHeaders(headers: Headers) {
  const captured: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (/authorization|cookie|api[-_ ]?key|token|secret/i.test(key)) {
      captured[key] = "[sensitive-header-never-captured]";
    } else {
      captured[key] = value;
    }
  }
  return captured;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function redactExactSecret(value: unknown, secret: string): unknown {
  if (typeof value === "string") return value.replaceAll(secret, "[api-key-never-captured]");
  if (Array.isArray(value)) return value.map(item => redactExactSecret(item, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactExactSecret(child, secret)]));
  }
  return value;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function createAuditContext(
  request: Request,
  clientBody: ReadBody,
  arkBody: unknown,
  arkBodyText: string,
  provider: LocalAuditTrace["provider"],
): Promise<AuditContext> {
  return {
    traceId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    startedAt: Date.now(),
    clientRequest: {
      method: request.method,
      url: request.url,
      headers: captureHeaders(request.headers),
      // 页面已有原始对象，响应后由页面注入，避免把大图从服务端重复回传一次。
      rawBodyBytes: clientBody.bytes,
      rawBodySha256: await sha256(clientBody.rawText),
    },
    arkRequest: {
      method: "POST",
      url: provider.endpoint,
      headers: {
        authorization: AUTHORIZATION_PLACEHOLDER,
        "content-type": "application/json",
      },
      body: arkBody,
      rawBodyBytes: byteLength(arkBodyText),
      rawBodySha256: await sha256(arkBodyText),
    },
    provider,
  };
}

async function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Headers | undefined,
  auditContext: AuditContext | null,
  arkResponse?: LocalAuditTrace["arkResponse"],
  failure?: LocalAuditTrace["failure"],
) {
  if (!auditContext) return Response.json(body, { status, headers });

  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  const audit: LocalAuditTrace = {
    traceVersion: 2,
    traceId: auditContext.traceId,
    capturedAt: auditContext.capturedAt,
    durationMs: Math.max(0, Date.now() - auditContext.startedAt),
    retention: "memory-only",
    security: {
      authorizationCaptured: false,
      note: "API Key 与 Authorization 从不进入 Trace；其余请求体与上游原始响应仅返回当前 localhost 页面。",
    },
    provider: auditContext.provider,
    clientRequest: auditContext.clientRequest,
    arkRequest: auditContext.arkRequest,
    ...(arkResponse ? { arkResponse } : {}),
    appResponse: {
      status,
      headers: captureHeaders(responseHeaders),
      body,
      auditEnvelopeIncluded: true,
    },
    ...(failure ? { failure } : {}),
  };
  return Response.json({ ...body, audit }, { status, headers });
}

export async function POST(request: Request) {
  const providerResult = resolveArkProviderConfig(process.env);
  if (!providerResult.ok) return Response.json({ error: providerResult.error }, { status: 503 });
  const provider = providerResult.value;
  const signingSecret = resolveResultImageSigningSecret(process.env);
  if (!signingSecret) {
    return Response.json({ error: "服务端尚未配置 RESULT_IMAGE_SIGNING_SECRET" }, { status: 503 });
  }
  if (signingSecret === provider.apiKey) {
    return Response.json({ error: "RESULT_IMAGE_SIGNING_SECRET 必须与 ARK_API_KEY 不同" }, { status: 503 });
  }

  let clientBody: ReadBody;
  try {
    clientBody = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
    if (request.signal.aborted) return Response.json({ error: "请求已取消" }, { status: 499 });
    return Response.json({ error: "请求体必须是有效的 JSON" }, { status: 400 });
  }

  const parsedRequest = parseClientRequest(clientBody.value);
  if (!parsedRequest.ok) return Response.json({ error: parsedRequest.error }, { status: 400 });

  const resolvedImages: string[] = [];
  for (const image of parsedRequest.value.images) {
    if (!image.startsWith("/")) {
      resolvedImages.push(image);
      continue;
    }
    const token = new URL(image, request.url).searchParams.get("token");
    const verified = token ? await verifyResultImageToken(token, signingSecret) : null;
    if (!verified) return Response.json({ error: "生成结果已过期，请重新生成后再编辑" }, { status: 410 });
    resolvedImages.push(verified.url);
  }
  const resolvedRequest = { ...parsedRequest.value, images: resolvedImages };

  const arkRequest = buildArkRequest(resolvedRequest, provider.model);
  const arkRequestText = JSON.stringify(arkRequest);
  const includeAudit = auditEnabled(request, parsedRequest.value.debug);
  const auditContext = includeAudit
    ? await createAuditContext(request, clientBody, arkRequest, arkRequestText, {
        id: provider.id,
        displayName: provider.displayName,
        endpoint: provider.generationsUrl,
        model: provider.model,
      })
    : null;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, arkTimeoutMs());
  const abortFromClient = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener("abort", abortFromClient, { once: true });

  try {
    const arkResponse = await fetch(provider.generationsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: arkRequestText,
      signal: controller.signal,
    });

    const responseText = await arkResponse.text();
    let rawArkResponse: unknown;
    let responseWasJson = false;
    try {
      rawArkResponse = responseText.length ? JSON.parse(responseText) : null;
      responseWasJson = responseText.length > 0;
    } catch {
      rawArkResponse = null;
    }

    const parsedArkResponse = parseArkResponse(rawArkResponse);
    const auditArkResponse = auditContext
      ? await (async () => {
          const apiKeyWasPresent = responseText.includes(provider.apiKey);
          const auditResponseText = apiKeyWasPresent
            ? responseText.replaceAll(provider.apiKey, "[api-key-never-captured]")
            : responseText;
          return {
          status: arkResponse.status,
          statusText: arkResponse.statusText,
          headers: captureHeaders(arkResponse.headers),
          rawBody: auditResponseText,
          parsedBody: redactExactSecret(rawArkResponse, provider.apiKey),
          rawBodyBytes: byteLength(auditResponseText),
          rawBodySha256: await sha256(auditResponseText),
          ...(apiKeyWasPresent ? { redactions: ["api-key"] } : {}),
          };
        })()
      : undefined;

    if (!arkResponse.ok) {
      const status = mapArkHttpStatus(arkResponse.status);
      const headers = new Headers();
      const retryAfter = arkResponse.headers.get("retry-after");
      if (arkResponse.status === 429 && retryAfter) headers.set("Retry-After", retryAfter);
      return jsonResponse(
        {
          error: providerErrorMessage(
            provider.displayName,
            arkResponse.status,
            responseWasJson && !parsedArkResponse.ok ? parsedArkResponse.error : undefined,
          ),
        },
        status,
        headers,
        auditContext,
        auditArkResponse,
      );
    }

    if (!parsedArkResponse.ok) {
      return jsonResponse({ error: parsedArkResponse.error }, 502, undefined, auditContext, auditArkResponse);
    }

    const format = parsedArkResponse.value.outputFormat ?? parsedRequest.value.outputFormat;
    const imageToken = await createResultImageToken(parsedArkResponse.value.url, signingSecret);
    const result = {
      url: `/api/result-image?token=${encodeURIComponent(imageToken.token)}`,
      format,
      expiresAt: imageToken.expiresAt,
      ...(parsedArkResponse.value.size === undefined ? {} : { size: parsedArkResponse.value.size }),
      ...(parsedArkResponse.value.model === undefined ? {} : { model: parsedArkResponse.value.model }),
      ...(parsedArkResponse.value.created === undefined ? {} : { created: parsedArkResponse.value.created }),
      ...(parsedArkResponse.value.usage === undefined ? {} : { usage: parsedArkResponse.value.usage }),
    };
    return jsonResponse(
      {
        result,
      },
      200,
      undefined,
      auditContext,
      auditArkResponse,
    );
  } catch {
    if (timedOut) {
      return jsonResponse(
        { error: `${provider.displayName}请求超时，请稍后重试` },
        504,
        undefined,
        auditContext,
        undefined,
        { kind: "timeout" },
      );
    }
    if (request.signal.aborted) {
      return jsonResponse(
        { error: "请求已取消" },
        499,
        undefined,
        auditContext,
        undefined,
        { kind: "cancelled" },
      );
    }
    console.error("Ark-compatible image generation request failed");
    return jsonResponse(
      { error: `无法连接${provider.displayName}，请稍后重试` },
      502,
      undefined,
      auditContext,
      undefined,
      { kind: "network" },
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromClient);
  }
}
