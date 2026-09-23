import * as fabric from "fabric";
import { clearSnapGuides, snapScenePoint, type ScenePoint } from "./snap-guides";

export type ConnectorKind = "line" | "arrow" | "elbow" | "curve";
export type BalloonKind = "speech" | "thought";
export type LineHead = "none" | "arrow" | "triangle" | "diamond" | "circle";
export type LineDash = "solid" | "dashed" | "dotted";

export type ConnectorSpec = {
  kind: ConnectorKind;
  start: ScenePoint;
  end: ScenePoint;
  mid?: ScenePoint;
  startHead: LineHead;
  endHead: LineHead;
  dash: LineDash;
};

export type BalloonSpec = {
  kind: BalloonKind;
  x: number;
  y: number;
  w: number;
  h: number;
  tail: ScenePoint;
};

type ConnectorObject = fabric.Path & {
  _isConnector?: boolean;
  _connector?: ConnectorSpec;
  _markupOrigin?: ScenePoint;
};

type BalloonObject = fabric.Path & {
  _isBalloon?: boolean;
  _balloon?: BalloonSpec;
  _markupOrigin?: ScenePoint;
};

const STROKE = "#334155";
const HEAD_NONE: LineHead = "none";

export const LINE_HEADS: { id: LineHead; label: string }[] = [
  { id: "none", label: "None" },
  { id: "arrow", label: "Arrow" },
  { id: "triangle", label: "Triangle" },
  { id: "diamond", label: "Diamond" },
  { id: "circle", label: "Circle" },
];

export const LINE_DASHES: { id: LineDash; label: string; dash: number[] | undefined }[] = [
  { id: "solid", label: "Solid", dash: undefined },
  { id: "dashed", label: "Dashed", dash: [14, 8] },
  { id: "dotted", label: "Dotted", dash: [2, 7] },
];

export function isConnectorObject(obj: fabric.FabricObject | null | undefined): obj is ConnectorObject {
  return !!(obj as ConnectorObject | undefined)?._isConnector;
}

export function isBalloonObject(obj: fabric.FabricObject | null | undefined): obj is BalloonObject {
  return !!(obj as BalloonObject | undefined)?._isBalloon;
}

export function isMarkupObject(obj: fabric.FabricObject | null | undefined) {
  return isConnectorObject(obj) || isBalloonObject(obj);
}

export function readConnector(obj: fabric.FabricObject | null | undefined): ConnectorSpec | null {
  if (!isConnectorObject(obj) || !obj._connector) return null;
  return sanitizeConnector(obj._connector);
}

export function readBalloon(obj: fabric.FabricObject | null | undefined): BalloonSpec | null {
  if (!isBalloonObject(obj) || !obj._balloon) return null;
  return sanitizeBalloon(obj._balloon);
}

export function sanitizeConnector(raw: Partial<ConnectorSpec> | null | undefined): ConnectorSpec {
  const kind: ConnectorKind =
    raw?.kind === "elbow" || raw?.kind === "curve" || raw?.kind === "arrow" || raw?.kind === "line"
      ? raw.kind
      : "arrow";
  const start = pt(raw?.start, { x: 0, y: 0 });
  const end = pt(raw?.end, { x: 160, y: 0 });
  return {
    kind,
    start,
    end,
    mid: raw?.mid ? pt(raw.mid, midpoint(start, end)) : defaultMid(kind, start, end),
    startHead: headOf(raw?.startHead, HEAD_NONE),
    endHead: headOf(raw?.endHead, kind === "line" ? HEAD_NONE : "arrow"),
    dash: raw?.dash === "dashed" || raw?.dash === "dotted" ? raw.dash : "solid",
  };
}

export function sanitizeBalloon(raw: Partial<BalloonSpec> | null | undefined): BalloonSpec {
  const w = Math.max(48, Number(raw?.w) || 200);
  const h = Math.max(36, Number(raw?.h) || 110);
  const x = Number(raw?.x) || 0;
  const y = Number(raw?.y) || 0;
  return {
    kind: raw?.kind === "thought" ? "thought" : "speech",
    x,
    y,
    w,
    h,
    tail: pt(raw?.tail, { x: x + w * 0.22, y: y + h + 36 }),
  };
}

export function defaultMid(kind: ConnectorKind, start: ScenePoint, end: ScenePoint): ScenePoint | undefined {
  if (kind === "elbow") return { x: end.x, y: start.y };
  if (kind === "curve") {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 70 };
  }
  return undefined;
}

export function headSize(strokeWidth: number) {
  return Math.max(12, 10 + strokeWidth * 1.8);
}

export function shorten(from: ScenePoint, to: ScenePoint, by: number): ScenePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, (len - by) / len);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

export function buildHeadPath(tip: ScenePoint, from: ScenePoint, kind: LineHead, size: number): string {
  if (kind === "none") return "";
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  if (kind === "circle") {
    const r = size * 0.38;
    const c = { x: tip.x - ux * r, y: tip.y - uy * r };
    return `M ${c.x + r} ${c.y} A ${r} ${r} 0 1 1 ${c.x - r} ${c.y} A ${r} ${r} 0 1 1 ${c.x + r} ${c.y} Z`;
  }
  if (kind === "diamond") {
    const tip2 = tip;
    const back = { x: tip.x - ux * size, y: tip.y - uy * size };
    const left = { x: tip.x - ux * size * 0.5 + px * size * 0.42, y: tip.y - uy * size * 0.5 + py * size * 0.42 };
    const right = { x: tip.x - ux * size * 0.5 - px * size * 0.42, y: tip.y - uy * size * 0.5 - py * size * 0.42 };
    return `M ${tip2.x} ${tip2.y} L ${left.x} ${left.y} L ${back.x} ${back.y} L ${right.x} ${right.y} Z`;
  }
  const back = { x: tip.x - ux * size, y: tip.y - uy * size };
  const left = { x: back.x + px * size * 0.48, y: back.y + py * size * 0.48 };
  const right = { x: back.x - px * size * 0.48, y: back.y - py * size * 0.48 };
  if (kind === "arrow") {
    const inset = { x: tip.x - ux * size * 0.62, y: tip.y - uy * size * 0.62 };
    return `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${inset.x} ${inset.y} L ${right.x} ${right.y} Z`;
  }
  return `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`;
}

export function buildConnectorPath(spec: ConnectorSpec, strokeWidth = 3): string {
  const size = headSize(strokeWidth);
  const startCut = spec.startHead === "none" ? 0 : size * (spec.startHead === "circle" ? 0.76 : 0.72);
  const endCut = spec.endHead === "none" ? 0 : size * (spec.endHead === "circle" ? 0.76 : 0.72);
  const mid = spec.mid ?? defaultMid(spec.kind, spec.start, spec.end);
  let shaftStart = spec.start;
  let shaftEnd = spec.end;
  let headFromStart = mid ?? spec.end;
  let headFromEnd = mid ?? spec.start;
  if (spec.kind === "curve" && mid) {
    shaftStart = shorten(mid, spec.start, startCut);
    shaftEnd = shorten(mid, spec.end, endCut);
    headFromStart = mid;
    headFromEnd = mid;
    // Retrace so fill (used by heads) cannot close the curve into a lobe.
    const shaft = `M ${shaftStart.x} ${shaftStart.y} Q ${mid.x} ${mid.y} ${shaftEnd.x} ${shaftEnd.y} Q ${mid.x} ${mid.y} ${shaftStart.x} ${shaftStart.y}`;
    return [
      shaft,
      buildHeadPath(spec.start, headFromStart, spec.startHead, size),
      buildHeadPath(spec.end, headFromEnd, spec.endHead, size),
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (spec.kind === "elbow" && mid) {
    shaftStart = shorten(mid, spec.start, startCut);
    shaftEnd = shorten(mid, spec.end, endCut);
    // SVG/Fabric fill auto-closes open subpaths. Retrace A-mid-B-mid-A so the
    // elbow stays a line instead of a filled triangle.
    const shaft = `M ${shaftStart.x} ${shaftStart.y} L ${mid.x} ${mid.y} L ${shaftEnd.x} ${shaftEnd.y} L ${mid.x} ${mid.y} L ${shaftStart.x} ${shaftStart.y}`;
    return [
      shaft,
      buildHeadPath(spec.start, mid, spec.startHead, size),
      buildHeadPath(spec.end, mid, spec.endHead, size),
    ]
      .filter(Boolean)
      .join(" ");
  }
  shaftStart = shorten(spec.end, spec.start, startCut);
  shaftEnd = shorten(spec.start, spec.end, endCut);
  const shaft = `M ${shaftStart.x} ${shaftStart.y} L ${shaftEnd.x} ${shaftEnd.y} L ${shaftStart.x} ${shaftStart.y}`;
  return [
    shaft,
    buildHeadPath(spec.start, spec.end, spec.startHead, size),
    buildHeadPath(spec.end, spec.start, spec.endHead, size),
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildBalloonPath(spec: BalloonSpec): string {
  if (spec.kind === "thought") return thoughtPath(spec);
  return speechPath(spec);
}

function speechPath(spec: BalloonSpec): string {
  const { x, y, w, h, tail } = spec;
  const r = Math.min(22, w / 4, h / 4);
  const body = [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y} Z`,
  ].join(" ");
  const attach = nearestRectEdge(spec, tail);
  const nx = attach.x - (x + w / 2);
  const ny = attach.y - (y + h / 2);
  const nlen = Math.hypot(nx, ny) || 1;
  const px = (-ny / nlen) * 12;
  const py = (nx / nlen) * 12;
  const a = { x: attach.x + px, y: attach.y + py };
  const b = { x: attach.x - px, y: attach.y - py };
  const tailPath = `M ${a.x} ${a.y} L ${tail.x} ${tail.y} L ${b.x} ${b.y} Z`;
  return `${body} ${tailPath}`;
}

function thoughtPath(spec: BalloonSpec): string {
  const { x, y, w, h, tail } = spec;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const body = `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`;
  const dx = tail.x - cx;
  const dy = tail.y - cy;
  const p1 = { x: cx + dx * 0.55, y: cy + dy * 0.55 };
  const p2 = { x: cx + dx * 0.78, y: cy + dy * 0.78 };
  const r1 = Math.max(7, Math.min(w, h) * 0.09);
  const r2 = r1 * 0.7;
  const r3 = r1 * 0.45;
  return [
    body,
    circlePath(p1, r1),
    circlePath(p2, r2),
    circlePath(tail, r3),
  ].join(" ");
}

function circlePath(c: ScenePoint, r: number) {
  return `M ${c.x + r} ${c.y} A ${r} ${r} 0 1 1 ${c.x - r} ${c.y} A ${r} ${r} 0 1 1 ${c.x + r} ${c.y} Z`;
}

function nearestRectEdge(spec: BalloonSpec, tail: ScenePoint): ScenePoint {
  const { x, y, w, h } = spec;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = tail.x - cx;
  const dy = tail.y - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: y + h };
  const sx = dx === 0 ? Infinity : (w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (h / 2) / Math.abs(dy);
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function createConnector(
  kind: ConnectorKind,
  canvasWidth: number,
  canvasHeight: number
): fabric.Path {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const spec = sanitizeConnector({
    kind,
    start: { x: cx - 130, y: cy },
    end: { x: cx + 130, y: kind === "elbow" ? cy + 80 : cy },
    mid: kind === "elbow" ? { x: cx + 130, y: cy } : kind === "curve" ? { x: cx, y: cy - 80 } : undefined,
    startHead: HEAD_NONE,
    endHead: kind === "line" ? HEAD_NONE : "arrow",
    dash: "solid",
  });
  const obj = new fabric.Path(buildConnectorPath(spec), connectorStyle(spec));
  tagConnector(obj, spec);
  applyConnectorGeometry(obj, spec);
  installConnectorControls(obj);
  return obj;
}

export function createBalloon(kind: BalloonKind, canvasWidth: number, canvasHeight: number): fabric.Path {
  const w = kind === "thought" ? 190 : 210;
  const h = kind === "thought" ? 120 : 112;
  const spec = sanitizeBalloon({
    kind,
    x: canvasWidth / 2 - w / 2,
    y: canvasHeight / 2 - h / 2,
    w,
    h,
    tail: { x: canvasWidth / 2 - w * 0.28, y: canvasHeight / 2 + h / 2 + 38 },
  });
  const obj = new fabric.Path(buildBalloonPath(spec), {
    fill: "#ffffff",
    stroke: STROKE,
    strokeWidth: 2.5,
    strokeLineJoin: "round",
    objectCaching: false,
  });
  tagBalloon(obj, spec);
  applyBalloonGeometry(obj, spec);
  installBalloonControls(obj);
  return obj;
}

export function applyConnectorPatch(obj: fabric.FabricObject, patch: Partial<ConnectorSpec>) {
  if (!isConnectorObject(obj)) return;
  const next = sanitizeConnector({ ...readConnector(obj), ...patch });
  applyConnectorGeometry(obj, next);
  installConnectorControls(obj);
}

export function applyBalloonPatch(obj: fabric.FabricObject, patch: Partial<BalloonSpec>) {
  if (!isBalloonObject(obj)) return;
  const next = sanitizeBalloon({ ...readBalloon(obj), ...patch });
  applyBalloonGeometry(obj, next);
  installBalloonControls(obj);
}

export function refreshMarkupStyle(obj: fabric.FabricObject) {
  if (isConnectorObject(obj)) {
    const spec = readConnector(obj);
    if (!spec) return;
    obj.set(connectorStyle(spec, obj.strokeWidth || 3, String(obj.stroke || STROKE)));
    applyConnectorGeometry(obj, spec);
    return;
  }
  if (isBalloonObject(obj)) {
    const spec = readBalloon(obj);
    if (spec) applyBalloonGeometry(obj, spec);
  }
}

export function decorateMarkupObject(obj: fabric.FabricObject) {
  if (isConnectorObject(obj)) {
    hideDefaultHandles(obj);
    const spec = readConnector(obj);
    if (spec) applyConnectorGeometry(obj, spec);
    installConnectorControls(obj);
    watchMarkupMove(obj);
    return;
  }
  if (isBalloonObject(obj)) {
    const spec = readBalloon(obj);
    if (spec) applyBalloonGeometry(obj, spec);
    installBalloonControls(obj);
    watchMarkupMove(obj);
  }
}

export function restoreMarkupObjects(root: fabric.StaticCanvas | fabric.Group) {
  for (const obj of root.getObjects()) {
    decorateMarkupObject(obj);
    if (obj instanceof fabric.Group) restoreMarkupObjects(obj);
  }
}

export function bakeMarkupTransform(obj: fabric.FabricObject) {
  if (isConnectorObject(obj)) {
    const spec = readConnector(obj);
    if (!spec) return;
    syncMarkupOrigin(obj, [spec.start, spec.end, spec.mid].filter(Boolean) as ScenePoint[]);
    if (needsBake(obj)) {
      scalePoints([spec.start, spec.end, spec.mid].filter(Boolean) as ScenePoint[], obj);
      obj.set({ scaleX: 1, scaleY: 1, angle: 0 });
      applyConnectorGeometry(obj, spec);
    }
    return;
  }
  if (isBalloonObject(obj)) {
    const spec = readBalloon(obj);
    if (!spec) return;
    const pts = [
      { x: spec.x, y: spec.y },
      { x: spec.x + spec.w, y: spec.y + spec.h },
      spec.tail,
    ];
    syncMarkupOrigin(obj, pts);
    if (needsBake(obj)) {
      const a = { x: spec.x, y: spec.y };
      const b = { x: spec.x + spec.w, y: spec.y + spec.h };
      scalePoints([a, b, spec.tail], obj);
      spec.x = Math.min(a.x, b.x);
      spec.y = Math.min(a.y, b.y);
      spec.w = Math.abs(b.x - a.x);
      spec.h = Math.abs(b.y - a.y);
      obj.set({ scaleX: 1, scaleY: 1, angle: 0 });
      applyBalloonGeometry(obj, spec);
    }
  }
}

function connectorStyle(spec: ConnectorSpec, width = 3, color = STROKE) {
  const dash = LINE_DASHES.find((d) => d.id === spec.dash)?.dash;
  return {
    fill: color,
    stroke: color,
    strokeWidth: width,
    strokeLineCap: "round" as const,
    strokeLineJoin: "round" as const,
    strokeDashArray: dash,
    objectCaching: false,
    originX: "left" as const,
    originY: "top" as const,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    lockScalingFlip: true,
  };
}

function tagConnector(obj: fabric.Path, spec: ConnectorSpec) {
  const next = obj as ConnectorObject;
  next._isConnector = true;
  next._connector = spec;
}

function tagBalloon(obj: fabric.Path, spec: BalloonSpec) {
  const next = obj as BalloonObject;
  next._isBalloon = true;
  next._balloon = spec;
}

function applyConnectorGeometry(obj: fabric.Path, spec: ConnectorSpec) {
  const clean = sanitizeConnector(spec);
  tagConnector(obj, clean);
  (obj as ConnectorObject)._setPath(buildConnectorPath(clean, obj.strokeWidth || 3), true);
  (obj as ConnectorObject)._markupOrigin = { x: obj.left || 0, y: obj.top || 0 };
  obj.set({
    ...connectorStyle(clean, obj.strokeWidth || 3, String(obj.stroke || STROKE)),
    padding: 0,
  });
  hideDefaultHandles(obj);
  obj.setCoords();
  obj.dirty = true;
}

function applyBalloonGeometry(obj: fabric.Path, spec: BalloonSpec) {
  const clean = sanitizeBalloon(spec);
  tagBalloon(obj, clean);
  (obj as BalloonObject)._setPath(buildBalloonPath(clean), true);
  (obj as BalloonObject)._markupOrigin = { x: obj.left || 0, y: obj.top || 0 };
  obj.set({ objectCaching: false, originX: "left", originY: "top" });
  obj.setCoords();
  obj.dirty = true;
}

function hideDefaultHandles(obj: fabric.FabricObject) {
  for (const key of ["tl", "tr", "bl", "br", "mt", "mb", "ml", "mr", "mtr"]) {
    if (obj.controls[key]) obj.controls[key].visible = false;
    obj.setControlVisible?.(key, false);
  }
}

function installConnectorControls(obj: fabric.Path) {
  hideDefaultHandles(obj);
  obj.controls = {
    ...obj.controls,
    start: pointControl("start", "#ffffff"),
    end: pointControl("end", "#ffffff"),
    mid: pointControl("mid", "#fde68a"),
  };
  const spec = readConnector(obj);
  if (obj.controls.mid) obj.controls.mid.visible = spec?.kind === "elbow" || spec?.kind === "curve";
}

function installBalloonControls(obj: fabric.Path) {
  obj.controls = {
    ...obj.controls,
    tail: pointControl("tail", "#fde68a"),
  };
}

function pointControl(key: "start" | "end" | "mid" | "tail", fill: string) {
  return new fabric.Control({
    cursorStyle: "move",
    sizeX: 16,
    sizeY: 16,
    render: (ctx, left, top) => {
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
    positionHandler: (_dim, _matrix, target) => sceneControlPoint(target, key),
    actionHandler: (eventData, transform, x, y) => {
      const target = transform.target;
      const canvas = target.canvas;
      let next = { x, y };
      if (canvas) next = snapScenePoint(canvas, next, target, eventData);
      moveMarkupPoint(target, key, next);
      canvas?.requestRenderAll();
      return true;
    },
    mouseUpHandler: (_eventData, transform) => {
      const canvas = transform.target.canvas;
      if (canvas) clearSnapGuides(canvas);
      return true;
    },
  });
}

function sceneControlPoint(obj: fabric.FabricObject, key: "start" | "end" | "mid" | "tail") {
  const connector = readConnector(obj);
  const balloon = readBalloon(obj);
  const raw =
    key === "tail"
      ? balloon?.tail
      : key === "start"
        ? connector?.start
        : key === "end"
          ? connector?.end
          : connector?.mid ?? defaultMid(connector?.kind || "line", connector?.start || { x: 0, y: 0 }, connector?.end || { x: 0, y: 0 });
  const point = raw || { x: obj.left || 0, y: obj.top || 0 };
  const vt = obj.canvas?.viewportTransform;
  return vt ? fabric.util.transformPoint(new fabric.Point(point.x, point.y), vt) : new fabric.Point(point.x, point.y);
}

function moveMarkupPoint(obj: fabric.FabricObject, key: "start" | "end" | "mid" | "tail", point: ScenePoint) {
  if (key === "tail" && isBalloonObject(obj)) {
    applyBalloonPatch(obj, { tail: point });
    return;
  }
  if (!isConnectorObject(obj)) return;
  if (key === "start") applyConnectorPatch(obj, { start: point });
  else if (key === "end") applyConnectorPatch(obj, { end: point });
  else applyConnectorPatch(obj, { mid: point });
}

const MOVE_WATCHED = new WeakSet<fabric.FabricObject>();

function watchMarkupMove(obj: fabric.FabricObject) {
  if (MOVE_WATCHED.has(obj)) return;
  MOVE_WATCHED.add(obj);
  obj.on("moving", () => shiftMarkupToOrigin(obj));
  obj.on("modified", () => bakeMarkupTransform(obj));
}

function shiftMarkupToOrigin(obj: fabric.FabricObject) {
  const origin = (obj as ConnectorObject)._markupOrigin;
  const left = obj.left || 0;
  const top = obj.top || 0;
  if (!origin) {
    (obj as ConnectorObject)._markupOrigin = { x: left, y: top };
    return;
  }
  const dx = left - origin.x;
  const dy = top - origin.y;
  if (!dx && !dy) return;
  if (isConnectorObject(obj) && obj._connector) {
    obj._connector.start = add(obj._connector.start, dx, dy);
    obj._connector.end = add(obj._connector.end, dx, dy);
    if (obj._connector.mid) obj._connector.mid = add(obj._connector.mid, dx, dy);
  }
  if (isBalloonObject(obj) && obj._balloon) {
    obj._balloon.x += dx;
    obj._balloon.y += dy;
    obj._balloon.tail = add(obj._balloon.tail, dx, dy);
  }
  (obj as ConnectorObject)._markupOrigin = { x: left, y: top };
}

function syncMarkupOrigin(obj: fabric.FabricObject, _pts: ScenePoint[]) {
  const origin = (obj as ConnectorObject)._markupOrigin;
  const left = obj.left || 0;
  const top = obj.top || 0;
  if (!origin) {
    (obj as ConnectorObject)._markupOrigin = { x: left, y: top };
    return;
  }
  shiftMarkupToOrigin(obj);
}

function needsBake(obj: fabric.FabricObject) {
  return (
    Math.abs((obj.scaleX || 1) - 1) > 0.001 ||
    Math.abs((obj.scaleY || 1) - 1) > 0.001 ||
    Math.abs(obj.angle || 0) > 0.01
  );
}

function scalePoints(points: ScenePoint[], obj: fabric.FabricObject) {
  const center = obj.getCenterPoint();
  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  const rad = ((obj.angle || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const p of points) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    p.x = center.x + rx * sx;
    p.y = center.y + ry * sy;
  }
}

function pt(raw: ScenePoint | undefined, fallback: ScenePoint): ScenePoint {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
  };
}

function headOf(value: unknown, fallback: LineHead): LineHead {
  return value === "arrow" || value === "triangle" || value === "diamond" || value === "circle" || value === "none"
    ? value
    : fallback;
}

function midpoint(a: ScenePoint, b: ScenePoint): ScenePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function add(p: ScenePoint, dx: number, dy: number): ScenePoint {
  return { x: p.x + dx, y: p.y + dy };
}
