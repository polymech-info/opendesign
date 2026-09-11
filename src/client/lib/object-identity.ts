import * as fabric from "fabric";
import { isIconObject } from "./tabler-icons";
import { isBgImage } from "./background-image";

export type IdentifiedObject = fabric.FabricObject & {
  _layerId?: string;
  _id?: string;
  _elementName?: string;
  _elementSource?: string;
};

function isNamedGroup(obj: fabric.FabricObject): obj is fabric.Group & { _elementName?: string } {
  return obj instanceof fabric.Group && !(obj instanceof fabric.ActiveSelection) && !isIconObject(obj);
}

const NUMBERED = /^(.*)_(\d+)$/;

export function splitNumbered(value: string): { base: string; n: number | null } {
  const trimmed = value.trim();
  const match = trimmed.match(NUMBERED);
  if (!match) return { base: trimmed, n: null };
  return { base: match[1], n: Number(match[2]) };
}

export function objectKindSlug(obj: fabric.FabricObject): string {
  const identified = obj as IdentifiedObject;
  if (identified._elementSource) return "element";
  if (isNamedGroup(obj)) return "group";
  if (isIconObject(obj)) return "icon";
  if (obj instanceof fabric.FabricImage) return "image";
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) return "text";
  if (obj instanceof fabric.Circle) return "circle";
  if (obj instanceof fabric.Triangle) return "triangle";
  if (obj instanceof fabric.Line) return "line";
  if (obj instanceof fabric.Rect) return "rect";
  return (obj.type || "object").toString().toLowerCase();
}

export function walkCanvasObjects(
  root: fabric.StaticCanvas | fabric.Group,
  visit: (obj: fabric.FabricObject) => void
) {
  for (const obj of root.getObjects()) {
    if (obj instanceof fabric.ActiveSelection) continue;
    visit(obj);
    if (obj instanceof fabric.Group && !isIconObject(obj)) walkCanvasObjects(obj, visit);
  }
}

export function collectIds(canvas: fabric.Canvas | null | undefined, except?: fabric.FabricObject | null) {
  const taken = new Set<string>();
  if (!canvas) return taken;
  walkCanvasObjects(canvas, (obj) => {
    if (obj === except) return;
    const id = (obj as IdentifiedObject)._id?.trim();
    if (id) taken.add(id);
  });
  return taken;
}

export function collectGroupNames(canvas: fabric.Canvas | null | undefined, except?: fabric.FabricObject | null) {
  const taken = new Set<string>();
  if (!canvas) return taken;
  walkCanvasObjects(canvas, (obj) => {
    if (obj === except || !isNamedGroup(obj)) return;
    const name = obj._elementName?.trim();
    if (name) taken.add(name);
  });
  return taken;
}

export function nextUnique(base: string, taken: Set<string>): string {
  const stem = splitNumbered(base).base.trim() || "object";
  let max = 0;
  if (taken.has(stem)) max = Math.max(max, 0);
  for (const id of taken) {
    const parts = splitNumbered(id);
    if (parts.base === stem && parts.n != null) max = Math.max(max, parts.n);
  }
  let n = max + 1;
  let candidate = `${stem}_${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem}_${n}`;
  }
  return candidate;
}

/** Keep `value` if free. If it collides, bump `_n`. */
export function uniqueIfTaken(value: string, taken: Set<string>): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!taken.has(trimmed)) return trimmed;
  return nextUnique(splitNumbered(trimmed).base, taken);
}

/** Copy/paste: `name_1` becomes the next free `name_n`. Unnumbered names stay if unique. */
export function uniqueCopied(value: string, taken: Set<string>): string {
  const trimmed = value.trim();
  if (!trimmed) return nextUnique("object", taken);
  const { base, n } = splitNumbered(trimmed);
  if (n == null) {
    if (!taken.has(trimmed)) return trimmed;
    return nextUnique(trimmed, taken);
  }
  return nextUnique(base, taken);
}

export function readObjectId(obj: fabric.FabricObject | null | undefined): string {
  return (obj as IdentifiedObject | undefined)?._id?.trim() || "";
}

export function readElementSource(obj: fabric.FabricObject | null | undefined): string {
  return (obj as IdentifiedObject | undefined)?._elementSource?.trim() || "";
}

export function ensureObjectIdentity(obj: fabric.FabricObject, canvas?: fabric.Canvas | null) {
  if (isBgImage(obj) || obj instanceof fabric.ActiveSelection) return;
  const identified = obj as IdentifiedObject;
  if (!identified._layerId) identified._layerId = crypto.randomUUID();
  const board = canvas ?? obj.canvas ?? null;
  const taken = collectIds(board, obj);
  const current = identified._id?.trim();
  if (!current || taken.has(current)) {
    identified._id = nextUnique(current ? splitNumbered(current).base : objectKindSlug(obj), taken);
  }
  if (obj instanceof fabric.Group && !isIconObject(obj)) {
    for (const child of obj.getObjects()) ensureObjectIdentity(child, board);
  }
}

export function restoreObjectIdentities(canvas: fabric.StaticCanvas | fabric.Canvas) {
  const taken = new Set<string>();
  walkCanvasObjects(canvas, (obj) => {
    if (isBgImage(obj) || obj instanceof fabric.ActiveSelection) return;
    const identified = obj as IdentifiedObject;
    if (!identified._layerId) identified._layerId = crypto.randomUUID();
    const current = identified._id?.trim();
    if (!current || taken.has(current)) {
      identified._id = nextUnique(current ? splitNumbered(current).base : objectKindSlug(obj), taken);
    }
    taken.add(identified._id);
  });
}

export function retargetCloneTree(
  obj: fabric.FabricObject,
  canvas: fabric.Canvas,
  takenIds?: Set<string>,
  takenNames?: Set<string>
) {
  const ids = takenIds ?? collectIds(canvas);
  const names = takenNames ?? collectGroupNames(canvas);
  const identified = obj as IdentifiedObject;
  identified._layerId = crypto.randomUUID();
  identified._id = uniqueCopied(identified._id || `${objectKindSlug(obj)}_1`, ids);
  ids.add(identified._id);
  if (isNamedGroup(obj)) {
    const name = obj._elementName?.trim();
    if (name) {
      obj._elementName = uniqueCopied(name, names);
      names.add(obj._elementName);
    }
  }
  if (obj instanceof fabric.Group && !isIconObject(obj)) {
    for (const child of obj.getObjects()) retargetCloneTree(child, canvas, ids, names);
  }
}

export function findByLayerId(canvas: fabric.Canvas, layerId: string | undefined): fabric.FabricObject | null {
  if (!layerId) return null;
  let found: fabric.FabricObject | null = null;
  walkCanvasObjects(canvas, (obj) => {
    if (found) return;
    if ((obj as IdentifiedObject)._layerId === layerId) found = obj;
  });
  return found;
}

export function topLevelStackObject(obj: fabric.FabricObject): fabric.FabricObject {
  let node = obj;
  while (node.group && !(node.group instanceof fabric.ActiveSelection)) node = node.group;
  return node;
}
