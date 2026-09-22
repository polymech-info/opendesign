import * as fabric from "fabric";
import { applyIconFill, applyIconStroke, isIconObject } from "./tabler-icons";
import { applyRectCornerRadius, readCornerRadius, traceRoundRectXY } from "./image-radius";

export type StylePresetId = "none" | "glass" | "border" | "grade" | "multiply" | "screen";
export type BorderKind = "line" | "rim";

export const STYLE_PRESETS: { id: StylePresetId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "glass", label: "Glass" },
  { id: "border", label: "Border" },
];

export const IMAGE_STYLE_PRESETS: { id: StylePresetId; label: string; swatch?: string }[] = [
  { id: "none", label: "None" },
  { id: "glass", label: "Glass" },
  { id: "border", label: "Border" },
  {
    id: "grade",
    label: "Grade",
    swatch: "linear-gradient(180deg, rgba(255,244,214,0.45), rgba(30,58,95,0.55))",
  },
  {
    id: "multiply",
    label: "Multiply",
    swatch: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)",
  },
  {
    id: "screen",
    label: "Screen",
    swatch: "linear-gradient(180deg, #cbd5e1 0%, #334155 100%)",
  },
];

const IMAGE_BLEND: Record<
  Exclude<StylePresetId, "none" | "glass" | "border">,
  { css: string; blend: GlobalCompositeOperation; opacity: number }
> = {
  grade: {
    css: "linear-gradient(180deg, #FFF4D6 0%, #1E3A5F 100%)",
    blend: "overlay",
    opacity: 0.55,
  },
  multiply: {
    css: "linear-gradient(135deg, #1E3A5F 0%, #0F172A 100%)",
    blend: "multiply",
    opacity: 0.42,
  },
  screen: {
    css: "linear-gradient(180deg, #E2E8F0 0%, #334155 100%)",
    blend: "screen",
    opacity: 0.38,
  },
};

const STYLE_IDS = new Set<StylePresetId>(["none", "glass", "border", "grade", "multiply", "screen"]);

const GLASS = {
  blurPx: 20,
  tint: "#344869",
  tintOpacity: 0.32,
  sheen: 1,
  rimWidthPx: 1.35,
  innerRimWidthPx: 0.75,
  glowBlurPx: 10,
  bloomOpacity: 0.38,
  cornerRadiusPx: 24,
  flareRadiusPx: 18,
  flares: 1,
  saturate: 1.12,
  brightness: 0.96,
} as const;

export type GlassOptions = {
  blur: number;
  tint: string;
  tintOpacity: number;
  sheen: number;
  rim: number;
  bloom: number;
  bloomOpacity: number;
  flares: number;
  opacity: number;
  /** Stable per-object glare / spark placement. */
  flareSeed?: number;
};

export type GlassFlareSpot = {
  x: number;
  y: number;
  scale: number;
  color: string;
  edge: number;
};

export function newGlassFlareSeed() {
  return ((Math.random() * 0x7fffffff) | 1) >>> 0 || 1;
}

function mulberry32(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashFlareSeed(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export function resolveGlassFlareSeed(obj: fabric.FabricObject) {
  const stored = (obj as { _glassOptions?: Partial<GlassOptions> })._glassOptions?.flareSeed;
  if (typeof stored === "number" && Number.isFinite(stored) && stored !== 0) {
    return stored >>> 0 || 1;
  }
  const id = String((obj as { _id?: string; _layerId?: string })._id || (obj as { _layerId?: string })._layerId || "");
  return id ? hashFlareSeed(id) : 1;
}

function pointOnRectEdge(pw: number, ph: number, edge: number, t: number) {
  const x0 = -pw / 2;
  const y0 = -ph / 2;
  const u = Math.min(1, Math.max(0, t));
  switch (edge & 3) {
    case 0:
      return { x: x0 + pw * u, y: y0, edge: 0 };
    case 1:
      return { x: x0 + pw, y: y0 + ph * u, edge: 1 };
    case 2:
      return { x: x0 + pw * u, y: y0 + ph, edge: 2 };
    default:
      return { x: x0, y: y0 + ph * u, edge: 3 };
  }
}

/** Two edge sparks from a seed. Same seed / size always lands in the same spots. */
export function glassFlareLayout(seed: number, pw: number, ph: number, strength: number): GlassFlareSpot[] {
  const rnd = mulberry32(seed >>> 0 || 1);
  const specs = [
    { scale: 1, color: `rgba(255,120,55,${0.8 * strength})` },
    { scale: 0.7, color: `rgba(80,210,255,${0.55 * strength})` },
  ];
  const firstEdge = Math.floor(rnd() * 4);
  return specs.map((spec, i) => {
    const edge = i === 0 ? firstEdge : (firstEdge + 2 + (rnd() < 0.35 ? 1 : 0)) & 3;
    const t = 0.1 + rnd() * 0.8;
    return { ...pointOnRectEdge(pw, ph, edge, t), ...spec };
  });
}

/** Sheen / glare tilt in radians from vertical, derived from the same seed. */
export function glassSheenAngle(seed: number) {
  const rnd = mulberry32((seed >>> 0 || 1) ^ 0x9e3779b9);
  return (rnd() - 0.5) * 0.95;
}

export const DEFAULT_GLASS_OPTIONS: GlassOptions = {
  blur: GLASS.blurPx,
  tint: GLASS.tint,
  tintOpacity: GLASS.tintOpacity,
  sheen: GLASS.sheen,
  rim: GLASS.rimWidthPx,
  bloom: GLASS.glowBlurPx,
  bloomOpacity: GLASS.bloomOpacity,
  flares: GLASS.flares,
  opacity: 1,
};

export type BorderOptions = {
  kind: BorderKind;
  width: number;
  opacity: number;
  color: string;
};

export const DEFAULT_BORDER_OPTIONS: BorderOptions = {
  kind: "line",
  width: 1.5,
  opacity: 1,
  color: "#ffffff",
};

function hexToRgba(hex: string, opacity: number) {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(52, 72, 105, ${opacity})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

type StyleBackup = {
  fill: unknown;
  stroke: unknown;
  strokeWidth: number;
  shadow: fabric.Shadow | string | null;
  objectCaching: boolean;
  rx?: number;
  ry?: number;
};

type StyledObject = fabric.FabricObject & {
  _stylePreset?: StylePresetId;
  _stylePresetBackup?: StyleBackup;
  _glassOptions?: Partial<GlassOptions>;
  _borderOptions?: Partial<BorderOptions>;
  _glassDrawInstalled?: boolean;
  _origRender?: (ctx: CanvasRenderingContext2D) => void;
  rx?: number;
  ry?: number;
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

export function usesOverlayPreset(preset: StylePresetId) {
  return preset === "glass" || preset === "border";
}

type BackdropEntry = {
  canvas: HTMLCanvasElement;
  dirty: boolean;
};

const backdropByCanvas = new WeakMap<fabric.Canvas, BackdropEntry>();
let frostScratch: HTMLCanvasElement | null = null;
let capturingBackdrop = false;

function localRadii(obj: fabric.FabricObject) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  if (obj instanceof fabric.Circle) {
    return { rx: w / 2, ry: h / 2 };
  }
  const visual = readCornerRadius(obj);
  const sx = Math.abs(obj.scaleX || 1) || 1;
  const sy = Math.abs(obj.scaleY || 1) || 1;
  if (visual > 0) {
    return {
      rx: Math.min(visual / sx, w / 2),
      ry: Math.min(visual / sy, h / 2),
    };
  }
  if (obj instanceof fabric.Rect) {
    return {
      rx: Math.min(obj.rx || 0, w / 2),
      ry: Math.min(obj.ry || 0, h / 2),
    };
  }
  return { rx: 0, ry: 0 };
}

function traceObjectShape(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  const { rx, ry } = localRadii(obj);
  ctx.beginPath();
  traceRoundRectXY(ctx, -w / 2, -h / 2, w, h, rx, ry);
}

function withUniformSpace(
  ctx: CanvasRenderingContext2D,
  obj: fabric.FabricObject,
  draw: (pw: number, ph: number, radius: number) => void
) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  const sx = Math.abs(obj.scaleX || 1) || 1;
  const sy = Math.abs(obj.scaleY || 1) || 1;
  ctx.save();
  ctx.scale(1 / sx, 1 / sy);
  const pw = w * sx;
  const ph = h * sy;
  const radius =
    obj instanceof fabric.Circle ? Math.min(pw, ph) / 2 : readCornerRadius(obj);
  draw(pw, ph, radius);
  ctx.restore();
}

function traceUniformRoundRect(
  ctx: CanvasRenderingContext2D,
  obj: fabric.FabricObject,
  pw: number,
  ph: number,
  radius: number,
  inflate = 0
) {
  const w = Math.max(1, pw + inflate * 2);
  const h = Math.max(1, ph + inflate * 2);
  const x = -w / 2;
  const y = -h / 2;
  if (obj instanceof fabric.Circle) {
    ctx.ellipse(0, 0, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
    return;
  }
  const r = Math.max(0, radius + inflate);
  traceRoundRectXY(ctx, x, y, w, h, r, r);
}

export function readGlassOptions(obj: fabric.FabricObject): GlassOptions {
  const stored = (obj as StyledObject)._glassOptions;
  return { ...DEFAULT_GLASS_OPTIONS, ...stored };
}

export function applyGlassOptions(obj: fabric.FabricObject, partial: Partial<GlassOptions>) {
  const merged = { ...readGlassOptions(obj), ...partial };
  merged.opacity = clamp01(merged.opacity);
  (obj as StyledObject)._glassOptions = merged;
  // Tint is an overlay for the glass draw pass. Only push it into fill when the
  // caller is actually editing tint — never when just enabling glass.
  if (
    !(obj instanceof fabric.FabricImage) &&
    ("tint" in partial || "tintOpacity" in partial)
  ) {
    obj.set({ fill: hexToRgba(merged.tint, merged.tintOpacity) });
  }
  obj.dirty = true;
}

export function readBorderOptions(obj: fabric.FabricObject): BorderOptions {
  const stored = (obj as StyledObject)._borderOptions;
  const kind = stored?.kind === "rim" ? "rim" : "line";
  return {
    ...DEFAULT_BORDER_OPTIONS,
    ...stored,
    kind,
    width: Math.max(0, stored?.width ?? DEFAULT_BORDER_OPTIONS.width),
    opacity: clamp01(stored?.opacity ?? DEFAULT_BORDER_OPTIONS.opacity),
    color: stored?.color || DEFAULT_BORDER_OPTIONS.color,
  };
}

export function applyBorderOptions(obj: fabric.FabricObject, partial: Partial<BorderOptions>) {
  const merged = { ...readBorderOptions(obj), ...partial };
  if (merged.kind !== "rim") merged.kind = "line";
  merged.width = Math.max(0, merged.width);
  merged.opacity = clamp01(merged.opacity);
  (obj as StyledObject)._borderOptions = merged;
  obj.dirty = true;
}

export function readStylePreset(obj: fabric.FabricObject): StylePresetId {
  const id = (obj as StyledObject)._stylePreset;
  return id && STYLE_IDS.has(id) ? id : "none";
}

function isAnnotation(obj: fabric.FabricObject) {
  return obj instanceof fabric.Textbox || obj instanceof fabric.IText;
}

export function invalidateGlassBackdrop(canvas: fabric.Canvas | null | undefined) {
  if (!canvas) return;
  const entry = backdropByCanvas.get(canvas);
  if (entry) entry.dirty = true;
}

export function noteGlassBackdropSourceChange(obj: fabric.FabricObject | undefined) {
  if (!obj?.canvas) return;
  if (readStylePreset(obj) === "glass") return;
  invalidateGlassBackdrop(obj.canvas);
}

function isMidGroupRender(obj: fabric.FabricObject) {
  return !!(obj as fabric.Group & { _transformDone?: boolean })._transformDone;
}

function skipBackdropRender(obj: fabric.FabricObject, from: fabric.FabricObject) {
  if (!obj.visible) return true;
  if (readStylePreset(obj) === "glass" || isAnnotation(obj)) return true;
  // Re-entering a group that is currently drawing clobbers `_transformDone` and
  // the remaining children get a second group transform (they jump the frame).
  if (isMidGroupRender(obj)) return true;
  let parent: fabric.FabricObject | undefined = from;
  while (parent) {
    if (parent === obj) return true;
    parent = parent.group;
  }
  return false;
}

function captureGlassBackdrop(canvas: fabric.Canvas, from: fabric.FabricObject): HTMLCanvasElement | null {
  if (capturingBackdrop) return null;
  const src = canvas.lowerCanvasEl;
  if (!src || src.width < 2 || src.height < 2) return null;

  let entry = backdropByCanvas.get(canvas);
  if (!entry) {
    entry = { canvas: document.createElement("canvas"), dirty: true };
    backdropByCanvas.set(canvas, entry);
  }
  if (entry.canvas.width !== src.width || entry.canvas.height !== src.height) {
    entry.canvas.width = src.width;
    entry.canvas.height = src.height;
    entry.dirty = true;
  }
  if (!entry.dirty) return entry.canvas;

  const ctx = entry.canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);

  const vpt = canvas.viewportTransform;
  if (vpt) ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);

  capturingBackdrop = true;
  try {
    const renderBg = (canvas as unknown as { _renderBackground: (c: CanvasRenderingContext2D) => void })
      ._renderBackground;
    if (typeof renderBg === "function") {
      renderBg.call(canvas, ctx);
    }

    for (const obj of canvas.getObjects()) {
      if (skipBackdropRender(obj, from)) continue;
      obj.render(ctx);
    }
  } finally {
    capturingBackdrop = false;
  }

  entry.dirty = false;
  return entry.canvas;
}

function getFrostScratch(w: number, h: number) {
  if (!frostScratch) frostScratch = document.createElement("canvas");
  if (frostScratch.width !== w) frostScratch.width = Math.max(1, w);
  if (frostScratch.height !== h) frostScratch.height = Math.max(1, h);
  return frostScratch;
}

function mapLocalToDevice(ctm: DOMMatrix, x: number, y: number) {
  return { x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f };
}

function deviceBounds(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject, pad: number) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  const ctm = ctx.getTransform();
  const corners = [
    mapLocalToDevice(ctm, -w / 2, -h / 2),
    mapLocalToDevice(ctm, w / 2, -h / 2),
    mapLocalToDevice(ctm, w / 2, h / 2),
    mapLocalToDevice(ctm, -w / 2, h / 2),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    left: Math.min(...xs) - pad,
    top: Math.min(...ys) - pad,
    right: Math.max(...xs) + pad,
    bottom: Math.max(...ys) + pad,
  };
}

function drawBackdrop(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject) {
  const canvas = obj.canvas;
  if (!canvas) return;
  const src = captureGlassBackdrop(canvas, obj);
  if (!src) return;
  const opts = readGlassOptions(obj);
  if (opts.blur <= 0) return;

  const pad = Math.max(24, opts.blur * 2);
  const box = deviceBounds(ctx, obj, pad);
  const sx = Math.max(0, Math.floor(box.left));
  const sy = Math.max(0, Math.floor(box.top));
  const sw = Math.max(1, Math.min(src.width - sx, Math.ceil(box.right - sx)));
  const sh = Math.max(1, Math.min(src.height - sy, Math.ceil(box.bottom - sy)));
  if (sw < 2 || sh < 2) return;

  try {
    const scratch = getFrostScratch(sw, sh);
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sw, sh);
    sctx.filter = `blur(${opts.blur}px) saturate(${GLASS.saturate}) brightness(${GLASS.brightness})`;
    sctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    sctx.filter = "none";

    ctx.save();
    traceObjectShape(ctx, obj);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch, sx, sy);
    ctx.restore();
  } catch {
    // missing region — tint-only fallback still reads as acrylic
  }
}

function drawSurface(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  const sheen = readGlassOptions(obj).sheen;
  const ang = glassSheenAngle(resolveGlassFlareSeed(obj));
  ctx.save();
  traceObjectShape(ctx, obj);
  ctx.closePath();
  ctx.clip();
  const x = Math.sin(ang) * (h / 2);
  const y = Math.cos(ang) * (h / 2);
  const g = ctx.createLinearGradient(-x, -y, x, y);
  g.addColorStop(0.0, `rgba(255,255,255,${0.13 * sheen})`);
  g.addColorStop(0.15, `rgba(230,245,255,${0.055 * sheen})`);
  g.addColorStop(0.55, `rgba(150,190,230,${0.015 * sheen})`);
  g.addColorStop(1.0, `rgba(20,50,90,${0.08 * sheen})`);
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawBloom(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject) {
  const opts = readGlassOptions(obj);
  if (opts.bloom <= 0 || opts.bloomOpacity <= 0) return;
  withUniformSpace(ctx, obj, (pw, ph, radius) => {
    ctx.beginPath();
    traceUniformRoundRect(ctx, obj, pw, ph, radius, 1);
    ctx.strokeStyle = `rgba(80, 190, 255, ${opts.bloomOpacity})`;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(30, 170, 255, ${Math.min(1, opts.bloomOpacity * 2)})`;
    ctx.shadowBlur = opts.bloom;
    ctx.stroke();
  });
}

function drawRim(
  ctx: CanvasRenderingContext2D,
  obj: fabric.FabricObject,
  rimW = readGlassOptions(obj).rim
) {
  if (rimW <= 0) return;

  withUniformSpace(ctx, obj, (pw, ph, radius) => {
    const x = -pw / 2;
    const y = -ph / 2;
    const r = Math.min(radius, pw / 2, ph / 2);
    const rim = ctx.createLinearGradient(x, y, x + pw, y + ph);
    rim.addColorStop(0.0, "rgba(255,255,255,0.95)");
    rim.addColorStop(0.18, "rgba(190,235,255,0.92)");
    rim.addColorStop(0.48, "rgba(70,175,255,0.86)");
    rim.addColorStop(0.8, "rgba(120,205,255,0.90)");
    rim.addColorStop(1.0, "rgba(235,250,255,0.92)");

    ctx.beginPath();
    traceUniformRoundRect(ctx, obj, pw, ph, r, 0.3);
    ctx.lineWidth = rimW;
    ctx.lineJoin = "round";
    ctx.strokeStyle = rim;
    ctx.stroke();

    ctx.beginPath();
    traceUniformRoundRect(ctx, obj, pw, ph, r, -2);
    ctx.lineWidth = Math.max(0.4, rimW * 0.55);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + r, y + 1);
    ctx.lineTo(x + pw * 0.47, y + 1);
    ctx.moveTo(x + 1, y + r);
    ctx.lineTo(x + 1, y + ph * 0.3);
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    ctx.lineWidth = Math.max(0.6, rimW * 0.75);
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(180,235,255,0.8)";
    ctx.shadowBlur = 4;
    ctx.stroke();
  });
}

function rgbaParts(color: string): { rgb: string; alpha: number } {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return { rgb: "255, 120, 55", alpha: 0.8 };
  return { rgb: `${m[1]}, ${m[2]}, ${m[3]}`, alpha: m[4] !== undefined ? Number(m[4]) : 1 };
}

function drawEdgeFlare(
  ctx: CanvasRenderingContext2D,
  _obj: fabric.FabricObject,
  cx: number,
  cy: number,
  radius: number,
  color: string
) {
  if (radius <= 1) return;
  const { rgb, alpha } = rgbaParts(color);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, `rgba(${rgb}, ${Math.min(1, alpha)})`);
  g.addColorStop(0.22, `rgba(${rgb}, ${alpha * 0.45})`);
  g.addColorStop(0.55, `rgba(${rgb}, ${alpha * 0.12})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFlares(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject) {
  const strength = readGlassOptions(obj).flares;
  if (strength <= 0) return;
  const seed = resolveGlassFlareSeed(obj);
  withUniformSpace(ctx, obj, (pw, ph) => {
    const radius = GLASS.flareRadiusPx * strength;
    for (const spot of glassFlareLayout(seed, pw, ph, strength)) {
      drawEdgeFlare(ctx, obj, spot.x, spot.y, radius * spot.scale, spot.color);
    }
  });
}

function drawLineBorder(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject, opts: BorderOptions) {
  if (opts.width <= 0 || opts.opacity <= 0) return;
  withUniformSpace(ctx, obj, (pw, ph, radius) => {
    ctx.beginPath();
    traceUniformRoundRect(ctx, obj, pw, ph, radius, 0);
    ctx.lineWidth = opts.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = hexToRgba(opts.color, 1);
    ctx.stroke();
  });
}

function drawBorderOverlay(ctx: CanvasRenderingContext2D, obj: fabric.FabricObject) {
  const opts = readBorderOptions(obj);
  if (opts.opacity <= 0) return;
  ctx.globalAlpha *= opts.opacity;
  if (opts.kind === "rim") drawRim(ctx, obj, opts.width);
  else drawLineBorder(ctx, obj, opts);
}

function paintLocalGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  w: number,
  h: number
) {
  const angleMatch = css.match(/linear-gradient\(\s*([-\d.]+)deg/i);
  const deg = angleMatch ? parseFloat(angleMatch[1]) : 180;
  const stops = [...css.matchAll(/#([0-9a-f]{3,8})(?:\s+([\d.]+)%)?/gi)];
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const g = ctx.createLinearGradient(-dx * half, -dy * half, dx * half, dy * half);
  if (stops.length === 0) {
    g.addColorStop(0, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(15,23,42,0.45)");
  } else {
    stops.forEach((m, i, arr) => {
      g.addColorStop(
        m[2] != null ? parseFloat(m[2]) / 100 : i / Math.max(arr.length - 1, 1),
        `#${m[1]}`
      );
    });
  }
  return g;
}

function drawImageBlend(
  ctx: CanvasRenderingContext2D,
  obj: fabric.FabricObject,
  spec: { css: string; blend: GlobalCompositeOperation; opacity: number }
) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  traceObjectShape(ctx, obj);
  ctx.clip();
  ctx.globalCompositeOperation = spec.blend;
  ctx.globalAlpha = spec.opacity;
  ctx.fillStyle = paintLocalGradient(ctx, spec.css, w, h);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function installGlassDraw(obj: fabric.FabricObject) {
  const styled = obj as StyledObject;
  if (styled._glassDrawInstalled) return;
  styled._origRender = obj.render.bind(obj);
  styled._glassDrawInstalled = true;
  obj.render = function (this: fabric.FabricObject, ctx: CanvasRenderingContext2D) {
    const orig = (this as StyledObject)._origRender;
    if (!orig) return;
    const preset = readStylePreset(this);
    if (capturingBackdrop || this.isNotVisible() || preset === "none") {
      orig.call(this, ctx);
      return;
    }
    if (preset === "border") {
      orig.call(this, ctx);
      ctx.save();
      this.transform(ctx);
      this._setOpacity(ctx);
      drawBorderOverlay(ctx, this);
      ctx.restore();
      return;
    }
    if (preset !== "glass") {
      orig.call(this, ctx);
      const blend = IMAGE_BLEND[preset as keyof typeof IMAGE_BLEND];
      if (this instanceof fabric.FabricImage && blend) {
        ctx.save();
        this.transform(ctx);
        this._setOpacity(ctx);
        drawImageBlend(ctx, this, blend);
        ctx.restore();
      }
      return;
    }
    const isImage = this instanceof fabric.FabricImage;
    const glassAlpha = clamp01(readGlassOptions(this).opacity);
    ctx.save();
    this.transform(ctx);
    this._setOpacity(ctx);
    ctx.globalAlpha *= glassAlpha;
    if (!isImage) drawBackdrop(ctx, this);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= glassAlpha;
    orig.call(this, ctx);
    ctx.restore();
    ctx.save();
    this.transform(ctx);
    this._setOpacity(ctx);
    ctx.globalAlpha *= glassAlpha;
    if (!isImage) drawSurface(ctx, this);
    drawBloom(ctx, this);
    drawRim(ctx, this);
    drawFlares(ctx, this);
    ctx.restore();
  };
}

function takeOverlayBackup(obj: fabric.FabricObject) {
  const styled = obj as StyledObject;
  if (styled._stylePresetBackup) return;
  styled._stylePresetBackup = {
    fill: obj.fill,
    stroke: obj.stroke,
    strokeWidth: obj.strokeWidth || 0,
    shadow: obj.shadow ?? null,
    objectCaching: obj.objectCaching,
    rx: obj instanceof fabric.Rect ? obj.rx : undefined,
    ry: obj instanceof fabric.Rect ? obj.ry : undefined,
  };
}

function restoreOverlayBackup(obj: fabric.FabricObject) {
  const styled = obj as StyledObject;
  const backup = styled._stylePresetBackup;
  styled._stylePreset = "none";
  if (backup) {
    obj.set({
      fill: backup.fill as fabric.FabricObject["fill"],
      stroke: backup.stroke as fabric.FabricObject["stroke"],
      strokeWidth: backup.strokeWidth,
      shadow: backup.shadow as fabric.FabricObject["shadow"],
      objectCaching: backup.objectCaching,
    });
    if (obj instanceof fabric.Rect) {
      const stored = (obj as { _cornerRadius?: number })._cornerRadius;
      if (typeof stored === "number") applyRectCornerRadius(obj, stored);
      else if (backup.rx != null) obj.set({ rx: backup.rx, ry: backup.ry ?? backup.rx });
    }
    if (isIconObject(obj)) {
      if (typeof backup.fill === "string") applyIconFill(obj, backup.fill);
      applyIconStroke(obj, backup.stroke, backup.strokeWidth);
    }
  }
  styled._stylePresetBackup = undefined;
}

function seedBorderOptions(obj: fabric.FabricObject) {
  if ((obj as StyledObject)._borderOptions) return;
  const stroke = typeof obj.stroke === "string" ? obj.stroke : "";
  const hex = stroke.startsWith("#") && stroke.length >= 7 ? stroke.slice(0, 7) : DEFAULT_BORDER_OPTIONS.color;
  const width = obj.strokeWidth && obj.strokeWidth > 0 ? obj.strokeWidth : DEFAULT_BORDER_OPTIONS.width;
  (obj as StyledObject)._borderOptions = { ...DEFAULT_BORDER_OPTIONS, color: hex, width };
}

export function applyStylePreset(obj: fabric.FabricObject, preset: StylePresetId) {
  const styled = obj as StyledObject;
  if (!STYLE_IDS.has(preset)) preset = "none";
  installGlassDraw(obj);
  invalidateGlassBackdrop(obj.canvas);

  const prev = readStylePreset(obj);
  if (prev !== preset && usesOverlayPreset(prev)) {
    restoreOverlayBackup(obj);
  }

  if (preset === "none") {
    restoreOverlayBackup(obj);
    obj.dirty = true;
    return;
  }

  if (preset === "border") {
    takeOverlayBackup(obj);
    seedBorderOptions(obj);
    styled._stylePreset = "border";
    obj.set({ stroke: "", strokeWidth: 0, objectCaching: false });
    if (isIconObject(obj)) applyIconStroke(obj, "", 0);
    obj.dirty = true;
    return;
  }

  if (preset !== "glass") {
    styled._stylePreset = preset;
    obj.set({ objectCaching: false });
    obj.dirty = true;
    return;
  }

  takeOverlayBackup(obj);
  styled._stylePreset = "glass";
  if (!(obj as StyledObject)._glassOptions) {
    (obj as StyledObject)._glassOptions = { ...DEFAULT_GLASS_OPTIONS, flareSeed: newGlassFlareSeed() };
  } else if (!styled._glassOptions?.flareSeed) {
    applyGlassOptions(obj, { flareSeed: newGlassFlareSeed() });
  }
  obj.set({ objectCaching: false });
  if (obj instanceof fabric.Rect) {
    applyRectCornerRadius(obj, Math.max(readCornerRadius(obj), GLASS.cornerRadiusPx));
  }
  obj.dirty = true;
}

export function restoreStylePresets(root: fabric.StaticCanvas | fabric.Group) {
  if (root instanceof fabric.Canvas) invalidateGlassBackdrop(root);
  for (const obj of root.getObjects()) {
    if (readStylePreset(obj) !== "none") {
      installGlassDraw(obj);
      obj.objectCaching = false;
      obj.dirty = true;
    } else {
      ensureStyleRenderer(obj);
    }
    if (obj instanceof fabric.Group) restoreStylePresets(obj);
  }
}

export function ensureStyleRenderer(obj: fabric.FabricObject) {
  if (readStylePreset(obj) !== "none") installGlassDraw(obj);
}
