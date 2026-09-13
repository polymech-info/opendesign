import * as fabric from "fabric";
import { isBgImage } from "./background-image";
import { isElementGroup, isInsideElementGroup } from "./element-group";
import { isCroppableImage } from "./image-crop";
import { selectedCanvasObjects } from "./object-style";

/** Keep Fabric resize handles inside the canvas clip (padding + mid-handle). */
export const MAXIMIZE_HANDLE_INSET = 22;

function fitSize(canvasWidth: number, canvasHeight: number) {
  return {
    width: Math.max(1, canvasWidth - MAXIMIZE_HANDLE_INSET * 2),
    height: Math.max(1, canvasHeight - MAXIMIZE_HANDLE_INSET * 2),
  };
}

function placeWithScale(
  obj: fabric.FabricObject,
  canvasWidth: number,
  canvasHeight: number,
  scaleX: number,
  scaleY: number
) {
  const displayW = Math.max(1, (obj.width || 1) * Math.abs(scaleX));
  const displayH = Math.max(1, (obj.height || 1) * Math.abs(scaleY));
  const left = (canvasWidth - displayW) / 2;
  const top = (canvasHeight - displayH) / 2;

  obj.set({ angle: 0, skewX: 0, skewY: 0 });

  const parent = obj.group;
  if (!parent) {
    obj.set({
      originX: "left",
      originY: "top",
      scaleX,
      scaleY,
      left,
      top,
    });
    obj.setCoords();
    return true;
  }

  const inv = fabric.util.invertTransform(parent.calcTransformMatrix());
  const tl = fabric.util.transformPoint(new fabric.Point(left, top), inv);
  const br = fabric.util.transformPoint(new fabric.Point(left + displayW, top + displayH), inv);
  const localW = Math.max(1, Math.abs(br.x - tl.x));
  const localH = Math.max(1, Math.abs(br.y - tl.y));
  obj.set({
    originX: "left",
    originY: "top",
    left: Math.min(tl.x, br.x),
    top: Math.min(tl.y, br.y),
    scaleX: (Math.sign(scaleX) || 1) * (localW / Math.max(1, obj.width || 1)),
    scaleY: (Math.sign(scaleY) || 1) * (localH / Math.max(1, obj.height || 1)),
  });
  obj.setCoords();
  parent.dirty = true;
  parent.setCoords();
  return true;
}

export function maximizeObjectToCanvas(
  obj: fabric.FabricObject,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  if (isBgImage(obj)) return false;
  if (canvasWidth < 1 || canvasHeight < 1) return false;
  obj.set({ angle: 0, skewX: 0, skewY: 0 });
  const area = fitSize(canvasWidth, canvasHeight);
  const displayW = Math.max(1, (obj.width || 1) * Math.abs(obj.scaleX || 1));
  const displayH = Math.max(1, (obj.height || 1) * Math.abs(obj.scaleY || 1));
  const factor = Math.min(area.width / displayW, area.height / displayH);
  if (!Number.isFinite(factor) || factor <= 0) return false;
  if (isCroppableImage(obj)) obj.set({ lockScalingFlip: true });
  return placeWithScale(obj, canvasWidth, canvasHeight, (obj.scaleX || 1) * factor, (obj.scaleY || 1) * factor);
}

function maximizeActiveSelection(sel: fabric.ActiveSelection, canvasWidth: number, canvasHeight: number) {
  sel.set({ angle: 0, skewX: 0, skewY: 0 });
  sel.setCoords();
  const area = fitSize(canvasWidth, canvasHeight);
  const w = Math.max(1, sel.getScaledWidth());
  const h = Math.max(1, sel.getScaledHeight());
  const scale = Math.min(area.width / w, area.height / h);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  sel.set({
    scaleX: (sel.scaleX || 1) * scale,
    scaleY: (sel.scaleY || 1) * scale,
  });
  sel.setPositionByOrigin(new fabric.Point(canvasWidth / 2, canvasHeight / 2), "center", "center");
  sel.setCoords();
  return true;
}

function maximizeObjectsAsUnit(
  objects: fabric.FabricObject[],
  canvasWidth: number,
  canvasHeight: number
) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const obj of objects) {
    const box = obj.getBoundingRect();
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width);
    bottom = Math.max(bottom, box.top + box.height);
  }
  const area = fitSize(canvasWidth, canvasHeight);
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const scale = Math.min(area.width / w, area.height / h);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const nx = canvasWidth / 2;
  const ny = canvasHeight / 2;
  for (const obj of objects) {
    const center = obj.getCenterPoint();
    const next = new fabric.Point(nx + (center.x - cx) * scale, ny + (center.y - cy) * scale);
    obj.set({
      scaleX: (obj.scaleX || 1) * scale,
      scaleY: (obj.scaleY || 1) * scale,
    });
    obj.setPositionByOrigin(next, "center", "center");
    obj.setCoords();
  }
  return true;
}

export function maximizeSelection(
  canvas: fabric.Canvas,
  selectedObject: fabric.FabricObject | null | undefined,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  if (canvasWidth < 1 || canvasHeight < 1) return false;
  if (selectedObject && isInsideElementGroup(selectedObject)) {
    return maximizeObjectToCanvas(selectedObject, canvasWidth, canvasHeight);
  }
  const active = canvas.getActiveObject();
  if (active instanceof fabric.ActiveSelection) {
    return maximizeActiveSelection(active, canvasWidth, canvasHeight);
  }
  if (isElementGroup(active)) {
    return maximizeObjectToCanvas(active, canvasWidth, canvasHeight);
  }
  const objects = selectedCanvasObjects(canvas, selectedObject).filter((obj) => !isBgImage(obj));
  if (objects.length === 1) return maximizeObjectToCanvas(objects[0], canvasWidth, canvasHeight);
  if (objects.length > 1) return maximizeObjectsAsUnit(objects, canvasWidth, canvasHeight);
  return false;
}
