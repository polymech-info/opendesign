import * as fabric from "fabric";
import { isBgImage } from "./background-image";
import { topLevelStackObject } from "./object-identity";
import { selectedCanvasObjects } from "./object-style";

export type StackDirection = "front" | "back";

function uniqueInOrder(order: fabric.FabricObject[], picks: fabric.FabricObject[]) {
  const wanted = new Set(picks);
  return order.filter((obj) => wanted.has(obj));
}

function sameOrder(a: fabric.FabricObject[], b: fabric.FabricObject[]) {
  return a.length === b.length && a.every((obj, i) => obj === b[i]);
}

function restackList(
  objects: fabric.FabricObject[],
  targets: fabric.FabricObject[],
  direction: StackDirection
) {
  const moving = new Set(targets);
  const block = objects.filter((obj) => moving.has(obj));
  const rest = objects.filter((obj) => !moving.has(obj));
  return direction === "front" ? [...rest, ...block] : [...block, ...rest];
}

function applyHostOrder(
  host: fabric.Canvas | fabric.Group,
  ordered: fabric.FabricObject[],
  startIndex = 0
) {
  let index = startIndex;
  for (const obj of ordered) {
    host.moveObjectTo(obj, index++);
  }
}

function stackParent(obj: fabric.FabricObject): fabric.Group | null {
  const parent = obj.group;
  if (!parent || parent instanceof fabric.ActiveSelection) return null;
  return parent;
}

/** Canvas-level objects, or siblings inside the same group when that is the selection. */
export function stackTargetsFromSelection(
  canvas: fabric.Canvas | null | undefined,
  selectedObject?: fabric.FabricObject | null
): { host: fabric.Canvas | fabric.Group; objects: fabric.FabricObject[]; targets: fabric.FabricObject[] } | null {
  if (!canvas) return null;
  const raw = selectedCanvasObjects(canvas, selectedObject).filter((obj) => !isBgImage(obj));
  if (raw.length === 0) return null;

  const parents = raw.map(stackParent);
  const shared = parents[0];
  if (shared && parents.every((parent) => parent === shared)) {
    const objects = shared.getObjects();
    const targets = uniqueInOrder(objects, raw);
    if (targets.length === 0) return null;
    return { host: shared, objects, targets };
  }

  const objects = canvas.getObjects().filter((obj) => !isBgImage(obj));
  const tops = raw.map(topLevelStackObject).filter((obj) => !isBgImage(obj));
  const targets = uniqueInOrder(objects, tops);
  if (targets.length === 0) return null;
  return { host: canvas, objects, targets };
}

export function restackSelection(
  canvas: fabric.Canvas,
  selectedObject: fabric.FabricObject | null | undefined,
  direction: StackDirection
): fabric.FabricObject[] | null {
  const resolved = stackTargetsFromSelection(canvas, selectedObject);
  if (!resolved) return null;
  const next = restackList(resolved.objects, resolved.targets, direction);
  if (sameOrder(resolved.objects, next)) return null;

  if (resolved.host instanceof fabric.Canvas) {
    const bg = canvas.getObjects().find(isBgImage);
    let index = 0;
    if (bg) {
      canvas.moveObjectTo(bg, 0);
      index = 1;
    }
    applyHostOrder(canvas, next, index);
  } else {
    applyHostOrder(resolved.host, next);
    resolved.host.dirty = true;
    resolved.host.setCoords();
  }
  canvas.requestRenderAll();
  return next;
}
