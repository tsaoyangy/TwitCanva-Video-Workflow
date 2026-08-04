export const DEFAULT_ARK_MODEL = "doubao-seedream-5-0-pro-260628";
export const MAX_IMAGES = 10;
export const MAX_ANNOTATIONS = 20;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MIN_OUTPUT_PIXELS = 921_600;
export const MAX_OUTPUT_PIXELS = 4_624_220;

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type OutputFormat = "png" | "jpeg";
export type OptimizeMode = "standard";

export type PointAnnotation = {
  type: "point";
  x: number;
  y: number;
};

export type BboxAnnotation = {
  type: "bbox";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type CoordinateAnnotation = PointAnnotation | BboxAnnotation;

export type SeedreamEdit =
  | { mode: "mark" }
  | { mode: "coordinate"; annotations: CoordinateAnnotation[] };

export type SeedreamSize =
  | { mode: "resolution"; value: "1K" | "2K"; ratio: string }
  | { mode: "pixels"; width: number; height: number };

export type SeedreamClientRequest = {
  prompt: string;
  images: string[];
  edit: SeedreamEdit;
  size: SeedreamSize;
  outputFormat: OutputFormat;
  watermark: boolean;
  optimizeMode: OptimizeMode;
  debug?: boolean;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ArkRequest = {
  model: string;
  prompt: string;
  image: string[];
  size: "1K" | "2K" | `${number}x${number}`;
  optimize_prompt_options: { mode: OptimizeMode };
  output_format: OutputFormat;
  response_format: "url";
  watermark: boolean;
};

export type ParsedArkResponse =
  | {
      ok: true;
      value: {
        url: string;
        size?: string;
        outputFormat?: OutputFormat;
        model?: string;
        created?: number;
        usage?: unknown;
      };
    }
  | { ok: false; error: string; code?: string };

const ROOT_KEYS = new Set([
  "prompt",
  "images",
  "edit",
  "size",
  "outputFormat",
  "watermark",
  "optimizeMode",
  "debug",
]);
const MARK_EDIT_KEYS = new Set(["mode"]);
const COORDINATE_EDIT_KEYS = new Set(["mode", "annotations"]);
const POINT_KEYS = new Set(["type", "x", "y"]);
const BBOX_KEYS = new Set(["type", "x1", "y1", "x2", "y2"]);
const RESOLUTION_SIZE_KEYS = new Set(["mode", "value", "ratio"]);
const PIXEL_SIZE_KEYS = new Set(["mode", "width", "height"]);
const ALLOWED_MIME_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: Set<string>) {
  return Object.keys(value).every((key) => keys.has(key));
}

function failure<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function isCoordinate(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= 999;
}

function parseAnnotation(value: unknown, index: number): ValidationResult<CoordinateAnnotation> {
  if (!isPlainObject(value) || (value.type !== "point" && value.type !== "bbox")) {
    return failure(`edit.annotations[${index}] 必须是 point 或 bbox 对象`);
  }

  if (value.type === "point") {
    if (!hasOnlyKeys(value, POINT_KEYS) || !isCoordinate(value.x) || !isCoordinate(value.y)) {
      return failure(`edit.annotations[${index}] 的 point 坐标必须是 0 至 999 的整数`);
    }
    return { ok: true, value: { type: "point", x: value.x, y: value.y } };
  }

  if (
    !hasOnlyKeys(value, BBOX_KEYS) ||
    !isCoordinate(value.x1) ||
    !isCoordinate(value.y1) ||
    !isCoordinate(value.x2) ||
    !isCoordinate(value.y2) ||
    value.x1 >= value.x2 ||
    value.y1 >= value.y2
  ) {
    return failure(`edit.annotations[${index}] 的 bbox 坐标必须是 0 至 999 的递增整数`);
  }

  return {
    ok: true,
    value: { type: "bbox", x1: value.x1, y1: value.y1, x2: value.x2, y2: value.y2 },
  };
}

function parseEdit(value: unknown): ValidationResult<SeedreamEdit> {
  if (!isPlainObject(value)) return failure("edit 必须是对象");

  if (value.mode === "mark") {
    if (!hasOnlyKeys(value, MARK_EDIT_KEYS)) return failure("mark 模式的 edit 包含未知字段");
    return { ok: true, value: { mode: "mark" } };
  }

  if (value.mode !== "coordinate" || !hasOnlyKeys(value, COORDINATE_EDIT_KEYS)) {
    return failure("edit.mode 必须是 mark 或 coordinate，且不能包含未知字段");
  }
  if (!Array.isArray(value.annotations) || value.annotations.length < 1 || value.annotations.length > MAX_ANNOTATIONS) {
    return failure(`coordinate 模式需要 1 至 ${MAX_ANNOTATIONS} 个 annotations`);
  }

  const annotations: CoordinateAnnotation[] = [];
  for (let index = 0; index < value.annotations.length; index += 1) {
    const parsed = parseAnnotation(value.annotations[index], index);
    if (!parsed.ok) return parsed;
    annotations.push(parsed.value);
  }
  return { ok: true, value: { mode: "coordinate", annotations } };
}

function parseRatio(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") return failure("size.ratio 必须是 W:H 格式");
  const match = /^([1-9]\d{0,5}):([1-9]\d{0,5})$/.exec(value);
  if (!match) return failure("size.ratio 必须是正整数 W:H 格式");

  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / height;
  if (ratio < 1 / 16 || ratio > 16) return failure("size.ratio 必须在 1:16 至 16:1 之间");
  return { ok: true, value };
}

function parseSize(value: unknown): ValidationResult<SeedreamSize> {
  if (!isPlainObject(value)) return failure("size 必须是对象");

  if (value.mode === "resolution") {
    if (!hasOnlyKeys(value, RESOLUTION_SIZE_KEYS) || (value.value !== "1K" && value.value !== "2K")) {
      return failure("resolution size 仅支持 value=1K 或 2K，且不能包含未知字段");
    }
    const ratio = parseRatio(value.ratio);
    if (!ratio.ok) return ratio;
    return { ok: true, value: { mode: "resolution", value: value.value, ratio: ratio.value } };
  }

  if (value.mode !== "pixels" || !hasOnlyKeys(value, PIXEL_SIZE_KEYS)) {
    return failure("size.mode 必须是 resolution 或 pixels，且不能包含未知字段");
  }
  if (
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return failure("pixels size 的 width 和 height 必须是正整数");
  }

  const pixels = value.width * value.height;
  const ratio = value.width / value.height;
  if (pixels < MIN_OUTPUT_PIXELS || pixels > MAX_OUTPUT_PIXELS || ratio < 1 / 16 || ratio > 16) {
    return failure(
      `输出尺寸总像素必须在 ${MIN_OUTPUT_PIXELS} 至 ${MAX_OUTPUT_PIXELS} 之间，且宽高比在 1:16 至 16:1 之间`,
    );
  }
  return { ok: true, value: { mode: "pixels", width: value.width, height: value.height } };
}

function base64DecodedByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 === 1) return null;

  const firstPadding = value.indexOf("=");
  const unpadded = firstPadding === -1 ? value : value.slice(0, firstPadding);
  const padding = firstPadding === -1 ? 0 : value.length - firstPadding;
  if (
    padding > 2 ||
    (padding > 0 && value.length % 4 !== 0) ||
    (padding === 1 && unpadded.length % 4 !== 3) ||
    (padding === 2 && unpadded.length % 4 !== 2) ||
    !/^[A-Za-z0-9+/]+$/.test(unpadded) ||
    (padding > 0 && !/^={1,2}$/.test(value.slice(firstPadding)))
  ) {
    return null;
  }

  return Math.floor((unpadded.length * 3) / 4);
}

function validateImage(value: unknown, index: number): ValidationResult<string> {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return failure(`images[${index}] 必须是非空 HTTPS URL 或 data URL`);
  }

  if (!value.startsWith("data:")) {
    try {
      if (value.startsWith("/")) {
        const internal = new URL(value, "https://app.invalid");
        const token = internal.searchParams.get("token");
        if (
          internal.pathname !== "/api/result-image" ||
          internal.hash ||
          internal.searchParams.size !== 1 ||
          !token
        ) throw new Error("invalid internal result reference");
        return { ok: true, value };
      }
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname) throw new Error("invalid URL");
      return { ok: true, value };
    } catch {
      return failure(`images[${index}] 必须是有效的 HTTPS URL`);
    }
  }

  const separator = value.indexOf(",");
  if (separator < 0) return failure(`images[${index}] 是无效的 data URL`);
  const header = value.slice(0, separator);
  const headerMatch = /^data:(image\/[a-z]+);base64$/.exec(header);
  if (!headerMatch || !ALLOWED_MIME_SET.has(headerMatch[1])) {
    return failure(`images[${index}] 的 data URL MIME 不受支持或格式不合法`);
  }

  const encoded = value.slice(separator + 1);
  const decodedBytes = base64DecodedByteLength(encoded);
  if (decodedBytes === null) return failure(`images[${index}] 包含无效的 base64 数据`);
  if (decodedBytes > MAX_IMAGE_BYTES) {
    return failure(`images[${index}] 解码后不能超过 30MB`);
  }
  return { ok: true, value };
}

export function parseClientRequest(value: unknown): ValidationResult<SeedreamClientRequest> {
  if (!isPlainObject(value)) return failure("请求体必须是 JSON 对象");
  if (!hasOnlyKeys(value, ROOT_KEYS)) return failure("请求体包含未知字段");

  if (typeof value.prompt !== "string" || value.prompt.trim().length === 0) {
    return failure("prompt 必须是非空字符串");
  }
  if (!Array.isArray(value.images) || value.images.length < 1 || value.images.length > MAX_IMAGES) {
    return failure(`images 必须包含 1 至 ${MAX_IMAGES} 张图片`);
  }

  const images: string[] = [];
  for (let index = 0; index < value.images.length; index += 1) {
    const parsed = validateImage(value.images[index], index);
    if (!parsed.ok) return parsed;
    images.push(parsed.value);
  }

  const edit = parseEdit(value.edit);
  if (!edit.ok) return edit;
  const size = parseSize(value.size);
  if (!size.ok) return size;
  if (value.outputFormat !== "png" && value.outputFormat !== "jpeg") {
    return failure("outputFormat 必须是 png 或 jpeg");
  }
  if (typeof value.watermark !== "boolean") return failure("watermark 必须是布尔值");
  if (value.optimizeMode !== "standard") {
    return failure("Seedream 5.0 Pro 的 optimizeMode 仅支持 standard");
  }
  if (value.debug !== undefined && typeof value.debug !== "boolean") return failure("debug 必须是布尔值");

  return {
    ok: true,
    value: {
      prompt: value.prompt.trim(),
      images,
      edit: edit.value,
      size: size.value,
      outputFormat: value.outputFormat,
      watermark: value.watermark,
      optimizeMode: value.optimizeMode,
      ...(value.debug === undefined ? {} : { debug: value.debug }),
    },
  };
}

function serializeAnnotation(annotation: CoordinateAnnotation) {
  if (annotation.type === "point") return `图1<point>${annotation.x} ${annotation.y}</point>`;
  return `图1<bbox>${annotation.x1} ${annotation.y1} ${annotation.x2} ${annotation.y2}</bbox>`;
}

export function buildArkRequest(request: SeedreamClientRequest, model = DEFAULT_ARK_MODEL): ArkRequest {
  const ratioInstruction = request.size.mode === "resolution" ? `输出图片比例为 ${request.size.ratio}。` : "";
  const prompt = request.edit.mode === "coordinate"
    ? `请根据图1完成精准图片编辑。交互坐标定位（相对于图1，坐标范围0至999）：${request.edit.annotations.map(serializeAnnotation).join("；")}。请严格以这些坐标定位编辑目标。用户要求：${request.prompt}。${ratioInstruction}仅修改坐标所指区域；保持构图、人物身份和未指定区域与原图一致，使结果自然融合。`
    : `请根据图1中的手绘草图、涂鸦、圈选、箭头或标记区域进行图片编辑。用户要求：${request.prompt}。${ratioInstruction}仅修改标记所指区域；移除所有草图和标记线条；保持构图、人物身份和未标记区域与原图一致，使结果自然融合。`;

  return {
    model,
    prompt,
    image: request.images,
    size: request.size.mode === "resolution" ? request.size.value : `${request.size.width}x${request.size.height}`,
    optimize_prompt_options: { mode: request.optimizeMode },
    output_format: request.outputFormat,
    response_format: "url",
    watermark: request.watermark,
  };
}

function redactSensitiveText(value: string) {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "<image-data-redacted>")
    .replace(/https?:\/\/[^\s\"'<>]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        return `${url.origin}${url.pathname}${url.search || url.hash ? "<query-redacted>" : ""}`;
      } catch {
        return "<url-redacted>";
      }
    })
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1<secret-redacted>")
    .replace(/((?:(?:x[\s_-]?)?api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|secret|token)\s*[:=]\s*)[^\s,;]+/gi, "$1<secret-redacted>");
}

function parseArkError(value: unknown): { error: string; code?: string } | null {
  if (typeof value === "string" && value.trim()) return { error: redactSensitiveText(value.trim().slice(0, 1_000)) };
  if (!isPlainObject(value)) return null;
  const message = typeof value.message === "string" && value.message.trim()
    ? redactSensitiveText(value.message.trim().slice(0, 1_000))
    : "上游图像服务返回了未说明的错误";
  const code = typeof value.code === "string" && value.code.trim() ? value.code.trim().slice(0, 200) : undefined;
  return { error: message, ...(code ? { code } : {}) };
}

export function parseArkResponse(value: unknown): ParsedArkResponse {
  if (!isPlainObject(value)) return { ok: false, error: "上游图像服务返回了无效的 JSON 结构" };

  const topLevelError = parseArkError(value.error);
  if (topLevelError) return { ok: false, ...topLevelError };
  if (!Array.isArray(value.data) || value.data.length === 0 || !isPlainObject(value.data[0])) {
    return { ok: false, error: "上游图像服务未返回图片数据" };
  }

  const item = value.data[0];
  const itemError = parseArkError(item.error);
  if (itemError) return { ok: false, ...itemError };
  if (typeof item.url !== "string") return { ok: false, error: "上游图像服务未返回图片 URL" };
  try {
    const url = new URL(item.url);
    if (url.protocol !== "https:" || !url.hostname) throw new Error("invalid URL");
  } catch {
    return { ok: false, error: "上游图像服务返回了无效的图片 URL" };
  }

  return {
    ok: true,
    value: {
      url: item.url,
      ...(typeof item.size === "string" ? { size: item.size } : {}),
      ...(item.output_format === "png" || item.output_format === "jpeg"
        ? { outputFormat: item.output_format }
        : {}),
      ...(typeof value.model === "string" && value.model.trim() ? { model: value.model } : {}),
      ...(typeof value.created === "number" && Number.isFinite(value.created) ? { created: value.created } : {}),
      ...(value.usage === undefined ? {} : { usage: value.usage }),
    },
  };
}

export function mapArkHttpStatus(status: number) {
  if (status === 401 || status === 403) return 503;
  if (status === 429) return 429;
  if (status >= 500 && status <= 599) return 502;
  if (status >= 400 && status <= 499) return status;
  return 502;
}

function summarizeImage(value: string, index: number) {
  if (value.startsWith("data:")) {
    const separator = value.indexOf(",");
    return `<image ${index + 1}: ${separator >= 0 ? value.slice(5, separator) : "data-url"}, ${value.length} chars>`;
  }
  try {
    const url = new URL(value);
    return `<image ${index + 1}: ${url.origin}${url.pathname}>`;
  } catch {
    return `<image ${index + 1}: redacted>`;
  }
}

export function redactArkRequest(request: ArkRequest): Record<string, unknown> {
  return { ...request, image: request.image.map(summarizeImage) };
}

export function redactArkResponse(value: unknown): unknown {
  const redact = (current: unknown, key: string | undefined, depth: number): unknown => {
    if (depth > 8) return "<nested-value-redacted>";
    if (typeof current === "string") {
      if (key === "b64_json") return `<base64-redacted: ${current.length} chars>`;
      if (current.startsWith("data:image/")) return `<data-url-redacted: ${current.length} chars>`;
      if (key === "url") {
        try {
          const url = new URL(current);
          return `${url.origin}${url.pathname}${url.search || url.hash ? "<query-redacted>" : ""}`;
        } catch {
          return "<url-redacted>";
        }
      }
      return redactSensitiveText(current);
    }
    if (Array.isArray(current)) return current.map((item) => redact(item, key, depth + 1));
    if (!isPlainObject(current)) return current;

    return Object.fromEntries(
      Object.entries(current).map(([childKey, childValue]) => [
        childKey,
        /^(?:authorization|proxy[-_ ]authorization|(?:x[-_ ]?)?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|token)$/i.test(childKey)
          ? "<secret-redacted>"
          : redact(childValue, childKey, depth + 1),
      ]),
    );
  };

  return redact(value, undefined, 0);
}

export function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "127.0.0.1" || normalized === "::1";
}
