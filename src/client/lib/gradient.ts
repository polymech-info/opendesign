import * as fabric from "fabric";
import { ensurePageThemeLayer, pageThemeLayer, stackPageBackgroundLayers } from "./background-image";

export type ColorSpace = "srgb" | "oklch" | "hsl";
export type GradientKind = "linear" | "bezier" | "cycle" | "ripple";
export type GradientRole = "fill" | "mask";

export type GradientStop = {
  offset: number;
  hex: string;
  alpha: number;
};

export type Vec2 = { x: number; y: number };

export type BezierAxis = {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
};

export type GradientDef = {
  id: string;
  name: string;
  kind: GradientKind;
  space: ColorSpace;
  role?: GradientRole;
  stops: GradientStop[];
  angle: number;
  origin: Vec2;
  scale: number;
  cycles: number;
  curve: BezierAxis;
};

export const COLOR_SPACES: { id: ColorSpace; label: string }[] = [
  { id: "srgb", label: "sRGB" },
  { id: "oklch", label: "OKLCH" },
  { id: "hsl", label: "HSL" },
];

export const GRADIENT_KINDS: { id: GradientKind; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "bezier", label: "Bezier" },
  { id: "cycle", label: "Cycle" },
  { id: "ripple", label: "Ripple" },
];

const LIBRARY_KEY = "opendesign.gradients";
export const GRADIENT_LIBRARY_EVENT = "opend-gradients-changed";
const MASKED = new WeakSet<fabric.FabricObject>();
const MASK_BUFFERS = new WeakMap<fabric.FabricObject, HTMLCanvasElement>();
const MASK_TILES = new WeakMap<fabric.FabricObject, { key: string; tile: HTMLCanvasElement }>();

export const DEFAULT_CURVE: BezierAxis = {
  p0: { x: 0.12, y: 0.82 },
  c1: { x: 0.32, y: 0.18 },
  c2: { x: 0.68, y: 0.18 },
  p1: { x: 0.88, y: 0.82 },
};

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function newGradientId() {
  return `g_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function defaultGradient(kind: GradientKind = "linear"): GradientDef {
  return {
    id: newGradientId(),
    name: "",
    kind,
    space: "oklch",
    stops: [
      { offset: 0, hex: "#667eea", alpha: 1 },
      { offset: 1, hex: "#764ba2", alpha: 1 },
    ],
    angle: 135,
    origin: { x: 0.5, y: 0.5 },
    scale: 0.72,
    cycles: 3,
    curve: cloneCurve(DEFAULT_CURVE),
  };
}

export function cloneCurve(curve: BezierAxis): BezierAxis {
  return {
    p0: { ...curve.p0 },
    c1: { ...curve.c1 },
    c2: { ...curve.c2 },
    p1: { ...curve.p1 },
  };
}

export function cloneGradient(def: GradientDef): GradientDef {
  return {
    ...def,
    id: def.id,
    stops: def.stops.map((s) => ({ ...s })),
    origin: { ...def.origin },
    curve: cloneCurve(def.curve),
  };
}

export function parseCssLinear(css: string): GradientDef {
  const angleMatch = css.match(/linear-gradient\(\s*([-\d.]+)deg/i);
  const rawStops = [...css.matchAll(/#([0-9a-f]{3,8})(?:\s+([\d.]+)%)?/gi)];
  const stops: GradientStop[] =
    rawStops.length > 0
      ? rawStops.map((m, i, arr) => {
          const hex = normalizeHex(`#${m[1]}`);
          return {
            offset: m[2] != null ? clamp01(parseFloat(m[2]) / 100) : i / Math.max(arr.length - 1, 1),
            hex: hex.hex,
            alpha: hex.alpha,
          };
        })
      : defaultGradient().stops;
  const base = defaultGradient("linear");
  base.angle = angleMatch ? parseFloat(angleMatch[1]) : 135;
  base.stops = stops;
  base.space = "srgb";
  base.id = `preset_${hashCss(css)}`;
  return base;
}

export function gradientCssPreview(def: GradientDef): string {
  const stops = [...def.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${stopCss(s)} ${Math.round(s.offset * 100)}%`)
    .join(", ");
  if (def.kind === "cycle") {
    return `radial-gradient(circle at ${pct(def.origin.x)} ${pct(def.origin.y)}, ${stops})`;
  }
  if (def.kind === "ripple") {
    return `repeating-radial-gradient(circle at ${pct(def.origin.x)} ${pct(def.origin.y)}, ${stops})`;
  }
  if (def.kind === "bezier") {
    const deg = Math.atan2(def.curve.p1.y - def.curve.p0.y, def.curve.p1.x - def.curve.p0.x);
    return `linear-gradient(${((deg * 180) / Math.PI + 90).toFixed(1)}deg, ${stops})`;
  }
  return `linear-gradient(${def.angle}deg, ${stops})`;
}

export function stopCss(stop: GradientStop): string {
  const { r, g, b } = hexToRgb(stop.hex);
  return `rgba(${r},${g},${b},${clamp01(stop.alpha).toFixed(3)})`;
}

export function normalizeHex(raw: string): { hex: string; alpha: number } {
  const value = raw.replace("#", "").trim();
  if (value.length === 3 || value.length === 4) {
    const r = value[0] + value[0];
    const g = value[1] + value[1];
    const b = value[2] + value[2];
    const a = value.length === 4 ? parseInt(value[3] + value[3], 16) / 255 : 1;
    return { hex: `#${r}${g}${b}`.toLowerCase(), alpha: a };
  }
  const hex = `#${value.slice(0, 6).padEnd(6, "0")}`.toLowerCase();
  const alpha = value.length >= 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
  return { hex, alpha };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(normalizeHex(hex).hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export type SampledStop = { offset: number; r: number; g: number; b: number; a: number };

export function expandStops(def: GradientDef, steps = 24): SampledStop[] {
  const ordered = [...def.stops].sort((a, b) => a.offset - b.offset);
  if (ordered.length === 0) return [{ offset: 0, r: 0, g: 0, b: 0, a: 1 }];
  if (ordered.length === 1 || def.space === "srgb") {
    return ordered.map((s) => {
      const rgb = hexToRgb(s.hex);
      return { offset: s.offset, r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(s.alpha) };
    });
  }
  const out: SampledStop[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const span = Math.max(1, Math.round(steps * Math.max(0.08, b.offset - a.offset)));
    for (let s = 0; s < span; s++) {
      const t = s / span;
      out.push({ offset: a.offset + (b.offset - a.offset) * t, ...mixStops(a, b, t, def.space) });
    }
  }
  const last = ordered[ordered.length - 1];
  const rgb = hexToRgb(last.hex);
  out.push({ offset: last.offset, r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(last.alpha) });
  return out;
}

export function sampleStops(stops: SampledStop[], t: number): SampledStop {
  const x = clamp01(t);
  if (stops.length === 1) return stops[0];
  if (x <= stops[0].offset) return stops[0];
  if (x >= stops[stops.length - 1].offset) return stops[stops.length - 1];
  let i = 1;
  while (i < stops.length && stops[i].offset < x) i += 1;
  const a = stops[i - 1];
  const b = stops[i];
  const u = (x - a.offset) / Math.max(b.offset - a.offset, 1e-6);
  return {
    offset: x,
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
    a: a.a + (b.a - a.a) * u,
  };
}

export function sampleT(def: GradientDef, u: number, v: number): number {
  if (def.kind === "cycle" || def.kind === "ripple") {
    const dx = u - def.origin.x;
    const dy = v - def.origin.y;
    const dist = Math.hypot(dx, dy) / Math.max(def.scale, 0.04);
    if (def.kind === "ripple") {
      const wrapped = dist * Math.max(def.cycles, 0.25);
      return wrapped - Math.floor(wrapped);
    }
    return clamp01(dist);
  }
  if (def.kind === "bezier") {
    return nearestBezierT(def.curve, u, v);
  }
  const rad = (def.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const px = u - 0.5;
  const py = v - 0.5;
  const proj = px * dx + py * dy;
  const half = (Math.abs(dx) + Math.abs(dy)) / 2;
  return clamp01((proj + half) / Math.max(half * 2, 1e-6));
}

export function bezierPoint(curve: BezierAxis, t: number): Vec2 {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * curve.p0.x + 3 * uu * t * curve.c1.x + 3 * u * tt * curve.c2.x + tt * t * curve.p1.x,
    y: uu * u * curve.p0.y + 3 * uu * t * curve.c1.y + 3 * u * tt * curve.c2.y + tt * t * curve.p1.y,
  };
}

export function nearestBezierT(curve: BezierAxis, x: number, y: number, samples = 36): number {
  let bestT = 0;
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = bezierPoint(curve, t);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  return bestT;
}

export function paintGradient(
  ctx: CanvasRenderingContext2D,
  def: GradientDef,
  width: number,
  height: number,
  asMask = false
) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const stops = expandStops(def, 20);
  const data = ctx.createImageData(w, h);
  const pixels = data.data;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const c = sampleStops(stops, sampleT(def, u, v));
      const i = (y * w + x) * 4;
      if (asMask) {
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(clamp01(c.a) * 255);
      } else {
        pixels[i] = Math.round(c.r);
        pixels[i + 1] = Math.round(c.g);
        pixels[i + 2] = Math.round(c.b);
        pixels[i + 3] = Math.round(clamp01(c.a) * 255);
      }
    }
  }
  ctx.putImageData(data, 0, 0);
}

export function rasterGradient(def: GradientDef, width: number, height: number, asMask = false): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const long = Math.max(width, height);
  const scale = long > 256 ? 256 / long : 1;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) paintGradient(ctx, def, canvas.width, canvas.height, asMask);
  return canvas;
}

export function gradientToFabricFill(obj: fabric.FabricObject, def: GradientDef) {
  const w = Math.max(8, obj.width || 100);
  const h = Math.max(8, obj.height || 100);
  if (def.kind === "linear") return cssLinearToNative(def, w, h);
  if (def.kind === "cycle") return cycleToNative(def, w, h);
  const tile = rasterGradient(def, w, h, false);
  return new fabric.Pattern({
    source: tile,
    repeat: "no-repeat",
    patternTransform: [w / tile.width, 0, 0, h / tile.height, 0, 0],
  });
}

export function readObjectGradient(obj: fabric.FabricObject): GradientDef | null {
  const raw = (obj as { _gradient?: GradientDef })._gradient;
  return raw && typeof raw === "object" ? sanitizeGradient(raw) : null;
}

export function readObjectGradientMask(obj: fabric.FabricObject): GradientDef | null {
  const raw = (obj as { _gradientMask?: GradientDef | null })._gradientMask;
  return raw && typeof raw === "object" ? sanitizeGradient(raw) : null;
}

export function withGradientRole(def: GradientDef, role: GradientRole): GradientDef {
  return { ...cloneGradient(def), role };
}

export function editorStateForObject(
  obj: fabric.FabricObject | null,
  fallback: GradientDef,
  prefer?: GradientRole
): { def: GradientDef; role: GradientRole } {
  const fill = obj ? readObjectGradient(obj) : null;
  const mask = obj ? readObjectGradientMask(obj) : null;
  if (prefer === "mask") {
    return { def: cloneGradient(mask || fill || fallback), role: "mask" };
  }
  if (prefer === "fill") {
    return { def: cloneGradient(fill || fallback), role: "fill" };
  }
  if (mask && (mask.role === "mask" || !fill)) {
    return { def: cloneGradient(mask), role: "mask" };
  }
  if (fill) return { def: cloneGradient(fill), role: fill.role === "mask" ? "fill" : fill.role || "fill" };
  return { def: cloneGradient(fallback), role: prefer || "fill" };
}

export function edgeFadeGradient(): GradientDef {
  return sanitizeGradient({
    id: "preset_edge_fade",
    name: "Edge fade",
    kind: "cycle",
    space: "srgb",
    role: "mask",
    origin: { x: 0.5, y: 0.5 },
    scale: 0.72,
    stops: [
      { offset: 0, hex: "#ffffff", alpha: 1 },
      { offset: 0.55, hex: "#ffffff", alpha: 1 },
      { offset: 1, hex: "#ffffff", alpha: 0 },
    ],
  });
}

/** Horizontal mask: fade the left and right ~20%, stay opaque in the middle. */
export function sideFadeGradient(): GradientDef {
  return sanitizeGradient({
    id: "preset_side_fade",
    name: "Sides fade",
    kind: "linear",
    space: "srgb",
    role: "mask",
    angle: 90,
    stops: [
      { offset: 0, hex: "#ffffff", alpha: 0 },
      { offset: 0.2, hex: "#ffffff", alpha: 1 },
      { offset: 0.8, hex: "#ffffff", alpha: 1 },
      { offset: 1, hex: "#ffffff", alpha: 0 },
    ],
  });
}

export function maskFadePresets(): GradientDef[] {
  return [edgeFadeGradient(), sideFadeGradient()];
}

export function reverseGradientStops(def: GradientDef): GradientDef {
  const next = cloneGradient(def);
  next.stops = next.stops
    .map((stop) => ({ ...stop, offset: 1 - stop.offset }))
    .sort((a, b) => a.offset - b.offset);
  return next;
}

export function stringifyGradient(def: GradientDef | null | undefined): string {
  if (!def) return "";
  return JSON.stringify(sanitizeGradient(def));
}

export function parseStoredGradient(raw: string | undefined): GradientDef | null {
  if (!raw || !raw.trim()) return null;
  try {
    return sanitizeGradient(JSON.parse(raw) as Partial<GradientDef>);
  } catch {
    return null;
  }
}

export function sanitizeGradient(raw: Partial<GradientDef>): GradientDef {
  const base = defaultGradient(raw.kind);
  const stops = Array.isArray(raw.stops)
    ? raw.stops
        .map((s) => ({
          offset: clamp01(Number(s?.offset) || 0),
          hex: normalizeHex(String(s?.hex || "#888888")).hex,
          alpha: clamp01(Number(s?.alpha ?? 1)),
        }))
        .sort((a, b) => a.offset - b.offset)
    : base.stops;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newGradientId(),
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    role: raw.role === "mask" || raw.role === "fill" ? raw.role : undefined,
    kind: GRADIENT_KINDS.some((k) => k.id === raw.kind) ? (raw.kind as GradientKind) : "linear",
    space: COLOR_SPACES.some((s) => s.id === raw.space) ? (raw.space as ColorSpace) : "srgb",
    stops: stops.length ? stops : base.stops,
    angle: Number.isFinite(raw.angle) ? Number(raw.angle) : 135,
    origin: {
      x: clamp01(Number(raw.origin?.x ?? 0.5)),
      y: clamp01(Number(raw.origin?.y ?? 0.5)),
    },
    scale: Math.min(2, Math.max(0.08, Number(raw.scale) || 0.72)),
    cycles: Math.min(12, Math.max(0.25, Number(raw.cycles) || 3)),
    curve: {
      p0: clampVec(raw.curve?.p0, base.curve.p0),
      c1: clampVec(raw.curve?.c1, base.curve.c1),
      c2: clampVec(raw.curve?.c2, base.curve.c2),
      p1: clampVec(raw.curve?.p1, base.curve.p1),
    },
  };
}

export function readPageBackgroundGradient(canvas: fabric.StaticCanvas | fabric.Canvas | null | undefined): GradientDef | null {
  const bg = canvas ? pageThemeLayer(canvas) : null;
  return bg ? readObjectGradient(bg) : null;
}

export function applyPageBackgroundColor(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  color: string,
  width: number,
  height: number
) {
  const bg = ensurePageThemeLayer(canvas, width, height);
  applyObjectGradient(bg, null, "fill");
  bg.set({ fill: color });
  canvas.backgroundColor = color;
  stackPageBackgroundLayers(canvas);
}

export function applyPageBackgroundGradient(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  raw: unknown,
  width: number,
  height: number
) {
  const def = sanitizeGradient(raw as Partial<GradientDef>);
  const stored = withGradientRole(def, "fill");
  const bg = ensurePageThemeLayer(canvas, width, height);
  applyObjectGradient(bg, stored, "fill");
  canvas.backgroundColor = stored.stops[0]?.hex || "#ffffff";
  stackPageBackgroundLayers(canvas);
  return stored;
}

export function applyObjectGradient(obj: fabric.FabricObject, raw: unknown, role: GradientRole) {
  installGradientMaskDraw(obj);
  if (!raw) {
    if (role === "mask") {
      (obj as { _gradientMask?: GradientDef | null })._gradientMask = null;
      obj.dirty = true;
    } else {
      (obj as { _gradient?: GradientDef | null })._gradient = null;
    }
    return;
  }
  const def = sanitizeGradient(raw as Partial<GradientDef>);
  if (role === "mask") {
    (obj as { _gradientMask?: GradientDef })._gradientMask = def;
    MASK_TILES.delete(obj);
    obj.dirty = true;
    return;
  }
  (obj as { _gradient?: GradientDef })._gradient = def;
  obj.set({ fill: gradientToFabricFill(obj, def) as fabric.FabricObject["fill"] });
  obj.dirty = true;
}

export function clearObjectGradient(obj: fabric.FabricObject) {
  (obj as { _gradient?: GradientDef | null })._gradient = null;
}

export function restoreObjectGradients(root: fabric.StaticCanvas | fabric.Group) {
  for (const obj of root.getObjects()) {
    const fill = readObjectGradient(obj);
    const mask = readObjectGradientMask(obj);
    if (fill) applyObjectGradient(obj, fill, "fill");
    if (mask) applyObjectGradient(obj, mask, "mask");
    else installGradientMaskDraw(obj);
    if (obj instanceof fabric.Group) restoreObjectGradients(obj);
  }
}

export function loadGradientLibrary(): GradientDef[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => sanitizeGradient(item as Partial<GradientDef>));
  } catch {
    return [];
  }
}

export function suggestGradientName(def: GradientDef): string {
  const named = def.name.trim();
  if (named) return named;
  const kind = GRADIENT_KINDS.find((k) => k.id === def.kind)?.label;
  return kind || "Gradient";
}

export function uniqueGradientName(name: string, existing: GradientDef[]): string {
  const base = name.trim() || "Gradient";
  const taken = new Set(existing.map((g) => g.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

export function saveGradientToLibrary(def: GradientDef, name?: string): GradientDef[] {
  const existing = loadGradientLibrary();
  const next = cloneGradient(def);
  next.id = newGradientId();
  next.name = uniqueGradientName(name ?? def.name, existing);
  const list = [next, ...existing].slice(0, 32);
  if (typeof localStorage !== "undefined") localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GRADIENT_LIBRARY_EVENT));
  return list;
}

function installGradientMaskDraw(obj: fabric.FabricObject) {
  if (MASKED.has(obj)) return;
  MASKED.add(obj);
  const orig = obj._render.bind(obj);
  obj._render = function (this: fabric.FabricObject, ctx: CanvasRenderingContext2D) {
    const mask = readObjectGradientMask(this);
    if (!mask) {
      orig(ctx);
      return;
    }
    const w = Math.max(1, Math.round(this.width || 1));
    const h = Math.max(1, Math.round(this.height || 1));
    const pad = Math.ceil(Math.max(this.strokeWidth || 0, 0) + 2);
    const bw = w + pad * 2;
    const bh = h + pad * 2;
    const off = maskBuffer(this, bw, bh);
    const octx = off?.getContext("2d");
    if (!off || !octx) {
      orig(ctx);
      return;
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, bw, bh);
    octx.save();
    octx.translate(bw / 2, bh / 2);
    orig(octx);
    octx.globalCompositeOperation = "destination-in";
    const tile = maskTile(this, mask, w, h);
    octx.drawImage(tile, -w / 2, -h / 2, w, h);
    octx.restore();
    ctx.drawImage(off, -bw / 2, -bh / 2);
  };
}

function maskBuffer(obj: fabric.FabricObject, width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  let canvas = MASK_BUFFERS.get(obj);
  if (!canvas) {
    canvas = document.createElement("canvas");
    MASK_BUFFERS.set(obj, canvas);
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

function maskTile(obj: fabric.FabricObject, mask: GradientDef, width: number, height: number): HTMLCanvasElement {
  const key = [
    mask.id,
    mask.kind,
    mask.space,
    mask.angle,
    mask.scale,
    mask.cycles,
    mask.origin.x,
    mask.origin.y,
    width,
    height,
    mask.stops.map((s) => `${s.offset}:${s.hex}:${s.alpha}`).join(","),
    `${mask.curve.p0.x},${mask.curve.p0.y},${mask.curve.c1.x},${mask.curve.c1.y},${mask.curve.c2.x},${mask.curve.c2.y},${mask.curve.p1.x},${mask.curve.p1.y}`,
  ].join("|");
  const hit = MASK_TILES.get(obj);
  if (hit && hit.key === key) return hit.tile;
  const tile = rasterGradient(mask, width, height, true);
  MASK_TILES.set(obj, { key, tile });
  return tile;
}

function cssLinearToNative(def: GradientDef, width: number, height: number) {
  const rad = (def.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return new fabric.Gradient({
    type: "linear",
    gradientUnits: "pixels",
    coords: {
      x1: cx - dx * half,
      y1: cy - dy * half,
      x2: cx + dx * half,
      y2: cy + dy * half,
    },
    colorStops: expandStops(def, 16).map((s) => ({
      offset: s.offset,
      color: `rgba(${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)},${s.a.toFixed(3)})`,
    })),
  });
}

function cycleToNative(def: GradientDef, width: number, height: number) {
  const r = Math.min(width, height) * def.scale;
  return new fabric.Gradient({
    type: "radial",
    gradientUnits: "pixels",
    coords: {
      x1: def.origin.x * width,
      y1: def.origin.y * height,
      r1: 0,
      x2: def.origin.x * width,
      y2: def.origin.y * height,
      r2: Math.max(4, r),
    },
    colorStops: expandStops(def, 16).map((s) => ({
      offset: s.offset,
      color: `rgba(${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)},${s.a.toFixed(3)})`,
    })),
  });
}

function clampVec(raw: Vec2 | undefined, fallback: Vec2): Vec2 {
  return {
    x: clamp01(Number(raw?.x ?? fallback.x)),
    y: clamp01(Number(raw?.y ?? fallback.y)),
  };
}

function pct(n: number) {
  return `${Math.round(clamp01(n) * 100)}%`;
}

function hashCss(css: string) {
  let h = 0;
  for (let i = 0; i < css.length; i++) h = (h * 31 + css.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function mixStops(a: GradientStop, b: GradientStop, t: number, space: ColorSpace) {
  const aRgb = hexToRgb(a.hex);
  const bRgb = hexToRgb(b.hex);
  const alpha = clamp01(a.alpha + (b.alpha - a.alpha) * t);
  if (space === "hsl") {
    const ah = rgbToHsl(aRgb.r, aRgb.g, aRgb.b);
    const bh = rgbToHsl(bRgb.r, bRgb.g, bRgb.b);
    const h = lerpHue(ah.h, bh.h, t);
    const rgb = hslToRgb(h, ah.s + (bh.s - ah.s) * t, ah.l + (bh.l - ah.l) * t);
    return { ...rgb, a: alpha };
  }
  const ao = rgbToOklch(aRgb.r, aRgb.g, aRgb.b);
  const bo = rgbToOklch(bRgb.r, bRgb.g, bRgb.b);
  const rgb = oklchToRgb(
    ao.l + (bo.l - ao.l) * t,
    ao.c + (bo.c - ao.c) * t,
    lerpHue(ao.h, bo.h, t)
  );
  return { ...rgb, a: alpha };
}

function lerpHue(a: number, b: number, t: number) {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (a + d * t + 360) % 360;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s <= 1e-6) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hue) * 255),
    b: Math.round(hueToRgb(p, q, hue - 1 / 3) * 255),
  };
}

function hueToRgb(p: number, q: number, t: number) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function srgbToLinear(c: number) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number) {
  const x = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(x) * 255);
}

function rgbToOklch(r: number, g: number, b: number) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

function oklchToRgb(L: number, C: number, H: number) {
  const rad = (H * Math.PI) / 180;
  const A = Math.cos(rad) * C;
  const B = Math.sin(rad) * C;
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb) };
}
