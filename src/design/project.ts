import { iconAssetUrl } from "./icons";
import { parseDsl } from "./parse";
import { serializeDsl } from "./serialize";
import type { DesignDocument, DesignNode } from "./types";

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

function hex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.startsWith("#") ? value : fallback;
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

function projectShape(doc: DesignDocument, node: DesignNode): FabricObjectJSON {
  const props = mergedProps(doc, node);
  const radius = num(props.radius, 0);
  return {
    type: "Rect",
    ...LEFT_TOP,
    left: node.bounds.x,
    top: node.bounds.y,
    width: node.bounds.w,
    height: node.bounds.h,
    fill: hex(props.fill, "#ffffff"),
    stroke: hex(props.stroke, ""),
    strokeWidth: props.stroke ? 1 : 0,
    rx: radius,
    ry: radius,
    _cornerRadius: radius,
    _id: node.id,
  };
}

function projectText(doc: DesignDocument, node: DesignNode): FabricObjectJSON {
  const props = mergedProps(doc, node);
  const muted = node.role === "caption" || node.style === "caption";
  return {
    type: "Textbox",
    ...LEFT_TOP,
    left: node.bounds.x,
    top: node.bounds.y,
    width: node.bounds.w,
    text: resolvedText(doc, node),
    fontSize: num(props.size, 20),
    fontFamily: props.font || "Inter",
    fontWeight: props.weight || "400",
    fill: hex(props.fill, muted ? "#5b6475" : "#1c2430"),
    textAlign: props.align || "left",
    _id: node.id,
  };
}

function projectIcon(node: DesignNode): FabricObjectJSON {
  const name = tablerName(node);
  const src = iconAssetUrl(name);
  const natural = 24;
  const scale = Math.max(node.bounds.w, node.bounds.h) / natural;
  return {
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
  };
}

function projectNodeToFabric(doc: DesignDocument, node: DesignNode): FabricObjectJSON | null {
  if (SKIP_TYPES.has(node.type)) return null;
  if (node.type === "shape") return projectShape(doc, node);
  if (node.type === "txt") return projectText(doc, node);
  if (node.type === "icon") return projectIcon(node);
  if (node.type === "img") {
    const src = node.src || (node.imageBinding ? doc.content[node.imageBinding] : "");
    if (!src || src.startsWith("asset:") || src.startsWith("@")) return null;
    return {
      type: "Image",
      ...LEFT_TOP,
      left: node.bounds.x,
      top: node.bounds.y,
      width: node.bounds.w,
      height: node.bounds.h,
      src,
      _id: node.id,
    };
  }
  return null;
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
      _isBgImage: true,
    },
  ];
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
    data._designDsl = serializeDsl(doc);
    return JSON.stringify(data);
  } catch {
    return json;
  }
}
