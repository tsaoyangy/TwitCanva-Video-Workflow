import { verifyResultImageToken } from "@/lib/result-image-token";
import { resolveResultImageSigningSecret } from "@/lib/ark-provider";

export const runtime = "edge";

const RESULT_FETCH_TIMEOUT_MS = 60_000;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const signingSecret = resolveResultImageSigningSecret(process.env);
  if (!signingSecret) return errorResponse("服务端尚未配置 RESULT_IMAGE_SIGNING_SECRET", 503);

  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  if (!token) return errorResponse("缺少结果图片令牌", 400);
  const verified = await verifyResultImageToken(token, signingSecret);
  if (!verified) return errorResponse("结果图片令牌无效或已过期", 410);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESULT_FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(verified.url, {
      headers: { Accept: "image/*" },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) return errorResponse("结果图片暂时无法获取，请重新生成", 502);
    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!contentType?.startsWith("image/")) return errorResponse("结果地址未返回有效图片", 502);

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength)) headers.set("Content-Length", contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return errorResponse("结果图片获取超时或网络异常，请重新生成", 502);
  } finally {
    clearTimeout(timeout);
  }
}
