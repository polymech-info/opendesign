import { walkCanvasRecords } from "../shared/canvas-json";
import { normalizeUploadKey } from "./upload-paths";
import type { DesignDocument, DesignNode } from "./types";

/** IR props round-tripped as `nodeId.prop=value` lines in DSL. */
export const STYLE_PROPS = new Set([
  "fill",
  "stroke",
  "strokeWidth",
  "radius",
  "shadow",
  "glass",
  "glassOptions",
  "size",
  "font",
  "weight",
  "align",
]);

export const SKIP_PROPS = new Set(["x", "y", "w", "h", "width", "height", "widget", "id", "icon", "text", "src", "role", "preset", "style", "as"]);

/** Visual overrides only — never geometry or slot locals (those confuse design_get / agents). */
export function stylePropsOnly(props: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!value) continue;
    if ((key === "w" || key === "h") && value.includes("%")) {
      out[key] = value;
      continue;
    }
    if (SKIP_PROPS.has(key)) continue;
    if (!STYLE_PROPS.has(key) && key !== "icon") continue;
    out[key] = value;
  }
  return out;
}

export function serializeNodePropOverrides(node: DesignNode): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(node.props)) {
    if (!value || SKIP_PROPS.has(key)) continue;
    if (!STYLE_PROPS.has(key)) continue;
    lines.push(`${node.id}.${key}=${value}`);
  }
  return lines;
}

export function collectCanvasDesignIds(fabricRaw: string): Set<string> {
  const ids = new Set<string>();
  if (!fabricRaw || fabricRaw === "{}") return ids;
  try {
    const data = JSON.parse(fabricRaw) as { objects?: unknown };
    walkCanvasRecords(data.objects ?? [], (rec) => {
      if (typeof rec._id === "string" && rec._id.trim()) ids.add(rec._id.trim());
    });
  } catch {
    /* not fabric json */
  }
  return ids;
}

/**
 * Drop IR nodes the user already deleted on the canvas.
 * `_designDsl` is parsed as source of truth; without this, screenshot.pane etc. come back after the next tool run.
 */
export function pruneDocumentToCanvas(doc: DesignDocument, fabricRaw: string): string[] {
  if (!/"objects"\s*:/.test(fabricRaw)) return [];
  const ids = collectCanvasDesignIds(fabricRaw);
  const keepUse = new Set<string>();
  for (const node of doc.nodes) {
    if (node.type !== "use") continue;
    const kids = doc.nodes.filter((n) => n.parentId === node.id);
    if (ids.has(node.id) || kids.some((k) => ids.has(k.id))) keepUse.add(node.id);
  }
  const removed = doc.nodes
    .filter((n) => (n.type === "use" ? !keepUse.has(n.id) : !ids.has(n.id)))
    .map((n) => n.id);
  if (!removed.length) return [];
  doc.nodes = doc.nodes.filter((n) => (n.type === "use" ? keepUse.has(n.id) : ids.has(n.id)));
  return removed;
}

/** Pull live Fabric icon fills into IR when DSL predates a style patch. */
export function enrichDocumentFromFabric(doc: DesignDocument, fabricRaw: string): DesignDocument {
  pruneDocumentToCanvas(doc, fabricRaw);
  try {
    const data = JSON.parse(fabricRaw) as { objects?: unknown };
    walkCanvasRecords(data.objects ?? [], (rec) => {
      if (rec._id === "canvas.photo" && typeof rec.src === "string" && !doc.pageBackground) {
        doc.pageBackground = normalizeUploadKey(rec.src);
      }
      const id = typeof rec._id === "string" ? rec._id : "";
      if (!id) return;
      const node = doc.nodes.find((n) => n.id === id);
      if (!node || node.type !== "icon") return;
      const live =
        (typeof rec._iconFill === "string" && rec._iconFill) ||
        (typeof rec.fill === "string" && rec.fill.startsWith("#") ? rec.fill : "");
      if (live && !node.props.fill) node.props.fill = live;
    });
  } catch {
    /* not fabric json */
  }
  return doc;
}
