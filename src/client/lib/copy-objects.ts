import * as fabric from "fabric";
import { FABRIC_EXTRA_PROPS, applyCornerRadius } from "./image-radius";
import { configureElementGroup, isElementGroup } from "./element-group";
import { ensureStyleRenderer } from "./style-presets";
import { isBgImage } from "./background-image";
import { isIconObject } from "./tabler-icons";
import {
  findByLayerId,
  retargetCloneTree,
  collectIds,
  collectGroupNames,
  topLevelStackObject,
  type IdentifiedObject,
} from "./object-identity";

export const PASTE_OFFSET = 20;
const CLIP_MARK = "__opendObjects";

export type CopiedObjectItem = {
  json: Record<string, unknown>;
  left: number;
  top: number;
  scene: boolean;
  index: number;
  layerId: string;
};

export type CopiedObjectsPayload = {
  [typeof CLIP_MARK]: 1;
  v: 1;
  items: CopiedObjectItem[];
  spanHeight?: number;
  groupLike?: boolean;
};

function isGroupLike(obj: fabric.FabricObject) {
  return isElementGroup(obj) || !!(obj as IdentifiedObject)._elementSource;
}

export function sceneUnionBounds(objects: fabric.FabricObject[]): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (objects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const obj of objects) {
    const rect = obj.getBoundingRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function pasteShift(spanHeight: number, groupLike: boolean) {
  if (groupLike && spanHeight > 0) return { dx: PASTE_OFFSET, dy: spanHeight + PASTE_OFFSET };
  return { dx: PASTE_OFFSET, dy: PASTE_OFFSET };
}

export function isCopiedObjectsPayload(data: unknown): data is CopiedObjectsPayload {
  if (!data || typeof data !== "object") return false;
  const rec = data as CopiedObjectsPayload;
  return rec[CLIP_MARK] === 1 && Array.isArray(rec.items);
}

export function parseCopiedObjects(raw: string | undefined | null): CopiedObjectsPayload | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    return isCopiedObjectsPayload(data) ? data : null;
  } catch {
    return null;
  }
}

function capturePlacement(obj: fabric.FabricObject): { left: number; top: number; scene: boolean } {
  if (obj.group && !(obj.group instanceof fabric.ActiveSelection)) {
    const center = obj.getCenterPoint();
    return { left: center.x, top: center.y, scene: true };
  }
  return { left: obj.left || 0, top: obj.top || 0, scene: false };
}

export function captureCopiedObjects(
  canvas: fabric.Canvas,
  targets: fabric.FabricObject[]
): CopiedObjectsPayload | null {
  const items = targets
    .filter((obj) => !isBgImage(obj) && !(obj instanceof fabric.ActiveSelection))
    .map((obj) => {
      const place = capturePlacement(obj);
      const stack = topLevelStackObject(obj);
      return {
        json: obj.toObject([...FABRIC_EXTRA_PROPS]) as Record<string, unknown>,
        left: place.left,
        top: place.top,
        scene: place.scene,
        index: canvas.getObjects().indexOf(stack),
        layerId: (obj as IdentifiedObject)._layerId || "",
      };
    })
    .filter((item) => item.index >= 0 || item.layerId)
    .sort((a, b) => a.index - b.index);
  if (items.length === 0) return null;
  const live = targets.filter((obj) => !isBgImage(obj) && !(obj instanceof fabric.ActiveSelection));
  const bounds = sceneUnionBounds(live);
  return {
    [CLIP_MARK]: 1,
    v: 1,
    items,
    spanHeight: bounds?.height ?? 0,
    groupLike: live.some(isGroupLike),
  };
}

function reviveClone(obj: fabric.FabricObject) {
  ensureStyleRenderer(obj);
  const stored = (obj as { _cornerRadius?: number })._cornerRadius;
  if (typeof stored === "number") applyCornerRadius(obj, stored);
  if (isElementGroup(obj)) configureElementGroup(obj, obj._elementName);
  if (obj instanceof fabric.Group && !isIconObject(obj)) {
    for (const child of obj.getObjects()) reviveClone(child);
  }
}

function applyPastePlacement(
  clone: fabric.FabricObject,
  item: CopiedObjectItem,
  source: fabric.FabricObject | null,
  dx: number,
  dy: number
) {
  if (source && (!source.group || source.group instanceof fabric.ActiveSelection) && !item.scene) {
    clone.set({
      left: (source.left || 0) + dx,
      top: (source.top || 0) + dy,
    });
    return;
  }
  const origin = source && item.scene ? source.getCenterPoint() : null;
  const left = (origin ? origin.x : item.left) + dx;
  const top = (origin ? origin.y : item.top) + dy;
  if (item.scene) clone.setPositionByOrigin(new fabric.Point(left, top), "center", "center");
  else clone.set({ left, top });
}

function insertBelowSource(canvas: fabric.Canvas, clone: fabric.FabricObject, source: fabric.FabricObject | null) {
  const stackObj = source ? topLevelStackObject(source) : null;
  const idx = stackObj ? canvas.getObjects().indexOf(stackObj) : -1;
  if (idx >= 0) canvas.insertAt(idx, clone);
  else canvas.add(clone);
}

export async function pasteCopiedObjects(
  canvas: fabric.Canvas,
  payload: CopiedObjectsPayload
): Promise<fabric.FabricObject[]> {
  const ordered = [...payload.items].sort((a, b) => b.index - a.index);
  const raw = ordered.map((item) => item.json);
  const enlivened = (await fabric.util.enlivenObjects(raw as object[])).filter(
    (obj): obj is fabric.FabricObject => !!obj && typeof (obj as fabric.FabricObject).set === "function"
  );
  const clones: fabric.FabricObject[] = [];
  const takenIds = collectIds(canvas);
  const takenNames = collectGroupNames(canvas);
  const liveSources = payload.items
    .map((item) => findByLayerId(canvas, item.layerId))
    .filter((obj): obj is fabric.FabricObject => !!obj);
  const liveBounds = sceneUnionBounds(liveSources);
  const { dx, dy } = pasteShift(
    liveBounds?.height ?? payload.spanHeight ?? 0,
    payload.groupLike || liveSources.some(isGroupLike)
  );
  const wasRendering = canvas.renderOnAddRemove;
  canvas.renderOnAddRemove = false;
  try {
    for (let i = 0; i < enlivened.length; i++) {
      const clone = enlivened[i];
      const item = ordered[i];
      const source = findByLayerId(canvas, item.layerId);
      retargetCloneTree(clone, canvas, takenIds, takenNames);
      reviveClone(clone);
      applyPastePlacement(clone, item, source, dx, dy);
      insertBelowSource(canvas, clone, source);
      clone.setCoords();
      clones.push(clone);
    }
  } finally {
    canvas.renderOnAddRemove = wasRendering;
  }
  clones.reverse();
  canvas.requestRenderAll();
  return clones;
}

export async function cloneLiveObjects(
  canvas: fabric.Canvas,
  sources: fabric.FabricObject[]
): Promise<fabric.FabricObject[]> {
  const ranked = sources
    .filter((obj) => !isBgImage(obj) && !(obj instanceof fabric.ActiveSelection))
    .map((obj) => ({ obj, index: canvas.getObjects().indexOf(topLevelStackObject(obj)) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => b.index - a.index);
  const clones: fabric.FabricObject[] = [];
  const takenIds = collectIds(canvas);
  const takenNames = collectGroupNames(canvas);
  const live = ranked.map((entry) => entry.obj);
  const bounds = sceneUnionBounds(live);
  const { dx, dy } = pasteShift(bounds?.height ?? 0, live.some(isGroupLike));
  const wasRendering = canvas.renderOnAddRemove;
  canvas.renderOnAddRemove = false;
  try {
    for (const { obj, index } of ranked) {
      const clone = await obj.clone([...FABRIC_EXTRA_PROPS]);
      const place = capturePlacement(obj);
      retargetCloneTree(clone, canvas, takenIds, takenNames);
      reviveClone(clone);
      applyPastePlacement(
        clone,
        {
          json: {},
          left: place.left,
          top: place.top,
          scene: place.scene,
          index,
          layerId: (obj as IdentifiedObject)._layerId || "",
        },
        obj,
        dx,
        dy
      );
      insertBelowSource(canvas, clone, obj);
      clone.setCoords();
      clones.push(clone);
    }
  } finally {
    canvas.renderOnAddRemove = wasRendering;
  }
  clones.reverse();
  canvas.requestRenderAll();
  return clones;
}

let memoryClipboard: CopiedObjectsPayload | null = null;

export function rememberCopiedObjects(payload: CopiedObjectsPayload | null) {
  memoryClipboard = payload;
}

export function readRememberedCopiedObjects() {
  return memoryClipboard;
}

export async function writeCopiedObjectsToClipboard(payload: CopiedObjectsPayload) {
  rememberCopiedObjects(payload);
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
  } catch {
    // clipboard permission optional — in-memory copy still works
  }
}
