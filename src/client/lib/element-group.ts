import * as fabric from "fabric";
import { FABRIC_EXTRA_PROPS } from "./image-radius";
import { isIconObject } from "./tabler-icons";
import { selectedCanvasObjects } from "./object-style";
import { invalidateGlassBackdrop } from "./style-presets";

export type ElementGroup = fabric.Group & {
  _isElementGroup?: boolean;
  _elementName?: string;
};

export function isElementGroup(obj: fabric.FabricObject | null | undefined): obj is ElementGroup {
  if (!obj || obj instanceof fabric.ActiveSelection) return false;
  if (!(obj instanceof fabric.Group)) return false;
  if (isIconObject(obj)) return false;
  return true;
}

export function elementDisplayName(obj: fabric.FabricObject | null | undefined, fallback = "Group") {
  const name = (obj as ElementGroup | undefined)?._elementName?.trim();
  return name || fallback;
}

export function isInsideElementGroup(obj: fabric.FabricObject | null | undefined): boolean {
  return !!(obj && obj.group && isElementGroup(obj.group));
}

export function owningElementGroup(obj: fabric.FabricObject | null | undefined): ElementGroup | null {
  if (!obj) return null;
  if (isElementGroup(obj)) return obj;
  let parent = obj.group;
  while (parent) {
    if (isElementGroup(parent)) return parent;
    parent = parent.group;
  }
  return null;
}

let elementGroupCtrlPick = false;

export function configureElementGroup(group: fabric.Group, name?: string) {
  const g = group as ElementGroup;
  g._isElementGroup = true;
  if (name) g._elementName = name;
  g.subTargetCheck = true;
  g.objectCaching = false;
  applyElementGroupCtrlPick(g, elementGroupCtrlPick);
  g.setCoords();
}

export function restoreElementGroups(root: fabric.StaticCanvas | fabric.Group) {
  const objects = root.getObjects();
  for (const obj of objects) {
    if (isElementGroup(obj)) {
      configureElementGroup(obj, (obj as ElementGroup)._elementName);
      restoreElementGroups(obj);
    }
  }
}

function pickInnerFromGroup(group: fabric.Group, subTargets: fabric.FabricObject[]) {
  const children = new Set(group.getObjects());
  for (let i = subTargets.length - 1; i >= 0; i--) {
    const candidate = subTargets[i];
    if (children.has(candidate)) return candidate;
  }
  const inner = subTargets[0];
  if (!inner) return null;
  for (const child of group.getObjects()) {
    if (child === inner) return child;
    const asGroup = child as fabric.Group;
    if (typeof asGroup.contains === "function" && asGroup.contains(inner, true)) return child;
  }
  return null;
}

export function innerTargetFromEvent(
  target: fabric.FabricObject | undefined,
  subTargets: fabric.FabricObject[] | undefined
): fabric.FabricObject | null {
  if (!isElementGroup(target)) return null;
  return pickInnerFromGroup(target, subTargets ?? []);
}

function applyElementGroupCtrlPick(group: fabric.Group, on: boolean) {
  group.interactive = on;
  group.hoverCursor = on ? "pointer" : "move";
  for (const child of group.getObjects()) {
    child.hoverCursor = on ? "pointer" : "move";
    if (isElementGroup(child)) applyElementGroupCtrlPick(child, on);
  }
}

export function setElementGroupsCtrlPick(canvas: fabric.Canvas, on: boolean) {
  elementGroupCtrlPick = on;
  for (const obj of canvas.getObjects()) {
    if (isElementGroup(obj)) applyElementGroupCtrlPick(obj, on);
  }
}

export function hitTestGroupChild(
  group: fabric.Group,
  canvas: fabric.Canvas,
  e: MouseEvent | Event
): fabric.FabricObject | null {
  group.setCoords();
  const scene = canvas.getScenePoint(e as never);
  const local = fabric.util.sendPointToPlane(scene, undefined, group.calcTransformMatrix());
  const objects = group.getObjects();
  const hit = (point: ReturnType<fabric.Canvas["getScenePoint"]>) => {
    for (let i = objects.length - 1; i >= 0; i--) {
      const child = objects[i];
      if (!child.visible || child.evented === false) continue;
      if (!child.containsPoint(point)) continue;
      if (isElementGroup(child)) return hitTestGroupChild(child, canvas, e) ?? child;
      return child;
    }
    return null;
  };
  return hit(scene) ?? hit(local);
}

export function resolveCtrlClickedChild(
  canvas: fabric.Canvas,
  target: fabric.FabricObject | undefined,
  subTargets: fabric.FabricObject[] | undefined,
  e: MouseEvent | Event
): fabric.FabricObject | null {
  if (target && isInsideElementGroup(target)) return target;
  const group = owningElementGroup(target);
  if (!group) return null;
  return innerTargetFromEvent(group, subTargets) ?? hitTestGroupChild(group, canvas, e);
}

export function abortCanvasTransform(canvas: fabric.Canvas) {
  (canvas as unknown as { _currentTransform: null })._currentTransform = null;
}

export function groupSelectedObjects(canvas: fabric.Canvas): ElementGroup | null {
  const objects = selectedCanvasObjects(canvas).filter((obj) => !(obj as { _isBgImage?: boolean })._isBgImage);
  if (objects.length < 2) return null;

  const stack = canvas.getObjects();
  const ranked = objects
    .map((obj) => ({ obj, index: stack.indexOf(obj) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (ranked.length < 2) return null;

  const insertAt = ranked[0].index;
  const ordered = ranked.map((entry) => entry.obj);

  canvas.discardActiveObject();
  const wasRendering = canvas.renderOnAddRemove;
  canvas.renderOnAddRemove = false;
  let group: ElementGroup | null = null;
  try {
    for (const obj of ordered) canvas.remove(obj);
    group = new fabric.Group(ordered) as ElementGroup;
    configureElementGroup(group);
    for (const child of group.getObjects()) {
      child.objectCaching = false;
      child.dirty = true;
    }
    invalidateGlassBackdrop(canvas);
    canvas.insertAt(insertAt, group);
    canvas.setActiveObject(group);
  } finally {
    canvas.renderOnAddRemove = wasRendering;
  }
  canvas.requestRenderAll();
  return group;
}

export function ungroupElement(canvas: fabric.Canvas, group: fabric.Group): fabric.FabricObject[] {
  const items = group.removeAll();
  const index = canvas.getObjects().indexOf(group);
  canvas.remove(group);
  items.forEach((obj, i) => {
    canvas.add(obj);
    if (index >= 0) canvas.moveObjectTo(obj, index + i);
  });
  if (items.length > 1) {
    const sel = new fabric.ActiveSelection(items, { canvas });
    canvas.setActiveObject(sel);
  } else if (items[0]) {
    canvas.setActiveObject(items[0]);
  }
  canvas.requestRenderAll();
  return items;
}

export function serializeAsElement(obj: fabric.FabricObject) {
  const json = obj.toObject([...FABRIC_EXTRA_PROPS]);
  const bound = obj.getBoundingRect();
  return {
    object: json,
    width: Math.max(1, Math.round(bound.width)),
    height: Math.max(1, Math.round(bound.height)),
  };
}

export async function enlivenLibraryElement(canvasJson: string): Promise<fabric.FabricObject | null> {
  const data = JSON.parse(canvasJson) as { objects?: unknown[]; object?: unknown };
  const raw = Array.isArray(data.objects) ? data.objects : data.object ? [data.object] : [data];
  const objects = (await fabric.util.enlivenObjects(raw as object[])).filter(
    (o): o is fabric.FabricObject => !!o && typeof (o as fabric.FabricObject).set === "function"
  );
  if (objects.length === 0) return null;
  if (objects.length === 1) {
    const obj = objects[0];
    if (isElementGroup(obj)) configureElementGroup(obj, (obj as ElementGroup)._elementName);
    return obj;
  }
  const group = new fabric.Group(objects);
  configureElementGroup(group);
  return group;
}
