export type Point = { x: number; y: number };
export type NormalizedPoint = Point;
export type ImageBox = { x: number; y: number; width: number; height: number; fit: number };
export type ViewTransform = { zoom: number; pan: Point };
export type ViewportRect = { left: number; top: number; width: number; height: number };
export type PointAnnotation = { type: "point"; x: number; y: number };
export type BboxAnnotation = { type: "bbox"; x1: number; y1: number; x2: number; y2: number };
export type CoordinateAnnotation = PointAnnotation | BboxAnnotation;
export type RatioPreset = { value: string; w: number; h: number; width: number; height: number };

export const MIN_OUTPUT_PIXELS = 1280 * 720;
export const MAX_OUTPUT_PIXELS = 4_624_220;
export const MAX_INPUT_PIXELS = 36_000_000;
export const MIN_INPUT_SIDE = 15;
export const MIN_ASPECT_RATIO = 1 / 16;
export const MAX_ASPECT_RATIO = 16;

export const RATIO_PRESETS: RatioPreset[] = [
  { value: "16:9", w: 16, h: 9, width: 1424, height: 800 },
  { value: "3:2", w: 3, h: 2, width: 1248, height: 832 },
  { value: "4:3", w: 4, h: 3, width: 1152, height: 864 },
  { value: "1:1", w: 1, h: 1, width: 1024, height: 1024 },
  { value: "3:4", w: 3, h: 4, width: 864, height: 1152 },
  { value: "2:3", w: 2, h: 3, width: 832, height: 1248 },
  { value: "9:16", w: 9, h: 16, width: 800, height: 1424 },
  { value: "21:9", w: 21, h: 9, width: 1568, height: 672 },
];

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function fitImageBox(
  viewport: { width: number; height: number },
  image: { width: number; height: number },
  reserve: { horizontal: number; vertical: number } = { horizontal: 150, vertical: 30 },
): ImageBox | null {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const availableWidth = Math.max(1, viewport.width - reserve.horizontal);
  const availableHeight = Math.max(1, viewport.height - reserve.vertical);
  const fit = Math.min(availableWidth / image.width, availableHeight / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  return { fit, width, height, x: (viewport.width - width) / 2, y: (viewport.height - height) / 2 };
}

export function clientToWorld(client: Point, viewport: ViewportRect, transform: ViewTransform): Point {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    x: (client.x - viewport.left - centerX - transform.pan.x) / transform.zoom + centerX,
    y: (client.y - viewport.top - centerY - transform.pan.y) / transform.zoom + centerY,
  };
}

export function worldToClient(world: Point, viewport: ViewportRect, transform: ViewTransform): Point {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    x: viewport.left + centerX + transform.pan.x + (world.x - centerX) * transform.zoom,
    y: viewport.top + centerY + transform.pan.y + (world.y - centerY) * transform.zoom,
  };
}

export function worldToNormalized(world: Point, box: ImageBox, shouldClamp = false): NormalizedPoint | null {
  const x = (world.x - box.x) / box.width;
  const y = (world.y - box.y) / box.height;
  if (!shouldClamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return shouldClamp ? { x: clamp01(x), y: clamp01(y) } : { x, y };
}

export function normalizedToWorld(point: NormalizedPoint, box: ImageBox): Point {
  return { x: box.x + point.x * box.width, y: box.y + point.y * box.height };
}

export function toCoordinateValue(value: number) {
  return Math.max(0, Math.min(999, Math.round(clamp01(value) * 1000)));
}

export function toPointAnnotation(point: NormalizedPoint): PointAnnotation {
  return { type: "point", x: toCoordinateValue(point.x), y: toCoordinateValue(point.y) };
}

export function toBboxAnnotation(first: NormalizedPoint, last: NormalizedPoint): BboxAnnotation {
  const x1 = toCoordinateValue(Math.min(first.x, last.x));
  const y1 = toCoordinateValue(Math.min(first.y, last.y));
  const x2 = toCoordinateValue(Math.max(first.x, last.x));
  const y2 = toCoordinateValue(Math.max(first.y, last.y));
  return { type: "bbox", x1, y1, x2, y2 };
}

export function isBboxLargeEnough(first: NormalizedPoint, last: NormalizedPoint, box: ImageBox, zoom: number, minimumPixels = 6) {
  const annotation = toBboxAnnotation(first, last);
  return annotation.x1 < annotation.x2
    && annotation.y1 < annotation.y2
    && Math.abs(last.x - first.x) * box.width * zoom >= minimumPixels
    && Math.abs(last.y - first.y) * box.height * zoom >= minimumPixels;
}

export function validatePixelSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
  const ratio = width / height;
  const pixels = width * height;
  return ratio >= MIN_ASPECT_RATIO && ratio <= MAX_ASPECT_RATIO && pixels >= MIN_OUTPUT_PIXELS && pixels <= MAX_OUTPUT_PIXELS;
}

export function validateInputDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_INPUT_SIDE || height < MIN_INPUT_SIDE) return false;
  const ratio = width / height;
  return width * height <= MAX_INPUT_PIXELS && ratio >= MIN_ASPECT_RATIO && ratio <= MAX_ASPECT_RATIO;
}
