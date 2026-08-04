import React, { useCallback, useEffect, useRef, useState } from 'react';
import { generateSeedreamEdit, SeedreamEditAnnotation, SeedreamEditMode } from '../../services/seedreamEditService';

type Tool = 'move' | 'point' | 'rect' | 'brush' | 'arrow';
type NormalizedPoint = { x: number; y: number };
type Mark = {
  id: string;
  tool: Exclude<Tool, 'move'>;
  color: string;
  width: number;
  points: NormalizedPoint[];
  number: number;
};

interface SeedreamDrawStudioModalProps {
  isOpen: boolean;
  sourceNodeId: string | null;
  sourceImageUrl?: string;
  initialPrompt?: string;
  initialAspectRatio?: string;
  initialResolution?: string;
  onClose: () => void;
  onGenerationStarted: (payload: {
    sourceNodeId: string;
    prompt: string;
    aspectRatio: string;
    resolution: string;
  }) => string;
  onGenerationCompleted: (payload: {
    outputNodeId: string;
    sourceNodeId: string;
    resultUrl: string;
    prompt: string;
    aspectRatio: string;
    resolution: string;
  }) => void;
  onGenerationFailed: (payload: {
    outputNodeId: string;
    errorMessage: string;
  }) => void;
}

const COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#64d8cb', '#64a8ff', '#d77dff', '#ffffff'];
const RATIO_PRESETS = ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function fitImage(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const cw = canvas.clientWidth || canvas.width;
  const ch = canvas.clientHeight || canvas.height;
  const scale = Math.min(cw / image.naturalWidth, ch / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    x: (cw - width) / 2,
    y: (ch - height) / 2,
    width,
    height
  };
}

function pointToAnnotation(point: NormalizedPoint): SeedreamEditAnnotation {
  return {
    type: 'point',
    x: Math.round(clamp01(point.x) * 999),
    y: Math.round(clamp01(point.y) * 999)
  };
}

function rectToAnnotation(first: NormalizedPoint, last: NormalizedPoint): SeedreamEditAnnotation {
  const x1 = Math.round(Math.min(clamp01(first.x), clamp01(last.x)) * 999);
  const y1 = Math.round(Math.min(clamp01(first.y), clamp01(last.y)) * 999);
  const x2 = Math.round(Math.max(clamp01(first.x), clamp01(last.x)) * 999);
  const y2 = Math.round(Math.max(clamp01(first.y), clamp01(last.y)) * 999);
  return {
    type: 'bbox',
    x1,
    y1,
    x2: Math.max(x1 + 1, x2),
    y2: Math.max(y1 + 1, y2)
  };
}

export const SeedreamDrawStudioModal: React.FC<SeedreamDrawStudioModalProps> = ({
  isOpen,
  sourceNodeId,
  sourceImageUrl,
  initialPrompt,
  initialAspectRatio,
  initialResolution,
  onClose,
  onGenerationStarted,
  onGenerationCompleted,
  onGenerationFailed
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const activeRef = useRef<Mark | null>(null);
  const [source, setSource] = useState(sourceImageUrl || '');
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [mode, setMode] = useState<SeedreamEditMode>('mark');
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(COLORS[3]);
  const [brushWidth, setBrushWidth] = useState(12);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [active, setActive] = useState<Mark | null>(null);
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio || '1:1');
  const [resolution, setResolution] = useState<'1K' | '2K'>(initialResolution === '2K' ? '2K' : '1K');
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpeg'>('png');
  const [watermark, setWatermark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [error, setError] = useState('');

  const visibleTools: Tool[] = mode === 'coordinate'
    ? ['move', 'point', 'rect']
    : ['move', 'point', 'rect', 'brush', 'arrow'];

  const drawMark = useCallback((ctx: CanvasRenderingContext2D, mark: Mark, box: ReturnType<typeof fitImage>) => {
    if (!mark.points.length) return;
    const toWorld = (point: NormalizedPoint) => ({
      x: box.x + point.x * box.width,
      y: box.y + point.y * box.height
    });
    const first = toWorld(mark.points[0]);
    const last = toWorld(mark.points[mark.points.length - 1]);
    const width = mark.tool === 'brush' ? mark.width : 4;

    ctx.save();
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.78;

    if (mark.tool === 'brush') {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      mark.points.slice(1).forEach(point => {
        const next = toWorld(point);
        ctx.lineTo(next.x, next.y);
      });
      ctx.stroke();
    } else if (mark.tool === 'rect') {
      const x = Math.min(first.x, last.x);
      const y = Math.min(first.y, last.y);
      const w = Math.abs(last.x - first.x);
      const h = Math.abs(last.y - first.y);
      ctx.globalAlpha = 0.22;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(x, y, w, h);
      ctx.font = '12px sans-serif';
      ctx.fillText(`区域${mark.number}`, x + 6, y + 16);
    } else if (mark.tool === 'point') {
      ctx.beginPath();
      ctx.arc(first.x, first.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '12px sans-serif';
      ctx.fillText(`标记${mark.number}`, first.x + 12, first.y + 4);
    } else if (mark.tool === 'arrow') {
      const angle = Math.atan2(last.y - first.y, last.x - first.x);
      const head = 16;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      ctx.lineTo(last.x - head * Math.cos(angle - Math.PI / 6), last.y - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(last.x - head * Math.cos(angle + Math.PI / 6), last.y - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!image || !imageReady) return;
    const box = fitImage(canvas, image);
    ctx.drawImage(image, box.x, box.y, box.width, box.height);
    marks.forEach(mark => drawMark(ctx, mark, box));
    if (active) drawMark(ctx, active, box);
  }, [active, drawMark, imageReady, marks]);

  useEffect(() => {
    if (!isOpen) return;
    setSource(sourceImageUrl || '');
    setPrompt(initialPrompt || '');
    setAspectRatio(initialAspectRatio || '1:1');
    setResolution(initialResolution === '2K' ? '2K' : '1K');
    setMarks([]);
    setActive(null);
    setError('');
  }, [isOpen, sourceImageUrl, initialPrompt, initialAspectRatio, initialResolution]);

  useEffect(() => {
    if (!isOpen || !source) {
      imageRef.current = null;
      setImageReady(false);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageReady(true);
      setError('');
    };
    image.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
      setImageReady(false);
      setError('图片加载失败，请换一张图片或重新打开编辑器。');
    };
    image.src = source;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [isOpen, source]);

  useEffect(() => {
    if (!isOpen) return;
    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw, isOpen]);

  useEffect(() => {
    if (mode === 'coordinate' && (tool === 'brush' || tool === 'arrow')) {
      setTool('point');
      setMarks([]);
    }
  }, [mode, tool]);

  const eventToImagePoint = (event: React.PointerEvent<HTMLCanvasElement>, clamp = false): NormalizedPoint | null => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageReady) return null;
    const box = fitImage(canvas, image);
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - box.x) / box.width;
    const y = (event.clientY - rect.top - box.y) / box.height;
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return { x: clamp01(x), y: clamp01(y) };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || tool === 'move') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = eventToImagePoint(event);
    if (!point) {
      setError('请在图片范围内添加标注。');
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: Mark = {
      id: crypto.randomUUID(),
      tool,
      color,
      width: brushWidth,
      points: [point],
      number: marks.length + 1
    };
    activeRef.current = next;
    setActive(next);
    setError('');
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeRef.current) return;
    const point = eventToImagePoint(event, true);
    if (!point) return;
    const current = activeRef.current;
    const updated: Mark = current.tool === 'point'
      ? current
      : {
          ...current,
          points: current.tool === 'brush'
            ? [...current.points, point]
            : [current.points[0], point]
        };
    activeRef.current = updated;
    setActive(updated);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = activeRef.current;
    activeRef.current = null;
    setActive(null);
    if (!current) return;

    const point = eventToImagePoint(event, true);
    const completed = point && current.tool !== 'point'
      ? { ...current, points: current.tool === 'brush' ? [...current.points, point] : [current.points[0], point] }
      : current;

    if (completed.tool === 'rect') {
      const [a, b] = completed.points;
      if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) {
        setError('矩形选区太小，请拖大一点。');
        return;
      }
    }

    setMarks(previous => [...previous, completed]);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('仅支持 PNG、JPEG 或 WebP。');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSource(reader.result);
        setMarks([]);
        setActive(null);
      }
    };
    reader.onerror = () => setError('图片读取失败。');
    reader.readAsDataURL(file);
  };

  const exportMarkedImage = async () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageReady) throw new Error('图片仍在加载。');

    const output = document.createElement('canvas');
    output.width = image.naturalWidth;
    output.height = image.naturalHeight;
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建图片画布。');
    ctx.drawImage(image, 0, 0);
    const box = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    marks.forEach(mark => drawMark(ctx, mark, box));
    return output.toDataURL('image/png');
  };

  const buildAnnotations = (): SeedreamEditAnnotation[] => {
    return marks.flatMap(mark => {
      if (mark.tool === 'point') return [pointToAnnotation(mark.points[0])];
      if (mark.tool === 'rect') return [rectToAnnotation(mark.points[0], mark.points[mark.points.length - 1])];
      return [];
    }).slice(0, 20);
  };

  const handleGenerate = async () => {
    if (!sourceNodeId) return;
    if (!prompt.trim()) {
      setError('请输入编辑提示词。');
      return;
    }
    if (!source || !imageReady) {
      setError('请先提供一张图片。');
      return;
    }
    if (!marks.length) {
      setError('请先在图片上添加标注。');
      return;
    }

    setBusy(true);
    setError('');
    let outputNodeId = '';
    try {
      const annotations = mode === 'coordinate' ? buildAnnotations() : [];
      if (mode === 'coordinate' && annotations.length === 0) {
        throw new Error('坐标定位模式需要点标记或矩形选区。');
      }
      const inputImage = mode === 'coordinate' ? source : await exportMarkedImage();
      outputNodeId = onGenerationStarted({
        sourceNodeId,
        prompt: prompt.trim(),
        aspectRatio,
        resolution
      });
      const resultUrl = await generateSeedreamEdit({
        prompt: prompt.trim(),
        image: inputImage,
        edit: mode === 'coordinate' ? { mode, annotations } : { mode },
        size: { mode: 'resolution', value: resolution, ratio: aspectRatio === 'Auto' ? '1:1' : aspectRatio },
        outputFormat,
        watermark,
        nodeId: outputNodeId
      });
      onGenerationCompleted({
        outputNodeId,
        sourceNodeId,
        resultUrl,
        prompt: prompt.trim(),
        aspectRatio,
        resolution
      });
    } catch (generationError) {
      const errorMessage = generationError instanceof Error ? generationError.message : 'Seedream 编辑生成失败。';
      if (outputNodeId) {
        onGenerationFailed({ outputNodeId, errorMessage });
      }
      setError(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] bg-black/90 flex flex-col text-white">
      <div className="h-14 px-5 flex items-center justify-between border-b border-neutral-800">
        <div>
          <div className="text-sm font-semibold">Seedream Interactive Editor</div>
          <div className="text-[11px] text-neutral-500">任意标记 / 坐标定位 · Seedream 5.0 Pro</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 cursor-pointer">
            上传图片
            <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={busy} />
          </label>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-neutral-800 text-neutral-300">×</button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
        <div className="relative bg-[#050505] overflow-hidden">
          {!source && (
            <label className="absolute inset-8 border border-dashed border-neutral-700 rounded-2xl flex flex-col items-center justify-center gap-2 text-neutral-400 cursor-pointer">
              <span className="text-4xl">＋</span>
              <span className="text-sm">上传图片开始交互编辑</span>
              <span className="text-xs text-neutral-600">PNG / JPEG / WebP</span>
              <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={busy} />
            </label>
          )}
          {source && !imageReady && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">图片加载中...</div>
          )}
          <canvas
            ref={canvasRef}
            className="w-full h-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              activeRef.current = null;
              setActive(null);
            }}
          />
          <div className="absolute left-5 top-5 flex gap-2 p-2 rounded-2xl bg-neutral-950/80 border border-neutral-800">
            {visibleTools.map(item => (
              <button
                key={item}
                onClick={() => setTool(item)}
                className={`w-9 h-9 rounded-xl text-sm ${tool === item ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                title={item}
              >
                {item === 'move' ? '✋' : item === 'point' ? '◎' : item === 'rect' ? '□' : item === 'brush' ? '⌁' : '↗'}
              </button>
            ))}
          </div>
          <div className="absolute left-5 bottom-5 flex items-center gap-2 p-2 rounded-2xl bg-neutral-950/80 border border-neutral-800">
            {COLORS.map(item => (
              <button
                key={item}
                onClick={() => setColor(item)}
                className={`w-6 h-6 rounded-full border ${color === item ? 'border-white scale-110' : 'border-neutral-700'}`}
                style={{ backgroundColor: item }}
              />
            ))}
            <input
              type="range"
              min="3"
              max="40"
              value={brushWidth}
              onChange={event => setBrushWidth(Number(event.target.value))}
              className="w-24"
            />
            <button onClick={() => setMarks([])} className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700">清空</button>
            <button
              onClick={() => setMarks(previous => previous.slice(0, -1))}
              disabled={!marks.length}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40"
            >
              撤销标注
            </button>
          </div>
        </div>

        <aside className="p-5 bg-neutral-950 border-l border-neutral-800 overflow-y-auto">
          <div className="space-y-5">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-neutral-500">编辑方式</label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={() => setMode('mark')}
                  className={`rounded-xl px-3 py-3 text-left border ${mode === 'mark' ? 'border-cyan-500 bg-cyan-500/10' : 'border-neutral-800 bg-neutral-900'}`}
                >
                  <div className="text-sm font-semibold">任意标记</div>
                  <div className="text-[11px] text-neutral-500 mt-1">涂鸦、圈选、箭头</div>
                </button>
                <button
                  onClick={() => setMode('coordinate')}
                  className={`rounded-xl px-3 py-3 text-left border ${mode === 'coordinate' ? 'border-cyan-500 bg-cyan-500/10' : 'border-neutral-800 bg-neutral-900'}`}
                >
                  <div className="text-sm font-semibold">坐标定位</div>
                  <div className="text-[11px] text-neutral-500 mt-1">点选、框选</div>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-neutral-500">提示词</label>
              <textarea
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                placeholder="描述你希望在标注区域完成的编辑"
                className="mt-2 w-full h-36 rounded-xl bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-neutral-500">
                清晰度
                <select
                  value={resolution}
                  onChange={event => setResolution(event.target.value === '2K' ? '2K' : '1K')}
                  className="mt-1 w-full rounded-lg bg-neutral-900 border border-neutral-800 px-2 py-2 text-sm text-white"
                >
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                </select>
              </label>
              <label className="text-xs text-neutral-500">
                输出格式
                <select
                  value={outputFormat}
                  onChange={event => setOutputFormat(event.target.value === 'jpeg' ? 'jpeg' : 'png')}
                  className="mt-1 w-full rounded-lg bg-neutral-900 border border-neutral-800 px-2 py-2 text-sm text-white"
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </label>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-neutral-500">图片比例</label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {RATIO_PRESETS.map(item => (
                  <button
                    key={item}
                    onClick={() => setAspectRatio(item)}
                    className={`text-xs rounded-lg px-2 py-2 border ${aspectRatio === item ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200' : 'border-neutral-800 bg-neutral-900 text-neutral-400'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between rounded-xl bg-neutral-900 border border-neutral-800 px-3 py-3 text-sm">
              <span>
                添加水印
                <span className="block text-[11px] text-neutral-500">右下角 AI 生成标识</span>
              </span>
              <input type="checkbox" checked={watermark} onChange={event => setWatermark(event.target.checked)} />
            </label>

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

            <button
              onClick={handleGenerate}
              disabled={busy}
              className="w-full rounded-2xl bg-white text-black py-3 text-sm font-semibold hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Seedream 生成中...' : '生成新 Image Node'}
            </button>
            <p className="text-[11px] leading-5 text-neutral-600">
              生成结果会作为新的 Image 节点创建在原节点右侧，原图节点保持不变，方便回退和对比。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};
