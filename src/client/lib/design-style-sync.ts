import * as fabric from "fabric";
import type { DesignDocument, DesignNode } from "../../design/types";
import { findNode } from "../../design/types";
import { projectNodeById } from "../../design/project";
import { hydrateDesignIconFills } from "./design-icons";
import { hydrateDesignImages } from "./design-images";
import { applyImageCornerRadius, applyRectCornerRadius } from "./image-radius";
import { applyObjectPatch, pickStylePatchProps } from "./object-style";
import { readObjectId, topLevelStackObject, walkCanvasObjects } from "./object-identity";
import { isIconObject } from "./tabler-icons";
import { invalidateGlassBackdrop } from "./style-presets";

function findByDesignId(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  id: string,
): fabric.FabricObject | null {
  let found: fabric.FabricObject | null = null;
  walkCanvasObjects(canvas, (obj) => {
    if (found) return;
    if (readObjectId(obj) === id) found = obj;
  });
  return found;
}

/** Push IR fill/stroke/glass onto live objects so save JSON matches the design. */
export function applyDesignStylesToCanvas(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  doc: DesignDocument,
  ids?: string[],
): number {
  const unique = [...new Set((ids ?? doc.nodes.map((n) => n.id)).filter(Boolean))];
  let patched = 0;
  for (const id of unique) {
    const node = findNode(doc, id);
    if (!node || node.type === "use") continue;
    const projected = projectNodeById(doc, id);
    const obj = findByDesignId(canvas, id);
    if (!projected || !obj) continue;
    applyObjectPatch(obj, pickStylePatchProps(projected));
    patched += 1;
  }
  return patched;
}

function isInsideGroup(obj: fabric.FabricObject): boolean {
  return !!(obj.group && !(obj.group instanceof fabric.ActiveSelection));
}

function applyNodeFrame(obj: fabric.FabricObject, node: DesignNode, projected: Record<string, unknown> | null) {
  obj.set({
    originX: "left",
    originY: "top",
    left: node.bounds.x,
    top: node.bounds.y,
    scaleX: 1,
    scaleY: 1,
  });
  const isRect = obj instanceof fabric.Rect || String(obj.type || "").toLowerCase() === "rect";
  if (node.type === "txt" && (obj instanceof fabric.Textbox || obj instanceof fabric.IText)) {
    const text = typeof projected?.text === "string" ? projected.text : (node.text ?? "");
    obj.set({ width: node.bounds.w, text });
  } else if (node.type === "shape" && isRect) {
    obj.set({ width: node.bounds.w, height: node.bounds.h });
    const radius = Number(node.props.radius ?? projected?.rx ?? 0);
    if (Number.isFinite(radius)) applyRectCornerRadius(obj, radius);
  } else if (node.type === "icon") {
    const nw = Math.max(1, obj.width ?? 24);
    const nh = Math.max(1, obj.height ?? 24);
    const scale = Math.max(node.bounds.w, node.bounds.h) / Math.max(nw, nh);
    obj.set({ scaleX: scale, scaleY: scale });
  } else if (node.type === "img" && obj instanceof fabric.FabricImage) {
    const radius = Number(node.props.radius ?? 0);
    if (radius) applyImageCornerRadius(obj, radius);
  }
  obj.setCoords();
}

/** Move a grouped feature card as one stack; ungrouped cards get per-child frames. */
function syncUseInstance(canvas: fabric.Canvas, doc: DesignDocument, useId: string): number {
  const node = findNode(doc, useId);
  if (!node || node.type !== "use") return 0;
  const children = doc.nodes.filter((n) => n.parentId === useId);
  const objs = children.map((child) => findByDesignId(canvas, child.id)).filter((obj): obj is fabric.FabricObject => !!obj);
  if (!objs.length) return 0;

  const stacks = [...new Set(objs.map((obj) => topLevelStackObject(obj)))];
  const group = stacks.length === 1 ? stacks[0] : null;
  if (group instanceof fabric.Group && !isIconObject(group)) {
    group.set({ originX: "left", originY: "top", left: node.bounds.x, top: node.bounds.y });
    group.setCoords();
    return 1;
  }

  let n = 0;
  for (const child of children) {
    const obj = findByDesignId(canvas, child.id);
    const projected = projectNodeById(doc, child.id);
    if (!obj || !projected) continue;
    applyNodeFrame(obj, child, projected);
    n += 1;
  }
  return n;
}

/** Re-project IR style + bounds onto existing canvas objects — no full reload. */
export async function syncDesignNodesToCanvas(
  canvas: fabric.Canvas,
  doc: DesignDocument,
  ids: string[],
): Promise<boolean> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return false;

  let patched = 0;
  for (const id of unique) {
    const node = findNode(doc, id);
    if (node?.type === "use") {
      patched += syncUseInstance(canvas, doc, id);
      continue;
    }

    const projected = projectNodeById(doc, id);
    if (!projected) continue;
    const obj = findByDesignId(canvas, id);
    if (!obj) continue;
    applyObjectPatch(obj, pickStylePatchProps(projected));
    if (node && !isInsideGroup(obj)) applyNodeFrame(obj, node, projected);
    else if (typeof projected.text === "string") obj.set({ text: projected.text });
    patched += 1;
  }

  if (!patched) return false;
  await hydrateDesignImages(canvas, doc);
  await hydrateDesignIconFills(canvas, doc);
  invalidateGlassBackdrop(canvas);
  canvas.requestRenderAll();
  return true;
}
