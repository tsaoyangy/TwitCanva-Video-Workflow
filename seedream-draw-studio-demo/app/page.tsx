/* eslint-disable @next/next/no-img-element -- 编辑器需要直接预览 data URL 与上游签名 URL。 */
"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type CoordinateAnnotation,
  type ImageBox,
  type NormalizedPoint,
  type Point,
  RATIO_PRESETS,
  clientToWorld,
  fitImageBox,
  isBboxLargeEnough,
  normalizedToWorld,
  toBboxAnnotation,
  toPointAnnotation,
  validateInputDimensions,
  validatePixelSize,
  worldToNormalized,
} from "@/lib/editor-geometry";
import type { LocalAuditTrace } from "@/lib/local-audit";

type Tool = "move" | "point" | "rect" | "brush" | "arrow";
type Mark = { id: string; tool: Exclude<Tool, "move">; color: string; opacity: number; width: number; points: NormalizedPoint[]; number: number };
type Panel = "ratio" | "advanced" | null;
type InteractionMode = "mark" | "coordinate";
type Advanced = { outputFormat: "png" | "jpeg"; watermark: boolean; optimizeMode: "standard" };
type SizeSetting = { mode: "resolution"; value: "1K" | "2K"; ratio: string } | { mode: "pixels"; width: number | ""; height: number | "" };
type ImageStatus = "empty" | "loading" | "ready" | "error";
type GenerateResult = { url: string; format: "png" | "jpeg"; size?: string; model?: string; created?: number; expiresAt?: number; usage?: unknown };
type GenerateResponse = {
  result?: GenerateResult;
  url?: string;
  image?: string;
  format?: "png" | "jpeg";
  size?: string;
  model?: string;
  usage?: unknown;
  error?: string;
  audit?: LocalAuditTrace;
};

const COLORS = ["#ff453a", "#ff9f0a", "#ffd60a", "#a8ff70", "#64d8cb", "#64a8ff", "#8e8cff", "#d77dff", "#ffffff"];
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_ADVANCED: Advanced = { outputFormat: "png", watermark: false, optimizeMode: "standard" };
const TOOL_INFO: Record<Tool, { icon: string; label: string }> = {
  move: { icon: "✋", label: "移动画布" }, point: { icon: "◎", label: "点标记" }, rect: { icon: "□", label: "矩形选区" }, brush: { icon: "⌁", label: "画笔" }, arrow: { icon: "↗", label: "箭头" },
};

function Icon({ children }: { children: React.ReactNode }) { return <span aria-hidden>{children}</span>; }

function resultExpiryLabel(_result?: GenerateResult) {
  if (typeof _result?.expiresAt !== "number" || !Number.isFinite(_result.expiresAt)) return "临时结果，请及时下载";
  const expiresAt = new Date(_result.expiresAt * 1000);
  return `中转有效至 ${expiresAt.toLocaleString("zh-CN", { hour12: false })}`;
}

function isLocalAuditUrl() {
  const hostname = window.location.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1";
  return local && new URLSearchParams(window.location.search).get("debug") === "1";
}

function auditPreviewValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "b64_json") return `<完整 Base64 图片数据 ${value.length.toLocaleString()} 个字符；请复制或下载 Trace 查看>`;
    if (value.startsWith("data:image/")) return `<完整图片数据 ${value.length.toLocaleString()} 个字符；请复制或下载 Trace 查看>`;
    if (value.length > 50_000) return `${value.slice(0, 50_000)}\n<预览已截断；完整内容请复制或下载 Trace>`;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => auditPreviewValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, auditPreviewValue(child, childKey)]));
  }
  return value;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const debugAreaRef = useRef<HTMLDivElement>(null);
  const parameterButtonsRef = useRef<HTMLDivElement>(null);
  const parameterPopoverRef = useRef<HTMLElement>(null);
  const uploadSequenceRef = useRef(0);
  const generateControllerRef = useRef<AbortController | null>(null);
  const [source, setSource] = useState("");
  const [tool, setTool] = useState<Tool>("point");
  const [color, setColor] = useState(COLORS[3]);
  const [opacity, setOpacity] = useState(0.65);
  const [brushWidth, setBrushWidth] = useState(12);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redoStack, setRedoStack] = useState<Mark[]>([]);
  const [active, setActive] = useState<Mark | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<SizeSetting>({ mode: "pixels", width: 1024, height: 1024 });
  const [advanced, setAdvanced] = useState<Advanced>(DEFAULT_ADVANCED);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageStatus, setImageStatus] = useState<ImageStatus>("empty");
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [modalOpen, setModalOpen] = useState(true);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("mark");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTrace, setDebugTrace] = useState<LocalAuditTrace | null>(null);
  const canvasSource = showResult && result ? result.url : source;
  const visibleTools: Tool[] = interactionMode === "coordinate" ? ["move", "point", "rect"] : ["move", "point", "rect", "brush", "arrow"];
  const pixelWidth = size.mode === "pixels" ? Number(size.width) : 0;
  const pixelHeight = size.mode === "pixels" ? Number(size.height) : 0;
  const sizeValid = size.mode === "resolution" || validatePixelSize(pixelWidth, pixelHeight);
  const displayError = error || (!sizeValid ? "输出尺寸需满足 921600–4624220 总像素，宽高比在 1:16 至 16:1。" : "");
  const selectedRatio = size.mode === "resolution"
    ? size.ratio
    : RATIO_PRESETS.find(item => item.width === pixelWidth && item.height === pixelHeight)?.value ?? "自定义";
  const canGenerate = Boolean(canvasSource && imageStatus === "ready" && !uploading && prompt.trim() && marks.length && sizeValid && !busy);

  const imageBox = useCallback(() => {
    const img = imageRef.current, canvas = canvasRef.current;
    if (!img || !canvas) return null;
    return fitImageBox(
      { width: canvas.clientWidth, height: canvas.clientHeight },
      { width: img.naturalWidth, height: img.naturalHeight },
    );
  }, []);

  const drawMark = useCallback((ctx: CanvasRenderingContext2D, mark: Mark, box: ImageBox) => {
    if (!mark.points.length) return;
    const points = mark.points.map(point => normalizedToWorld(point, box));
    const width = Math.max(0.5, mark.width * Math.min(box.width, box.height));
    ctx.save(); ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.globalAlpha = mark.opacity; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const a = points[0], b = points.at(-1)!;
    if (mark.tool === "brush") {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      if (points.length === 1) { ctx.arc(a.x, a.y, width / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    } else if (mark.tool === "rect") {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      const fontSize = width * 3.5, pad = width * 2.5, labelHeight = width * 7;
      ctx.globalAlpha = mark.opacity * 0.28; ctx.fillRect(x, y, w, h); ctx.globalAlpha = mark.opacity; ctx.strokeRect(x, y, w, h);
      ctx.font = `${fontSize}px Arial`; const label = `区域${String(mark.number).padStart(2, "0")}`; const tw = ctx.measureText(label).width + pad * 2;
      ctx.fillRect(x, y - labelHeight - width * .75, tw, labelHeight); ctx.fillStyle = "#101710"; ctx.fillText(label, x + pad, y - width * 2.75);
    } else if (mark.tool === "point") {
      const radius = width * 2.25, leader = width * 14.5, fontSize = width * 3.5, labelHeight = width * 9, pad = width * 2.5;
      const label = `标记${String(mark.number).padStart(2, "0")}`; ctx.beginPath(); ctx.arc(a.x, a.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + leader, a.y); ctx.stroke();
      ctx.font = `${fontSize}px Arial`; const tw = ctx.measureText(label).width + pad * 2; ctx.fillRect(a.x + leader - radius, a.y - labelHeight / 2, tw, labelHeight); ctx.fillStyle = "#103a35"; ctx.fillText(label, a.x + leader - radius + pad, a.y + fontSize * .35);
    } else {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), head = width * 5.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6)); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6)); ctx.stroke();
    }
    ctx.restore();
  }, []);

  const draw = useCallback(() => {
    if (!modalOpen) return;
    const canvas = canvasRef.current, img = imageRef.current, stage = stageRef.current; if (!canvas || !stage) return;
    const stageRect = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), cssW = Math.max(1, Math.floor(stageRect.width)), cssH = Math.max(1, Math.floor(stageRect.height));
    const pixelW = Math.max(1, Math.round(cssW * dpr)), pixelH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`; }
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH); ctx.save();
    ctx.translate(cssW / 2 + pan.x, cssH / 2 + pan.y); ctx.scale(zoom, zoom); ctx.translate(-cssW / 2, -cssH / 2);
    if (imageStatus === "ready" && img) { const box = imageBox(); if (box) { ctx.drawImage(img, box.x, box.y, box.width, box.height); marks.forEach(m => drawMark(ctx, m, box)); if (active) drawMark(ctx, active, box); } }
    ctx.restore();
  }, [active, drawMark, imageBox, imageStatus, marks, modalOpen, pan, zoom]);

  useEffect(() => {
    let cancelled = false;
    imageRef.current = null;
    if (!canvasSource) return () => { cancelled = true; };
    const img = new Image();
    if (/^https?:\/\//.test(canvasSource)) img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      setImageStatus("ready");
      setError("");
    };
    img.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
      setImageStatus("error");
      setError("图片加载失败；返回的图片数据可能不完整，请重新生成。");
    };
    img.src = canvasSource;
    return () => { cancelled = true; img.onload = null; img.onerror = null; };
  }, [canvasSource]);
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const resize = () => draw(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, [draw]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebugEnabled(isLocalAuditUrl()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => () => generateControllerRef.current?.abort(), []);
  useEffect(() => {
    if (!panel && !debugOpen) return;
    const closeOutsidePopovers = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        panel &&
        !parameterButtonsRef.current?.contains(target) &&
        !parameterPopoverRef.current?.contains(target)
      ) setPanel(null);
      if (debugOpen && !debugAreaRef.current?.contains(target)) setDebugOpen(false);
    };
    document.addEventListener("pointerdown", closeOutsidePopovers);
    return () => document.removeEventListener("pointerdown", closeOutsidePopovers);
  }, [debugOpen, panel]);
  useEffect(() => {
    if (!modalOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel || debugOpen) {
        event.preventDefault();
        setPanel(null);
        setDebugOpen(false);
        return;
      }
      generateControllerRef.current?.abort();
      setModalOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [debugOpen, modalOpen, panel]);

  const toImagePoint = (clientX: number, clientY: number, shouldClamp = false) => {
    const canvas = canvasRef.current, box = imageBox(); if (!canvas || !box) return null;
    const rect = canvas.getBoundingClientRect();
    const world = clientToWorld(
      { x: clientX, y: clientY },
      { left: rect.left, top: rect.top, width: canvas.clientWidth, height: canvas.clientHeight },
      { zoom, pan },
    );
    return worldToNormalized(world, box, shouldClamp);
  };
  const pointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "move" || !canvasSource) { setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); return; }
    if (imageStatus !== "ready") return;
    if (interactionMode === "coordinate" && marks.length >= 20) { setError("坐标定位最多支持 20 个标注。"); return; }
    const point = toImagePoint(e.clientX, e.clientY), box = imageBox();
    if (!point || !box) { setError("请在图片范围内添加标注。"); return; }
    const number = marks.filter(mark => mark.tool === tool).length + 1;
    const normalizedWidth = (tool === "brush" ? brushWidth : 4) / Math.min(box.width, box.height);
    setError("");
    setActive({ id: crypto.randomUUID(), tool, color, opacity, width: normalizedWidth, points: [point], number });
  };
  const pointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragStart) { setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); return; }
    const point = toImagePoint(e.clientX, e.clientY, true); if (!point) return;
    setActive(current => {
      if (!current || current.tool === "point") return current;
      return { ...current, points: current.tool === "brush" ? [...current.points, point] : [current.points[0], point] };
    });
  };
  const pointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    setDragStart(null);
    if (!active) return;
    const finalPoint = active.tool === "point" ? active.points[0] : toImagePoint(e.clientX, e.clientY, true) ?? active.points.at(-1)!;
    const completed = active.tool === "brush" ? { ...active, points: [...active.points, finalPoint] } : { ...active, points: [active.points[0], finalPoint] };
    const box = imageBox();
    if (completed.tool === "rect" && box && !isBboxLargeEnough(completed.points[0], completed.points[1], box, zoom)) {
      setActive(null); setError("矩形选区过小，请拖动至少 6 像素。"); return;
    }
    setMarks(old => [...old, completed]); setRedoStack([]); setActive(null);
  };
  const pointerCancel = () => { setDragStart(null); setActive(null); };
  const clearEditingState = () => { setMarks([]); setRedoStack([]); setActive(null); setDragStart(null); setPan({ x: 0, y: 0 }); setZoom(1); };
  const closeModal = () => { generateControllerRef.current?.abort(); setModalOpen(false); };
  const switchInteractionMode = (nextMode: InteractionMode) => { if (busy || nextMode === interactionMode) return; setInteractionMode(nextMode); setTool(nextMode === "coordinate" ? "point" : "brush"); clearEditingState(); setError(""); };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget, file = input.files?.[0]; input.value = ""; if (!file) return;
    const sequence = ++uploadSequenceRef.current;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) { setUploading(false); setError("仅支持 JPEG、PNG 或 WebP 图片。"); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setUploading(false); setError("图片不能超过 30MB。"); return; }
    setUploading(true); setError("");
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const probe = new Image();
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
        probe.onerror = () => reject(new Error("无法读取图片，请确认文件没有损坏。"));
        probe.src = objectUrl;
      });
      if (!validateInputDimensions(dimensions.width, dimensions.height)) throw new Error("图片需宽高均大于 14 像素、总像素不超过 3600 万，且宽高比在 1:16 至 16:1 之间。");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败。"));
        reader.onerror = () => reject(new Error("图片读取失败。"));
        reader.readAsDataURL(file);
      });
      if (sequence !== uploadSequenceRef.current) return;
      imageRef.current = null; setImageStatus("loading"); setSource(dataUrl); setResult(null); setShowResult(false); clearEditingState();
    } catch (uploadError) {
      if (sequence === uploadSequenceRef.current) setError(uploadError instanceof Error ? uploadError.message : "图片读取失败。");
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (sequence === uploadSequenceRef.current) setUploading(false);
    }
  };
  const undo = () => { const last = marks.at(-1); if (!last) return; setMarks(marks.slice(0, -1)); setRedoStack(old => [...old, last]); };
  const redo = () => { const last = redoStack.at(-1); if (!last) return; setRedoStack(redoStack.slice(0, -1)); setMarks(old => [...old, last]); };

  const chooseRatio = (value: string, width: number, height: number) => setSize(current => current.mode === "resolution" ? { ...current, ratio: value } : { mode: "pixels", width, height });
  const resetRatio = () => setSize({ mode: "pixels", width: 1024, height: 1024 });
  const toggleSizeMode = () => setSize(current => {
    if (current.mode === "pixels") return { mode: "resolution", value: "1K", ratio: selectedRatio === "自定义" ? "1:1" : selectedRatio };
    const preset = RATIO_PRESETS.find(item => item.value === current.ratio) ?? RATIO_PRESETS.find(item => item.value === "1:1")!;
    return { mode: "pixels", width: preset.width, height: preset.height };
  });
  const exportMarkedImage = async () => {
    const img = imageRef.current;
    if (imageStatus !== "ready" || !img) throw new Error("图片仍在加载，请稍后重试。");
    const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器无法创建图片画布。");
    ctx.drawImage(img, 0, 0);
    const naturalBox: ImageBox = { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight, fit: 1 };
    marks.forEach(mark => drawMark(ctx, mark, naturalBox));
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error("浏览器无法导出标记图片。")),
      "image/png",
    ));
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error("叠加标记后的 PNG 超过 30MB，请缩小或压缩原图后重试。");
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("标记图片读取失败。"));
      reader.onerror = () => reject(new Error("标记图片读取失败。"));
      reader.readAsDataURL(blob);
    });
  };
  const buildCoordinateAnnotations = (): CoordinateAnnotation[] => marks.flatMap<CoordinateAnnotation>(mark => {
    const first = mark.points[0], last = mark.points.at(-1); if (!first || !last) return [];
    if (mark.tool === "point") return [toPointAnnotation(first)];
    if (mark.tool === "rect") {
      const annotation = toBboxAnnotation(first, last);
      if (annotation.x1 >= annotation.x2 || annotation.y1 >= annotation.y2) {
        throw new Error("矩形选区量化后过小，请扩大选区后重试。");
      }
      return [annotation];
    }
    return [];
  }).slice(0, 20);
  const switchCanvasImage = (nextShowResult: boolean) => { if ((nextShowResult && !result) || nextShowResult === showResult) return; imageRef.current = null; setImageStatus("loading"); setShowResult(nextShowResult); clearEditingState(); };
  const downloadResult = () => { if (!result) return; const link = document.createElement("a"); link.href = result.url; link.download = `画梦结果-${new Date().toLocaleDateString("sv-SE")}.${result.format}`; link.target = "_blank"; link.rel = "noopener noreferrer"; document.body.appendChild(link); link.click(); link.remove(); };
  const formatDebug = (value: unknown) => JSON.stringify(value, null, 2) ?? "未提供";
  const formatDebugPreview = (value: unknown) => formatDebug(auditPreviewValue(value));
  const copyDebug = async (value: unknown) => {
    try { await navigator.clipboard.writeText(formatDebug(value)); }
    catch { setError("复制失败；完整 Trace 可能过大，请改用下载。"); }
  };
  const downloadDebugTrace = () => {
    if (!debugTrace) return;
    const blob = new Blob([formatDebug(debugTrace)], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `seedream-audit-${debugTrace.traceId}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };
  const generate = async () => {
    if (!canGenerate) { if (!sizeValid) setError("输出尺寸不符合总像素或宽高比要求。"); return; }
    const controller = new AbortController();
    generateControllerRef.current = controller;
    setBusy(true); setError("");
    try {
      const annotations = interactionMode === "coordinate" ? buildCoordinateAnnotations() : [];
      if (!marks.length || (interactionMode === "coordinate" && !annotations.length)) throw new Error("请先在图片中添加有效标注。");
      const inputImage = interactionMode === "coordinate" ? canvasSource : await exportMarkedImage();
      const requestSize = size.mode === "resolution"
        ? size
        : { mode: "pixels" as const, width: Number(size.width), height: Number(size.height) };
      const auditActive = debugEnabled && isLocalAuditUrl();
      const clientRequest = {
        prompt: prompt.trim(),
        images: [inputImage],
        edit: interactionMode === "coordinate" ? { mode: "coordinate" as const, annotations } : { mode: "mark" as const },
        size: requestSize,
        outputFormat: advanced.outputFormat,
        watermark: advanced.watermark,
        optimizeMode: advanced.optimizeMode,
        debug: auditActive,
      };
      if (auditActive) setDebugTrace(null);
      const endpoint = auditActive ? "/api/generate?debug=1" : "/api/generate";
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clientRequest), signal: controller.signal });
      const responseText = await res.text();
      let data: GenerateResponse;
      try { data = JSON.parse(responseText); } catch { throw new Error(`服务端返回了无法解析的响应（HTTP ${res.status}）`); }
      if (auditActive && data.audit) {
        setDebugTrace({
          ...data.audit,
          clientRequest: { ...data.audit.clientRequest, body: clientRequest },
        });
      }
      if (!res.ok) throw new Error(data.error || `生成失败（HTTP ${res.status}）`);
      const fallbackUrl = data.url || data.image;
      const nextResult = data.result ?? (fallbackUrl ? { url: fallbackUrl, format: data.format ?? advanced.outputFormat, size: data.size, model: data.model, usage: data.usage } : null);
      if (!nextResult?.url) throw new Error("服务端未返回生成图片");
      imageRef.current = null; setImageStatus("loading"); setResult(nextResult); setShowResult(true); clearEditingState();
    }
    catch (generationError) { setError(controller.signal.aborted ? "生成已取消。" : generationError instanceof TypeError ? "网络连接中断，请检查本地服务是否仍在运行后重试。" : generationError instanceof Error ? generationError.message : "生成失败"); } finally { if (generateControllerRef.current === controller) generateControllerRef.current = null; setBusy(false); }
  };

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand-mark">梦</div>{["主页", "图片生成", "视频生成", "模型广场", "智能编辑", "素材库"].map((label, i) => <button key={label} className={i === 1 ? "side-btn active" : "side-btn"} aria-label={label} title={label} onClick={i === 1 ? () => setModalOpen(true) : undefined}><Icon>{["⌂", "▧", "◉", "▣", "↗", "▱"][i]}</Icon></button>)}<div className="side-sep" /><button className="side-btn" title="创意工具">✦</button><button className="side-btn" title="工作流">⌘</button><button className="side-btn bottom" title="文件夹">▱</button></aside>
    <header className="topbar"><div className="logo"><span className="logo-orb">梦</span> Seedream50Pro</div><div className="top-actions"><button>？ 帮助</button></div></header>
    <section className="history-page"><div className="history-copy"><span className="date">Seedream 5.0 Pro 交互编辑</span><p>使用标注区域对图像进行精准编辑，尽量保持未标注区域与原图一致。</p><div className="tags"><span>豆包画梦 5.0 专业版</span><span>参考图片</span><span>高级参数 ⓘ</span></div></div><div className="gallery-card">{result ? <><img src={result.url} alt="最新生成结果" /><div className="result-meta"><span>{result.format.toUpperCase()}{result.size ? ` · ${result.size}` : ""}</span><span>{resultExpiryLabel(result)}</span></div></> : <div className="gallery-placeholder">生成结果将在这里显示</div>}<div className="card-actions"><button onClick={() => { switchCanvasImage(true); setModalOpen(true); }} disabled={!result}>⌁ 重新编辑</button><button onClick={() => setModalOpen(true)}>打开画板</button>{result && <button onClick={downloadResult}>↓ 下载</button>}</div></div></section>
    <aside className="explore"><div className="explore-tabs"><b>发现</b><span>历史记录</span></div><div className="masonry">{Array.from({ length: 12 }).map((_, i) => <div key={i} className={`tile t${i % 6}`}>画梦<br/><small>视觉灵感 {i + 1}</small></div>)}</div></aside>

    {modalOpen && <div className="modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) closeModal(); }}><section className="draw-modal" role="dialog" aria-modal="true" aria-label="画板编辑器"><div className="modal-title"><span>画板</span><div className="result-actions">{result && <><button className={!showResult ? "selected" : ""} onClick={() => switchCanvasImage(false)}>原图</button><button className={showResult ? "selected" : ""} onClick={() => switchCanvasImage(true)}>生成结果</button><span className="result-expiry">{resultExpiryLabel(result)}</span><button className="download-result" onClick={downloadResult}>↓ 下载结果图</button></>}<button onClick={closeModal} aria-label="关闭">×</button></div></div>
      <div className="editor-stage" ref={stageRef}>{!canvasSource && <label className="upload-empty"><span>＋</span><b>{uploading ? "正在校验图片…" : "上传图片开始创作"}</b><small>JPEG、PNG 或 WebP，最大 30MB</small><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={upload} /></label>}{canvasSource && imageStatus === "loading" && <div className="image-loading" role="status">正在加载图片…</div>}<canvas ref={canvasRef} aria-label="图片标注画布" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} />
        <div className="tools">{visibleTools.map(t => <button key={t} className={tool === t ? "selected tip" : "tip"} data-tip={TOOL_INFO[t].label} onClick={() => setTool(t)} aria-label={TOOL_INFO[t].label}><Icon>{TOOL_INFO[t].icon}</Icon></button>)}</div>
        <div className="history-tools"><button className="tip" data-tip="撤销" onClick={undo} disabled={!marks.length} aria-label="撤销">↶</button><button className="tip" data-tip="重做" onClick={redo} disabled={!redoStack.length} aria-label="重做">↷</button></div>
        <div className="zoom-tools"><button onClick={() => setZoom(z => Math.min(3, z + .1))} aria-label="放大">＋</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.max(.3, z - .1))} aria-label="缩小">−</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="适应画布">⌗</button></div>
        {(tool === "brush" || tool === "rect" || tool === "arrow" || tool === "point") && <div className="brush-panel"><div className="panel-mini-title">{TOOL_INFO[tool].label}</div><div className="swatches">{COLORS.map(c => <button key={c} onClick={() => setColor(c)} className={c === color ? "picked" : ""} style={{ background: c }} aria-label={`选择颜色 ${c}`} />)}</div><label>透明度<input type="range" min=".15" max="1" step=".05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /><span>{Math.round(opacity * 100)}%</span></label>{tool === "brush" && <label>画笔大小<input type="range" min="3" max="40" value={brushWidth} onChange={e => setBrushWidth(Number(e.target.value))} /><span>{brushWidth}px</span></label>}</div>}
      </div>
      <div className="prompt-panel"><div className="source-area" ref={debugAreaRef}><label className="thumb-upload">{canvasSource ? <img src={canvasSource} alt="当前编辑图片" /> : "＋"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={upload} /></label>{debugEnabled && <button className="debug-toggle" onClick={() => setDebugOpen(open => !open)}>{debugOpen ? "收起审计" : "完整审计"}</button>}{debugEnabled && debugOpen && <aside className="debug-popover"><header><b>完整请求审计</b><span>{debugTrace ? `Trace ${debugTrace.traceId}` : "仅保留在当前页面内存"}</span><div className="audit-actions">{debugTrace && <button onClick={downloadDebugTrace}>↓ 下载完整 Trace</button>}<button onClick={() => setDebugOpen(false)} aria-label="关闭完整审计">×</button></div></header>{debugTrace ? <><p>API Key / Authorization 永不记录；图片 Base64 在预览中折叠，复制和下载内容保持完整。刷新或关闭页面后 Trace 自动消失。</p><section><div><b>页面 → 服务端</b><button onClick={() => copyDebug(debugTrace.clientRequest)}>复制完整入参</button></div><pre>{formatDebugPreview(debugTrace.clientRequest)}</pre></section><section><div><b>服务端 → 方舟</b><button onClick={() => copyDebug(debugTrace.arkRequest)}>复制完整入参</button></div><pre>{formatDebugPreview(debugTrace.arkRequest)}</pre></section><section><div><b>方舟原始返回</b><button onClick={() => copyDebug(debugTrace.arkResponse)}>复制完整返回</button></div><pre>{formatDebugPreview(debugTrace.arkResponse)}</pre></section><section><div><b>服务端 → 页面</b><button onClick={() => copyDebug(debugTrace.appResponse)}>复制完整返回</button></div><pre>{formatDebugPreview(debugTrace.appResponse)}</pre></section></> : <p>仅当使用 localhost 且 URL 带 ?debug=1 时启用。发起一次生成后可查看、复制或下载完整 Trace。</p>}</aside>}</div><textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="描述你希望在标注位置完成的编辑" /><div className="mode-row"><span>编辑方式</span><button className={interactionMode === "mark" ? "selected" : ""} onClick={() => switchInteractionMode("mark")}>任意标记<small>涂鸦、圈选、箭头</small></button><button className={interactionMode === "coordinate" ? "selected" : ""} onClick={() => switchInteractionMode("coordinate")}>坐标定位<small>点选、框选</small></button></div><div className="prompt-bottom"><div className="parameter-buttons" ref={parameterButtonsRef}><button onClick={() => setPanel(panel === "ratio" ? null : "ratio")} className={panel === "ratio" ? "open" : ""}>▭ {selectedRatio}</button><button onClick={() => setPanel(panel === "advanced" ? null : "advanced")} className={panel === "advanced" ? "open" : ""} aria-label="高级参数">⌘</button></div>{interactionMode === "coordinate" && marks.length > 0 && <span className="coordinate-status">已启用 {marks.length} 个坐标定位</span>}<span className="pricing">按实际用量计费</span><button className="generate" disabled={!canGenerate} onClick={generate}>{busy ? "正在生成…" : uploading || imageStatus === "loading" ? "图片加载中…" : "生成"}</button></div>{displayError && <div className="error" role="alert">{displayError}</div>}
        {panel === "ratio" && <section ref={parameterPopoverRef} className="parameter-popover ratio-popover"><header><b>尺寸与比例</b><button onClick={resetRatio}>↻ 重置</button></header><div className="parameter-body"><div className="toggle-row"><span>按清晰度生成<small>开启时发送 1K/2K，并在提示词中指定比例</small></span><button className={size.mode === "resolution" ? "toggle on" : "toggle"} onClick={toggleSizeMode} aria-label="切换尺寸模式" aria-pressed={size.mode === "resolution"}><i /></button></div>{size.mode === "resolution" && <select value={size.value} onChange={e => setSize({ ...size, value: e.target.value as "1K" | "2K" })}><option value="1K">1K</option><option value="2K">2K</option></select>}<label className="section-label">图片比例 <span>?</span></label><div className="ratio-grid">{RATIO_PRESETS.map(item => <button key={item.value} className={selectedRatio === item.value ? "chosen" : ""} onClick={() => chooseRatio(item.value, item.width, item.height)}><i style={{ aspectRatio: `${item.w}/${item.h}` }} />{item.value}</button>)}{size.mode === "pixels" && <button className={selectedRatio === "自定义" ? "chosen" : ""}>⌘ 自定义</button>}</div>{size.mode === "pixels" && <><label className="section-label">精确像素 <span>?</span></label><div className="size-inputs"><label>宽<input type="number" min="15" step="1" value={size.width} aria-invalid={!sizeValid} onChange={e => setSize({ mode: "pixels", width: e.target.value === "" ? "" : Number(e.target.value), height: size.height })} /></label><span>⇄</span><label>高<input type="number" min="15" step="1" value={size.height} aria-invalid={!sizeValid} onChange={e => setSize({ mode: "pixels", width: size.width, height: e.target.value === "" ? "" : Number(e.target.value) })} /></label></div><p className="parameter-note">精确尺寸按总像素 921600–4624220、宽高比 1:16–16:1 校验。</p></>}</div></section>}
        {panel === "advanced" && <section ref={parameterPopoverRef} className="parameter-popover advanced-popover"><header><b>高级参数</b><button onClick={() => setAdvanced(DEFAULT_ADVANCED)}>↻ 重置</button></header><div className="parameter-body"><label className="field-label">输出格式 <span>?</span><select value={advanced.outputFormat} onChange={e => setAdvanced(a => ({ ...a, outputFormat: e.target.value as Advanced["outputFormat"] }))}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><label className="field-label">提示词优化 <span>?</span><select value="standard" disabled aria-label="提示词优化模式"><option value="standard">标准模式</option></select></label><div className="toggle-row"><span>添加水印 <small>图片右下角添加“AI生成”标识</small></span><button className={advanced.watermark ? "toggle on" : "toggle"} onClick={() => setAdvanced(a => ({ ...a, watermark: !a.watermark }))} aria-label="添加水印开关" aria-pressed={advanced.watermark}><i /></button></div><p className="parameter-note">Seedream 5.0 Pro 的提示词优化固定使用标准模式。</p></div></section>}
      </div>
    </section></div>}
  </main>;
}
