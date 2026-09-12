import { walkCanvasRecords } from "../shared/canvas-json";
import { iconAssetUrl } from "./icons";
import { parseDsl } from "./parse";
import { serializeDsl } from "./serialize";
import { glassFromProps } from "./glass";
import { shadowFromProps } from "./shadow";
import { uploadPublicUrl } from "./upload-paths";
import { pruneDocumentToCanvas } from "./props-sync";
import { findNode, cloneDocument, type DesignDocument, type DesignNode } from "./types";

const LEFT_TOP = { originX: "left", originY: "top" } as const;

const ICON_TABLER: Record<string, string> = {
  chat: "message-circle",
  folder: "folder",
  search: "search",
  audio: "player-play",
  player: "player-play",
  "audio-player": "player-play",
  "player-play": "player-play",
};

const THEME_BG: Record<string, string> = {
  "tanit-light": "#e8eef6",
  "tanit-dark": "#12141a",
};

const SKIP_TYPES = new Set(["canvas", "theme", "widget", "use"]);

export type ProjectionReport = {
  ok: boolean;
  missing: string[];
  offCanvas: string[];
  instances: Array<{ id: string; children: number; projected: number; x: number; y: number }>;
};

export type FabricObjectJSON = Record<string, unknown>;

export type FabricCanvasJSON = {
  version: string;
  background: string;
  objects: FabricObjectJSON[];
  _designDsl?: string;
  _designSource?: string;
};

function mergedProps(doc: DesignDocument, node: DesignNode): Record<string, string> {
  const preset = node.preset ? doc.presets[node.preset]?.props ?? {} : {};
  const style = node.style ? doc.presets[node.style]?.props ?? {} : {};
  return { ...preset, ...style, ...node.props };
}

function resolvedText(doc: DesignDocument, node: DesignNode): string {
  if (node.text) return node.text;
  if (node.textBinding && doc.content[node.textBinding] != null) return doc.content[node.textBinding];
  return "";
}

function paint(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (v.startsWith("#") || /^(rgba?|hsla?)\(/i.test(v)) return v;
  return fallback;
}

function num(value: string | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tablerName(node: DesignNode): string {
  const raw = node.props.icon || node.src || "";
  return ICON_TABLER[raw] || raw || "circle";
}

function withVisualExtras(
  obj: FabricObjectJSON,
  props: Record<string, string>,
  opts?: { glass?: boolean },
): FabricObjectJSON {
  const glass = opts?.glass ? glassFromProps(props) : { enabled: false, extras: {} };
  const out: FabricObjectJSON = { ...obj, ...glass.extras };
  const shadow = shadowFromProps(props);
  if (shadow) {
    out.shadow = shadow;
    out.objectCaching = false;
  } else if (glass.enabled) {
    out.objectCaching = false;
  }
  return out;
}

function projectShape(doc: DesignDocument, node: DesignNode): FabricObjectJSON {
  const props = mergedProps(doc, node);
  const radius = num(props.radius, 0);
  const stroke = paint(props.stroke, "");
  const strokeWidth = props.strokeWidth != null && props.strokeWidth !== ""
    ? num(props.strokeWidth, stroke ? 1 : 0)
    : stroke
      ? 1
      : 0;
  return withVisualExtras(
    {
      type: "Rect",
      ...LEFT_TOP,
      left: node.bounds.x,
      top: node.bounds.y,
      width: node.bounds.w,
      height: node.bounds.h,
      fill: paint(props.fill, "#ffffff"),
      stroke,
      strokeWidth,
      rx: radius,
      ry: radius,
      _cornerRadius: radius,
      _id: node.id,
    },
    props,
    { glass: true },
  );
}

function projectText(doc: DesignDocument, node: DesignNode): FabricObjectJSON {
  const props = mergedProps(doc, node);
  const muted = node.role === "caption" || node.style === "caption";
  return withVisualExtras(
    {
      type: "Textbox",
      ...LEFT_TOP,
      left: node.bounds.x,
      top: node.bounds.y,
      width: node.bounds.w,
      text: resolvedText(doc, node),
      fontSize: num(props.size, 20),
      fontFamily: props.font || "Inter",
      fontWeight: props.weight || "400",
      fill: paint(props.fill, muted ? "#5b6475" : "#1c2430"),
      textAlign: props.align || "left",
      _id: node.id,
    },
    props,
  );
}

function projectIcon(doc: DesignDocument, node: DesignNode): FabricObjectJSON {
  const props = mergedProps(doc, node);
  const name = tablerName(node);
  const src = iconAssetUrl(name);
  const natural = 24;
  const scale = Math.max(node.bounds.w, node.bounds.h) / natural;
  const fill = paint(props.fill, "");
  return withVisualExtras(
    {
      type: "Image",
      ...LEFT_TOP,
      left: node.bounds.x,
      top: node.bounds.y,
      width: natural,
      height: natural,
      scaleX: scale,
      scaleY: scale,
      src,
      _id: node.id,
      _isIcon: true,
      _iconName: name,
      _iconUrl: src,
      ...(fill ? { _iconFill: fill, fill } : {}),
    },
    props,
  );
}

function projectNodeToFabric(doc: DesignDocument, node: DesignNode): FabricObjectJSON | null {
  if (SKIP_TYPES.has(node.type)) return null;
  if (node.type === "shape") return projectShape(doc, node);
  if (node.type === "txt") return projectText(doc, node);
  if (node.type === "icon") return projectIcon(doc, node);
  if (node.type === "img") {
    const raw = node.src || (node.imageBinding ? doc.content[node.imageBinding] : "");
    if (!raw || raw.startsWith("asset:") || raw.startsWith("@")) return null;
    const src = raw.startsWith("uploads/") ? uploadPublicUrl(raw) : raw;
    const radius = num(node.props.radius, 0);
    return {
      type: "Image",
      ...LEFT_TOP,
      left: node.bounds.x,
      top: node.bounds.y,
      src,
      _id: node.id,
      _designBounds: { w: node.bounds.w, h: node.bounds.h },
      ...(radius ? { _cornerRadius: radius, rx: radius, ry: radius } : {}),
    };
  }
  return null;
}

/** IR nodes that should appear as Fabric objects (excludes use/widget scaffolding). */
function projectPageBackground(doc: DesignDocument): FabricObjectJSON | null {
  if (!doc.pageBackground?.trim()) return null;
  const src = uploadPublicUrl(doc.pageBackground);
  return {
    type: "Image",
    ...LEFT_TOP,
    left: 0,
    top: 0,
    src,
    selectable: false,
    evented: false,
    _id: "canvas.photo",
    _isBgImage: true,
    _designBounds: { w: doc.canvas.width, h: doc.canvas.height },
  };
}

/** Project a single IR node (or canvas.photo) to Fabric JSON for in-canvas style sync. */
export function projectNodeById(doc: DesignDocument, nodeId: string): FabricObjectJSON | null {
  if (nodeId === "canvas.photo") return projectPageBackground(doc);
  const node = findNode(doc, nodeId);
  if (!node) return null;
  return projectNodeToFabric(doc, node);
}

export function projectableNodeIds(doc: DesignDocument): string[] {
  const ids: string[] = ["canvas.bg"];
  if (doc.pageBackground) ids.push("canvas.photo");
  for (const node of doc.nodes) {
    if (SKIP_TYPES.has(node.type)) continue;
    if (projectNodeToFabric(doc, node)) ids.push(node.id);
  }
  return ids;
}

function parseFabricCanvas(raw: string | FabricCanvasJSON): FabricCanvasJSON {
  return typeof raw === "string" ? (JSON.parse(raw) as FabricCanvasJSON) : raw;
}

/** Compare projected Fabric JSON against IR — catches missing cards after design_use_widget. */
export function validateFabricProjection(doc: DesignDocument, fabricJson: string | FabricCanvasJSON): ProjectionReport {
  const canvas = parseFabricCanvas(fabricJson);
  const fabricIds = new Set<string>();
  walkCanvasRecords(canvas.objects ?? [], (o) => {
    const id = typeof o._id === "string" ? o._id.trim() : "";
    if (id) fabricIds.add(id);
  });
  const expected = projectableNodeIds(doc);
  const missing = expected.filter((id) => !fabricIds.has(id));
  const offCanvas: string[] = [];
  const instances = doc.nodes
    .filter((n) => n.type === "use")
    .map((inst) => {
      const children = doc.nodes.filter((n) => n.parentId === inst.id);
      const projected = children.filter((c) => fabricIds.has(c.id)).length;
      const right = inst.bounds.x + inst.bounds.w;
      const bottom = inst.bounds.y + inst.bounds.h;
      if (
        inst.bounds.x >= doc.canvas.width ||
        inst.bounds.y >= doc.canvas.height ||
        right <= 0 ||
        bottom <= 0
      ) {
        offCanvas.push(inst.id);
      }
      return {
        id: inst.id,
        children: children.length,
        projected,
        x: inst.bounds.x,
        y: inst.bounds.y,
      };
    });
  for (const row of instances) {
    if (row.children > 0 && row.projected < row.children) {
      const prefix = `${row.id}.`;
      for (const child of doc.nodes.filter((n) => n.parentId === row.id)) {
        if (!fabricIds.has(child.id)) missing.push(child.id);
      }
    }
  }
  const uniqMissing = [...new Set(missing)];
  return { ok: uniqMissing.length === 0, missing: uniqMissing, offCanvas, instances };
}

export function projectToFabricJSON(
  doc: DesignDocument,
  opts?: { source?: string },
): string {
  const background = THEME_BG[doc.theme] || THEME_BG["tanit-light"];
  const objects: FabricObjectJSON[] = [
    {
      type: "Rect",
      ...LEFT_TOP,
      left: 0,
      top: 0,
      width: doc.canvas.width,
      height: doc.canvas.height,
      fill: background,
      selectable: false,
      evented: false,
      _id: "canvas.bg",
    },
  ];
  const photo = projectPageBackground(doc);
  if (photo) objects.push(photo);
  for (const node of doc.nodes) {
    const obj = projectNodeToFabric(doc, node);
    if (obj) objects.push(obj);
  }
  const canvas: FabricCanvasJSON = {
    version: "6.0.0",
    background,
    objects,
    _designDsl: serializeDsl(doc),
  };
  if (opts?.source) canvas._designSource = opts.source;
  return JSON.stringify(canvas);
}

export function documentFromCanvasJson(raw: string | null | undefined): DesignDocument | null {
  if (!raw || raw === "{}") return null;
  try {
    const data = JSON.parse(raw) as { _designDsl?: unknown };
    if (typeof data._designDsl === "string" && data._designDsl.trim()) {
      return parseDsl(data._designDsl);
    }
  } catch {
    /* not canvas json */
  }
  return null;
}

export function attachDesignDocument(json: string, doc: DesignDocument | null): string {
  if (!doc) return json;
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const next = cloneDocument(doc);
    pruneDocumentToCanvas(next, json);
    data._designDsl = serializeDsl(next);
    return JSON.stringify(data);
  } catch {
    return json;
  }
}
