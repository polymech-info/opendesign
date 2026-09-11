import * as fabric from "fabric";
import { isBgImage } from "./background-image";
import { isIconObject } from "./tabler-icons";

/** Scene-space grid, matching draw.io's default raster. */
export const GRID_SIZE = 10;
/** How close an edge/center must be to snap, in scene pixels. */
export const SNAP_TOLERANCE = 6;
/** Apply grid only after the pointer settles — live grid fights the drag and jumps between cells. */
export const GRID_SNAP_DEBOUNCE_MS = 100;
const GUIDE_COLOR = "#ec4899";

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
};

type FeatureKind = "min" | "mid" | "max";

type AxisFeature = {
  kind: FeatureKind;
  value: number;
  start: number;
  end: number;
};

export type SnapGuide = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type SnapSession = {
  timer: ReturnType<typeof setTimeout> | null;
  target: fabric.FabricObject | null;
};

const guidesByCanvas = new WeakMap<fabric.Canvas, SnapGuide[]>();
const sessionByCanvas = new WeakMap<fabric.Canvas, SnapSession>();
const installed = new WeakSet<fabric.Canvas>();

function session(canvas: fabric.Canvas): SnapSession {
  let s = sessionByCanvas.get(canvas);
  if (!s) {
    s = { timer: null, target: null };
    sessionByCanvas.set(canvas, s);
  }
  return s;
}

function clearGridTimer(canvas: fabric.Canvas) {
  const s = sessionByCanvas.get(canvas);
  if (!s?.timer) return;
  clearTimeout(s.timer);
  s.timer = null;
}

function sceneSize(canvas: fabric.Canvas) {
  const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const sx = vpt[0] || 1;
  const sy = vpt[3] || 1;
  return {
    width: (canvas.width || 0) / sx,
    height: (canvas.height || 0) / sy,
  };
}

function boundsFromPoints(points: { x: number; y: number }[]): Bounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return {
    left,
    top,
    right,
    bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}

/** Scene AABB from live coords (parent-relative aCoords × parent matrix). */
export function sceneBounds(obj: fabric.FabricObject): Bounds {
  const local = obj.calcACoords();
  let points = [local.tl, local.tr, local.br, local.bl];
  const parent = obj.group;
  if (parent) {
    const matrix = parent.calcTransformMatrix();
    points = points.map((p) => fabric.util.transformPoint(p, matrix));
  }
  return boundsFromPoints(points);
}

function unionBounds(boxes: Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return {
    left,
    top,
    right,
    bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}

function isWalkableGroup(obj: fabric.FabricObject): obj is fabric.Group {
  if (obj instanceof fabric.ActiveSelection) return true;
  return obj instanceof fabric.Group && !isIconObject(obj);
}

function collectLeafBounds(obj: fabric.FabricObject, out: Bounds[]) {
  if (!obj.visible) return;
  if (isWalkableGroup(obj)) {
    for (const child of obj.getObjects()) collectLeafBounds(child, out);
    return;
  }
  out.push(sceneBounds(obj));
}

/** Outer box + each leaf. Group Fabric width/height often misses child strokes. */
function visualBoxes(obj: fabric.FabricObject): Bounds[] {
  const leaves: Bounds[] = [];
  collectLeafBounds(obj, leaves);
  if (leaves.length === 0) return [sceneBounds(obj)];
  const outer = unionBounds(leaves);
  if (!outer) return leaves;
  if (leaves.length === 1) return [outer];
  return [outer, ...leaves];
}

function pageBounds(canvas: fabric.Canvas): Bounds {
  const { width, height } = sceneSize(canvas);
  return { left: 0, top: 0, right: width, bottom: height, cx: width / 2, cy: height / 2 };
}

function xFeatures(box: Bounds): AxisFeature[] {
  return [
    { kind: "min", value: box.left, start: box.top, end: box.bottom },
    { kind: "mid", value: box.cx, start: box.top, end: box.bottom },
    { kind: "max", value: box.right, start: box.top, end: box.bottom },
  ];
}

function yFeatures(box: Bounds): AxisFeature[] {
  return [
    { kind: "min", value: box.top, start: box.left, end: box.right },
    { kind: "mid", value: box.cy, start: box.left, end: box.right },
    { kind: "max", value: box.bottom, start: box.left, end: box.right },
  ];
}

function applySceneDelta(obj: fabric.FabricObject, dx: number, dy: number) {
  if (!dx && !dy) return;
  const parent = obj.group;
  if (parent && !(parent instanceof fabric.ActiveSelection)) {
    const inv = fabric.util.invertTransform(parent.calcTransformMatrix());
    obj.set({
      left: (obj.left || 0) + inv[0] * dx + inv[2] * dy,
      top: (obj.top || 0) + inv[1] * dx + inv[3] * dy,
    });
    return;
  }
  obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
}

/** Keep Fabric's next pointer sample from yanking the object off a settled snap. */
function bakeSceneDeltaIntoDrag(canvas: fabric.Canvas, obj: fabric.FabricObject, dx: number, dy: number) {
  if (!dx && !dy) return;
  const parent = obj.group;
  if (parent && !(parent instanceof fabric.ActiveSelection)) return;
  const t = canvas._currentTransform;
  if (!t || t.target !== obj) return;
  t.offsetX -= dx;
  t.offsetY -= dy;
}

/** Edge↔edge and center↔center only, like draw.io's mxGuide. */
function snapAxis(
  movers: AxisFeature[],
  targets: AxisFeature[],
  tolerance: number
): { delta: number; at: number; moverStart: number; moverEnd: number; targetStart: number; targetEnd: number } | null {
  let best: {
    delta: number;
    at: number;
    moverStart: number;
    moverEnd: number;
    targetStart: number;
    targetEnd: number;
    dist: number;
  } | null = null;
  for (const m of movers) {
    for (const t of targets) {
      if (t.kind !== m.kind) continue;
      const delta = t.value - m.value;
      const dist = Math.abs(delta);
      if (dist > tolerance) continue;
      if (!best || dist < best.dist) {
        best = {
          delta,
          at: t.value,
          moverStart: m.start,
          moverEnd: m.end,
          targetStart: t.start,
          targetEnd: t.end,
          dist,
        };
      }
    }
  }
  return best;
}

function addObjectTree(obj: fabric.FabricObject, set: Set<fabric.FabricObject>) {
  set.add(obj);
  if (isWalkableGroup(obj)) {
    for (const child of obj.getObjects()) addObjectTree(child, set);
  }
}

function movingSubtree(target: fabric.FabricObject): Set<fabric.FabricObject> {
  const set = new Set<fabric.FabricObject>();
  addObjectTree(target, set);
  return set;
}

function ancestorSet(target: fabric.FabricObject): Set<fabric.FabricObject> {
  const set = new Set<fabric.FabricObject>();
  let parent = target.group;
  while (parent) {
    set.add(parent);
    parent = parent.group;
  }
  return set;
}

function collectTargets(
  canvas: fabric.Canvas,
  skip: Set<fabric.FabricObject>,
  ancestors: Set<fabric.FabricObject>
): Bounds[] {
  const boxes: Bounds[] = [pageBounds(canvas)];
  const walk = (obj: fabric.FabricObject) => {
    if (!obj.visible || isBgImage(obj)) return;
    if (skip.has(obj)) return;
    if (obj instanceof fabric.ActiveSelection || ancestors.has(obj)) {
      if (isWalkableGroup(obj)) {
        for (const child of obj.getObjects()) walk(child);
      }
      return;
    }
    if (isWalkableGroup(obj)) {
      const leaves: Bounds[] = [];
      collectLeafBounds(obj, leaves);
      const outer = unionBounds(leaves);
      if (outer) boxes.push(outer);
      boxes.push(...leaves);
      return;
    }
    boxes.push(sceneBounds(obj));
  };
  for (const obj of canvas.getObjects()) walk(obj);
  return boxes;
}

function snapToGrid(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function snapMovingObject(
  canvas: fabric.Canvas,
  target: fabric.FabricObject,
  evt?: Event | null,
  opts: { grid?: boolean; bake?: boolean } = {}
) {
  if ((evt as MouseEvent | undefined)?.altKey) {
    guidesByCanvas.set(canvas, []);
    return;
  }

  const moverBoxes = visualBoxes(target);
  const outer = moverBoxes[0];
  const skip = movingSubtree(target);
  const others = collectTargets(canvas, skip, ancestorSet(target));
  const xMovers = moverBoxes.flatMap(xFeatures);
  const yMovers = moverBoxes.flatMap(yFeatures);
  const xTargets = others.flatMap(xFeatures);
  const yTargets = others.flatMap(yFeatures);

  const snapX = snapAxis(xMovers, xTargets, SNAP_TOLERANCE);
  const snapY = snapAxis(yMovers, yTargets, SNAP_TOLERANCE);
  const useGrid = !!opts.grid;

  const dx = snapX ? snapX.delta : useGrid ? snapToGrid(outer.left) - outer.left : 0;
  const dy = snapY ? snapY.delta : useGrid ? snapToGrid(outer.top) - outer.top : 0;
  const guides: SnapGuide[] = [];

  if (snapX) {
    guides.push({
      x1: snapX.at,
      y1: Math.min(snapX.moverStart + dy, snapX.targetStart),
      x2: snapX.at,
      y2: Math.max(snapX.moverEnd + dy, snapX.targetEnd),
    });
  }
  if (snapY) {
    guides.push({
      x1: Math.min(snapY.moverStart + dx, snapY.targetStart),
      y1: snapY.at,
      x2: Math.max(snapY.moverEnd + dx, snapY.targetEnd),
      y2: snapY.at,
    });
  }

  applySceneDelta(target, dx, dy);
  if (opts.bake) bakeSceneDeltaIntoDrag(canvas, target, dx, dy);
  target.setCoords();
  guidesByCanvas.set(canvas, guides);
}

export function clearSnapGuides(canvas: fabric.Canvas) {
  if (!guidesByCanvas.get(canvas)?.length) return;
  guidesByCanvas.set(canvas, []);
}

export function drawSnapGuides(canvas: fabric.Canvas, ctx: CanvasRenderingContext2D) {
  const guides = guidesByCanvas.get(canvas);
  if (!guides?.length) return;
  const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  ctx.save();
  ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
  const scale = Math.abs(vpt[0] || 1);
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.beginPath();
  for (const g of guides) {
    ctx.moveTo(g.x1, g.y1);
    ctx.lineTo(g.x2, g.y2);
  }
  ctx.stroke();
  ctx.restore();
}

function scheduleGridSnap(canvas: fabric.Canvas, target: fabric.FabricObject) {
  const s = session(canvas);
  s.target = target;
  clearGridTimer(canvas);
  s.timer = setTimeout(() => {
    s.timer = null;
    if (s.target !== target || target.canvas !== canvas) return;
    snapMovingObject(canvas, target, null, { grid: true, bake: true });
    canvas.requestRenderAll();
  }, GRID_SNAP_DEBOUNCE_MS);
}

export function installSnapGuides(canvas: fabric.Canvas) {
  if (installed.has(canvas)) return;
  installed.add(canvas);
  canvas.on("object:moving", (e) => {
    const target = e.target;
    if (!target || isBgImage(target)) return;
    snapMovingObject(canvas, target, e.e, { grid: false });
    scheduleGridSnap(canvas, target);
  });
  // Before object:modified so undo stores the gridded position.
  canvas.on("mouse:up:before", (e) => {
    clearGridTimer(canvas);
    const target = session(canvas).target;
    session(canvas).target = null;
    if (!target || isBgImage(target)) return;
    snapMovingObject(canvas, target, e.e, { grid: true });
  });
  canvas.on("mouse:up", () => {
    clearSnapGuides(canvas);
    canvas.requestRenderAll();
  });
  canvas.on("after:render", (e: { ctx?: CanvasRenderingContext2D }) => {
    drawSnapGuides(canvas, e.ctx ?? canvas.getContext());
  });
}
