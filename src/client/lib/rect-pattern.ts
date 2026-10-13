import * as fabric from "fabric";
import { isBgImage } from "./background-image";
import { sceneBounds } from "./snap-guides";

export const RECT_PATTERN_EVENT = "opend-rect-pattern";
export const PATTERN_MAX_COUNT = 20;
export const PATTERN_MAX_COPIES = 100;

export type PatternDistribution = "extent" | "spacing";
export type PatternDirection = "one" | "symmetric";
export type PatternDir = "x" | "y";
export type PatternEdge = "left" | "right" | "top" | "bottom";

export type PatternRef =
  | { kind: "line"; id: string; axis: "h" | "v" }
  | { kind: "edge"; edge: PatternEdge; at: number };

export type PatternAxis = {
  quantity: number;
  distancePx: number;
  distribution: PatternDistribution;
  direction: PatternDirection;
};

const EDGE_HIT_PX = 12;

/** Copies step across the reference. A vertical line or side edge moves them in X. */
export function patternRefDir(ref: PatternRef): PatternDir {
  if (ref.kind === "line") return ref.axis === "v" ? "x" : "y";
  return ref.edge === "left" || ref.edge === "right" ? "x" : "y";
}

export function patternRefLabel(ref: PatternRef): string {
  if (ref.kind === "line") return ref.axis === "v" ? "Vertical line" : "Horizontal line";
  if (ref.edge === "left") return "Left edge";
  if (ref.edge === "right") return "Right edge";
  if (ref.edge === "top") return "Top edge";
  return "Bottom edge";
}

export function patternSteps(axis: PatternAxis): number[] {
  const count = Math.max(1, Math.min(PATTERN_MAX_COUNT, Math.floor(axis.quantity)));
  if (count <= 1 || !Number.isFinite(axis.distancePx)) return [0];
  const gaps = count - 1;
  if (axis.direction === "symmetric") {
    const distance = Math.abs(axis.distancePx);
    const step = axis.distribution === "spacing" ? distance : distance / gaps;
    const neg = Math.floor(gaps / 2);
    const pos = gaps - neg;
    const steps: number[] = [];
    for (let i = -neg; i <= pos; i++) steps.push(i * step || 0);
    return steps;
  }
  const step = axis.distribution === "spacing" ? axis.distancePx : axis.distancePx / gaps;
  return Array.from({ length: count }, (_, i) => i * step || 0);
}

/** One slot per canvas axis. A later slot with the same direction replaces the earlier one. */
export function patternOffsets(
  x: PatternAxis | null,
  y: PatternAxis | null
): { dx: number; dy: number }[] {
  const xs = x ? patternSteps(x) : [0];
  const ys = y ? patternSteps(y) : [0];
  const out: { dx: number; dy: number }[] = [];
  for (const dx of xs) {
    for (const dy of ys) {
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
      out.push({ dx, dy });
    }
  }
  return out;
}

export function convertPatternDistance(
  px: number,
  from: PatternDistribution,
  to: PatternDistribution,
  quantity: number
): number {
  if (from === to || !Number.isFinite(px)) return px;
  const gaps = Math.max(1, Math.floor(quantity) - 1);
  return from === "spacing" ? px * gaps : px / gaps;
}

export function unionSize(objects: fabric.FabricObject[]): { width: number; height: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const obj of objects) {
    if (!obj.visible || isBgImage(obj) || obj instanceof fabric.ActiveSelection) continue;
    const box = sceneBounds(obj);
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  if (!Number.isFinite(left)) return { width: 40, height: 40 };
  return { width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function nearestPatternEdge(
  objects: fabric.FabricObject[],
  point: { x: number; y: number },
  zoom: number
): PatternRef | null {
  const tol = EDGE_HIT_PX / Math.max(zoom, 0.05);
  let best: { ref: PatternRef; dist: number } | null = null;
  for (const obj of objects) {
    if (!obj.visible || isBgImage(obj) || obj instanceof fabric.ActiveSelection) continue;
    const box = sceneBounds(obj);
    const sides: { edge: PatternEdge; at: number; dist: number; on: boolean }[] = [
      {
        edge: "left",
        at: box.left,
        dist: Math.abs(point.x - box.left),
        on: point.y >= box.top - tol && point.y <= box.bottom + tol,
      },
      {
        edge: "right",
        at: box.right,
        dist: Math.abs(point.x - box.right),
        on: point.y >= box.top - tol && point.y <= box.bottom + tol,
      },
      {
        edge: "top",
        at: box.top,
        dist: Math.abs(point.y - box.top),
        on: point.x >= box.left - tol && point.x <= box.right + tol,
      },
      {
        edge: "bottom",
        at: box.bottom,
        dist: Math.abs(point.y - box.bottom),
        on: point.x >= box.left - tol && point.x <= box.right + tol,
      },
    ];
    for (const side of sides) {
      if (!side.on || side.dist > tol) continue;
      if (!best || side.dist < best.dist) {
        best = { ref: { kind: "edge", edge: side.edge, at: side.at }, dist: side.dist };
      }
    }
  }
  return best?.ref ?? null;
}

export function restorePatternSources(canvas: fabric.Canvas, objects: fabric.FabricObject[]) {
  const live = objects.filter((obj) => obj.canvas === canvas);
  if (live.length === 0) return;
  if (live.length === 1) canvas.setActiveObject(live[0]);
  else canvas.setActiveObject(new fabric.ActiveSelection(live, { canvas }));
  canvas.requestRenderAll();
}
