import * as fabric from "fabric";
import { selectedCanvasObjects } from "./object-style";

export type AlignEdge = "left" | "right" | "top" | "bottom";

function canvasDeltaToParentSpace(obj: fabric.FabricObject, dx: number, dy: number) {
  const parent = obj.group;
  if (!parent || (dx === 0 && dy === 0)) return { dx, dy };
  const inv = fabric.util.invertTransform(parent.calcTransformMatrix());
  return {
    dx: inv[0] * dx + inv[2] * dy,
    dy: inv[1] * dx + inv[3] * dy,
  };
}

function moveByCanvasDelta(obj: fabric.FabricObject, canvasDx: number, canvasDy: number) {
  const { dx, dy } = canvasDeltaToParentSpace(obj, canvasDx, canvasDy);
  const next: { left?: number; top?: number } = {};
  if (!obj.lockMovementX && dx) next.left = (obj.left || 0) + dx;
  if (!obj.lockMovementY && dy) next.top = (obj.top || 0) + dy;
  if (next.left == null && next.top == null) return false;
  obj.set(next);
  obj.setCoords();
  const parent = obj.group;
  if (parent) {
    parent.dirty = true;
    parent.setCoords();
  }
  return true;
}

function boxOf(obj: fabric.FabricObject) {
  const rect = obj.getBoundingRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

export function alignableSelection(
  canvas: fabric.Canvas | null | undefined,
  selectedObject?: fabric.FabricObject | null
) {
  const objects = selectedCanvasObjects(canvas, selectedObject);
  return objects.length >= 2 ? objects : [];
}

/** Move later selected objects so the given edge matches the first object's bounds. */
export function alignSelectionToFirst(
  canvas: fabric.Canvas,
  selectedObject: fabric.FabricObject | null | undefined,
  edge: AlignEdge
): boolean {
  const objects = alignableSelection(canvas, selectedObject);
  if (objects.length < 2) return false;
  const [reference, ...others] = objects;
  const ref = boxOf(reference);
  let moved = false;
  for (const obj of others) {
    const box = boxOf(obj);
    const dx =
      edge === "left" ? ref.left - box.left : edge === "right" ? ref.right - box.right : 0;
    const dy =
      edge === "top" ? ref.top - box.top : edge === "bottom" ? ref.bottom - box.bottom : 0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    if (moveByCanvasDelta(obj, dx, dy)) moved = true;
  }
  if (!moved) return false;
  const active = canvas.getActiveObject();
  if (active) {
    active.setCoords();
    active.dirty = true;
  }
  canvas.requestRenderAll();
  return true;
}

export type MatchSizeAxis = "width" | "height";

function scaledSize(obj: fabric.FabricObject, axis: MatchSizeAxis) {
  return Math.max(1, axis === "width" ? obj.getScaledWidth() : obj.getScaledHeight());
}

/** Scale later objects so width or height matches the first. Aspect stays put. */
export function matchObjectsSizeToFirst(objects: fabric.FabricObject[], axis: MatchSizeAxis): boolean {
  if (objects.length < 2) return false;
  const [reference, ...others] = objects;
  const target = scaledSize(reference, axis);
  let changed = false;
  for (const obj of others) {
    const current = scaledSize(obj, axis);
    const factor = target / current;
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-4) continue;
    const center = obj.getCenterPoint();
    obj.set({
      scaleX: (obj.scaleX || 1) * factor,
      scaleY: (obj.scaleY || 1) * factor,
    });
    obj.setPositionByOrigin(center, "center", "center");
    obj.setCoords();
    const parent = obj.group;
    if (parent) {
      parent.dirty = true;
      parent.setCoords();
    }
    changed = true;
  }
  return changed;
}

export function matchSelectionSizeToFirst(
  canvas: fabric.Canvas,
  selectedObject: fabric.FabricObject | null | undefined,
  axis: MatchSizeAxis
): boolean {
  const changed = matchObjectsSizeToFirst(alignableSelection(canvas, selectedObject), axis);
  if (!changed) return false;
  const active = canvas.getActiveObject();
  if (active) {
    active.setCoords();
    active.dirty = true;
  }
  canvas.requestRenderAll();
  return true;
}
