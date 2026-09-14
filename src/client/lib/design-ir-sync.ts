import * as fabric from "fabric";
import { insertImage, setPageBackground, updateObjects } from "../../design/mutate";
import { getActiveDocument, setActiveDocument } from "../../design/tools";
import { findNode } from "../../design/types";
import { resolveUploadKey, uploadPublicUrl } from "../../design/upload-paths";
import { readObjectId } from "./object-identity";
import { captureObjectStyle } from "./object-style";

export function patchPageBackgroundInIr(patch: { src?: string; clear?: boolean }) {
  const doc = getActiveDocument();
  if (!doc) return;
  setPageBackground(doc, patch);
  setActiveDocument(doc);
}

export function imageBoundsFromFabric(img: fabric.FabricImage) {
  const w = Math.max(1, Math.abs((img.width || 1) * (img.scaleX || 1)));
  const h = Math.max(1, Math.abs((img.height || 1) * (img.scaleY || 1)));
  const tl = img.getPointByOrigin("left", "top");
  return {
    x: Math.round(tl.x),
    y: Math.round(tl.y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function syncImageNodeInIr(img: fabric.FabricImage) {
  const doc = getActiveDocument();
  if (!doc) return;
  const id = readObjectId(img);
  if (!id) return;
  const bounds = imageBoundsFromFabric(img);
  const src =
    (typeof img.getSrc === "function" ? img.getSrc() : "") ||
    ((img.getElement() as { src?: string } | null)?.src ?? "");
  if (!src) return;
  const key = resolveUploadKey(src);
  const publicSrc = uploadPublicUrl(key);
  const node = findNode(doc, id);
  if (node?.type === "img") {
    updateObjects(doc, {
      patches: [{ id, set: { src: publicSrc, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } }],
    });
  } else if (!node) {
    insertImage(doc, { id, src: key, ...bounds });
  }
  setActiveDocument(doc);
}

/** Write a live sidebar/canvas style edit into the IR so Save keeps it. */
export function syncObjectStyleInIr(obj: fabric.FabricObject) {
  const doc = getActiveDocument();
  if (!doc) return;
  const id = readObjectId(obj);
  if (!id) return;
  const node = findNode(doc, id);
  if (!node || (node.type !== "shape" && node.type !== "txt" && node.type !== "icon")) return;
  const style = captureObjectStyle(obj);
  const set: Record<string, unknown> = {};
  if (typeof style.fill === "string" && style.fill) set.fill = style.fill;
  const shadow = style.shadow
    ? {
        x: style.shadow.offsetX,
        y: style.shadow.offsetY,
        blur: style.shadow.blur,
        color: style.shadow.color,
      }
    : "none";
  if (node.type === "shape") {
    if (style.stroke != null) set.stroke = style.stroke;
    if (style.strokeWidth != null) set.strokeWidth = style.strokeWidth;
    set.glass = style.stylePreset === "glass";
    set.border = style.stylePreset === "border";
    if (style.stylePreset === "glass") set.glassOptions = style.glassOptions;
    if (style.stylePreset === "border") set.borderOptions = style.borderOptions;
    set.shadow = shadow;
    if (style.cornerRadius != null) set.radius = style.cornerRadius;
  }
  if (node.type === "txt") {
    if (style.fontSize != null) set.size = style.fontSize;
    if (style.fontFamily) set.font = style.fontFamily;
    if (style.fontWeight != null) set.weight = String(style.fontWeight);
    if (style.textAlign) set.align = style.textAlign;
    if (style.fontStyle) set.style = style.fontStyle;
    set.shadow = shadow;
  }
  if (node.type === "icon") {
    set.shadow = shadow;
  }
  if (!Object.keys(set).length) return;
  updateObjects(doc, { patches: [{ id, set }] });
  setActiveDocument(doc);
}

/** Keep IR node order aligned with Fabric stack (back → front). */
export function syncStackOrderInIr(ordered: fabric.FabricObject[]) {
  const doc = getActiveDocument();
  if (!doc) return;
  const ids = ordered.map(readObjectId).filter(Boolean);
  if (ids.length === 0) return;
  const known = new Set(ids);
  const byId = new Map(doc.nodes.filter((node) => known.has(node.id)).map((node) => [node.id, node]));
  const queued = ids.map((id) => byId.get(id)).filter((node): node is NonNullable<typeof node> => !!node);
  if (queued.length === 0) return;
  let i = 0;
  const next = doc.nodes.map((node) => {
    if (!known.has(node.id)) return node;
    return queued[i++] ?? node;
  });
  while (i < queued.length) next.push(queued[i++]);
  doc.nodes = next;
  setActiveDocument(doc);
}
