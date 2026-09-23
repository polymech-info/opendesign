import { findNode, type DesignDocument } from "./types";
import { serializeDsl } from "./serialize";
import {
  projectNodeById,
  projectToFabricJSON,
  type FabricCanvasJSON,
  type FabricObjectJSON,
} from "./project";

/** Style + copy keys that are safe to write onto live Fabric JSON. Never geometry. */
const STYLE_KEYS = [
  "fill",
  "stroke",
  "strokeWidth",
  "rx",
  "ry",
  "_cornerRadius",
  "shadow",
  "objectCaching",
  "_stylePreset",
  "_glassOptions",
  "_borderOptions",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "textAlign",
  "_iconFill",
  "_gradient",
  "_gradientMask",
  "opacity",
  "text",
] as const;

function isFabricGroup(rec: FabricObjectJSON): boolean {
  const type = String(rec.type ?? "").toLowerCase();
  return type === "group" && rec._isIcon !== true;
}

function walkObjects(
  objects: unknown[],
  parent: FabricObjectJSON | null,
  visit: (rec: FabricObjectJSON, parent: FabricObjectJSON | null) => void,
) {
  for (const item of objects) {
    if (!item || typeof item !== "object") continue;
    const rec = item as FabricObjectJSON;
    visit(rec, parent);
    if (Array.isArray(rec.objects)) walkObjects(rec.objects, rec, visit);
  }
}

export function fabricJsonHasGroups(raw: string | FabricCanvasJSON): boolean {
  try {
    const canvas = typeof raw === "string" ? (JSON.parse(raw) as FabricCanvasJSON) : raw;
    let found = false;
    walkObjects(canvas.objects ?? [], null, (rec) => {
      if (isFabricGroup(rec)) found = true;
    });
    return found;
  } catch {
    return false;
  }
}

function applyProjectedStyle(obj: FabricObjectJSON, projected: FabricObjectJSON) {
  for (const key of STYLE_KEYS) {
    if (key in projected) obj[key] = projected[key];
  }
  if (projected._isIcon) {
    if (typeof projected.src === "string") obj.src = projected.src;
    if (projected._iconName != null) obj._iconName = projected._iconName;
    if (projected._iconUrl != null) obj._iconUrl = projected._iconUrl;
  }
}

function applyProjectedFrame(obj: FabricObjectJSON, projected: FabricObjectJSON) {
  obj.originX = "left";
  obj.originY = "top";
  obj.scaleX = 1;
  obj.scaleY = 1;
  if (typeof projected.left === "number") obj.left = projected.left;
  if (typeof projected.top === "number") obj.top = projected.top;
  const type = String(obj.type ?? "").toLowerCase();
  if (type === "textbox" || type === "i-text" || type === "text" || type === "rect") {
    if (typeof projected.width === "number") obj.width = projected.width;
  }
  if (type === "rect" && typeof projected.height === "number") obj.height = projected.height;
}

const CANVAS_KEEP_IDS = new Set(["canvas.bg", "canvas.photo"]);

function collectIds(objects: unknown[]): Set<string> {
  const ids = new Set<string>();
  walkObjects(objects, null, (rec) => {
    const id = typeof rec._id === "string" ? rec._id.trim() : "";
    if (id) ids.add(id);
  });
  return ids;
}

function irKeepIds(doc: DesignDocument): Set<string> {
  const keep = new Set(CANVAS_KEEP_IDS);
  for (const node of doc.nodes) keep.add(node.id);
  return keep;
}

function filterDeletedObjects(objects: FabricObjectJSON[], keep: Set<string>): FabricObjectJSON[] {
  const next: FabricObjectJSON[] = [];
  for (const obj of objects) {
    if (isFabricGroup(obj) && Array.isArray(obj.objects)) {
      obj.objects = filterDeletedObjects(obj.objects as FabricObjectJSON[], keep);
      const id = typeof obj._id === "string" ? obj._id : "";
      const useId = id.startsWith("group.") ? id.slice("group.".length) : "";
      if (useId && !keep.has(useId) && obj.objects.length === 0) continue;
      if (!id && obj.objects.length === 0) continue;
      next.push(obj);
      continue;
    }
    const id = typeof obj._id === "string" ? obj._id.trim() : "";
    if (!id || keep.has(id)) next.push(obj);
  }
  return next;
}

/** Drop Fabric objects whose IR nodes were deleted (design_delete). */
export function removeDeletedFabricNodes(canvas: FabricCanvasJSON, doc: DesignDocument) {
  canvas.objects = filterDeletedObjects(canvas.objects ?? [], irKeepIds(doc));
}

function syncGroupedUseFrames(canvas: FabricCanvasJSON, doc: DesignDocument) {
  walkObjects(canvas.objects ?? [], null, (obj, parent) => {
    if (parent || !isFabricGroup(obj)) return;
    const childIds: string[] = [];
    walkObjects(Array.isArray(obj.objects) ? obj.objects : [], obj, (child) => {
      if (typeof child._id === "string" && child._id) childIds.push(child._id);
    });
    const parents = new Set(
      childIds.map((id) => findNode(doc, id)?.parentId).filter((id): id is string => Boolean(id)),
    );
    if (parents.size !== 1) return;
    const inst = findNode(doc, [...parents][0]!);
    if (!inst || inst.type !== "use") return;
    obj.left = inst.bounds.x;
    obj.top = inst.bounds.y;
    obj.originX = "left";
    obj.originY = "top";
  });
}

function syncPageBackground(canvas: FabricCanvasJSON, doc: DesignDocument) {
  const objects = canvas.objects ?? [];
  const idx = objects.findIndex((obj) => obj._id === "canvas.photo");
  const projected = projectNodeById(doc, "canvas.photo");
  if (!projected) {
    if (idx >= 0) objects.splice(idx, 1);
    return;
  }
  if (idx >= 0) {
    const current = objects[idx]!;
    applyProjectedStyle(current, projected);
    if (typeof projected.src === "string") current.src = projected.src;
    current._isBgImage = true;
    return;
  }
  let insertAt = objects.findIndex((obj) => obj._id === "canvas.bg") + 1;
  if (insertAt < 1) insertAt = 0;
  objects.splice(insertAt, 0, projected);
}

function insertTopNode(canvas: FabricCanvasJSON, doc: DesignDocument, projected: FabricObjectJSON, nodeId: string) {
  const objects = canvas.objects ?? [];
  const irIds = doc.nodes.filter((n) => !n.parentId).map((n) => n.id);
  const irIdx = irIds.indexOf(nodeId);
  let insertAt = objects.findIndex((o) => o._id === "canvas.bg") + 1;
  if (insertAt < 1) insertAt = 0;
  if (objects[insertAt]?._id === "canvas.photo") insertAt += 1;
  for (let i = 0; i < irIdx; i++) {
    const fabricIdx = objects.findIndex((o) => o._id === irIds[i]);
    if (fabricIdx >= 0) insertAt = fabricIdx + 1;
  }
  objects.splice(insertAt, 0, projected);
}

function appendMissingNodes(canvas: FabricCanvasJSON, doc: DesignDocument) {
  const existing = collectIds(canvas.objects ?? []);
  const missingByUse = new Map<string, FabricObjectJSON[]>();

  for (const node of doc.nodes) {
    if (existing.has(node.id)) continue;
    const projected = projectNodeById(doc, node.id);
    if (!projected) continue;
    if (node.parentId) {
      const list = missingByUse.get(node.parentId) ?? [];
      list.push(projected);
      missingByUse.set(node.parentId, list);
    } else {
      insertTopNode(canvas, doc, projected, node.id);
      existing.add(node.id);
    }
  }

  for (const [useId, kids] of missingByUse) {
    const inst = findNode(doc, useId);
    const siblings = doc.nodes.filter((n) => n.parentId === useId);
    const alreadyOnCanvas = siblings.some((s) => existing.has(s.id));
    if (!inst || inst.type !== "use" || alreadyOnCanvas) {
      canvas.objects.push(...kids);
      continue;
    }
    canvas.objects.push({
      type: "Group",
      originX: "left",
      originY: "top",
      left: inst.bounds.x,
      top: inst.bounds.y,
      _id: `group.${useId}`,
      _isElementGroup: true,
      objects: kids.map((kid) => ({
        ...kid,
        left: Number(kid.left ?? 0) - inst.bounds.x,
        top: Number(kid.top ?? 0) - inst.bounds.y,
      })),
    });
  }
}

/**
 * Write IR styles/copy/frames onto an existing Fabric JSON tree.
 * Groups stay groups — children keep their local frames.
 */
export function patchFabricJsonFromDocument(
  existing: string,
  doc: DesignDocument,
  opts?: { source?: string },
): string {
  const canvas = JSON.parse(existing) as FabricCanvasJSON;
  if (!Array.isArray(canvas.objects)) canvas.objects = [];

  removeDeletedFabricNodes(canvas, doc);
  syncPageBackground(canvas, doc);

  walkObjects(canvas.objects, null, (obj, parent) => {
    const id = typeof obj._id === "string" ? obj._id : "";
    if (!id) return;
    const projected = projectNodeById(doc, id);
    if (!projected) return;
    applyProjectedStyle(obj, projected);
    if (!parent || !isFabricGroup(parent)) applyProjectedFrame(obj, projected);
  });

  syncGroupedUseFrames(canvas, doc);
  appendMissingNodes(canvas, doc);

  canvas._designDsl = serializeDsl(doc);
  if (opts?.source) canvas._designSource = opts.source;
  return JSON.stringify(canvas);
}

/**
 * CLI save path. Existing editor grouping is authored only in Fabric JSON,
 * not in IR — a full projectToFabricJSON rewrite explodes cards.
 */
export function writeCliCanvasJson(
  existing: string | null | undefined,
  doc: DesignDocument,
  opts?: { source?: string },
): string {
  if (!existing || existing === "{}") return projectToFabricJSON(doc, opts);
  try {
    const parsed = JSON.parse(existing) as FabricCanvasJSON;
    if (!Array.isArray(parsed.objects) || parsed.objects.length === 0) {
      return projectToFabricJSON(doc, opts);
    }
    return patchFabricJsonFromDocument(existing, doc, opts);
  } catch {
    return projectToFabricJSON(doc, opts);
  }
}
