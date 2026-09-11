import * as fabric from "fabric";

export const ICON_PAGE_SIZE = 96;
export const ICON_COMPACT_PAGE_SIZE = 32;

/** Matches the settings ribbon picker (`RIBBON_SUGGESTED_TABLER_ICONS`). */
export const SUGGESTED_TABLER_ICONS = [
  "settings",
  "message-circle",
  "player-play",
  "player-pause",
  "player-track-next",
  "player-stop",
  "layout-navbar",
  "layout-sidebar",
  "layout-bottom",
  "layout-right",
  "layout",
  "home",
  "resize",
  "theme",
  "rotate-clockwise",
  "search",
  "photo",
  "sparkles",
  "folder",
  "folder-open",
  "file",
  "file-text",
  "files",
  "archive",
  "video",
  "microphone",
  "palette",
  "wand",
  "refresh",
  "download",
  "upload",
  "trash",
  "bookmark",
  "moon",
  "stack-2",
  "tags",
  "plus",
  "x",
  "external-link",
  "copy",
  "camera",
  "volume",
  "crop-1-1",
  "zoom-in",
  "zoom-out",
] as const;

export type IconObject = fabric.FabricObject & {
  _isIcon?: boolean;
  _iconName?: string;
  _iconUrl?: string;
};

export function isIconObject(obj: fabric.FabricObject | null | undefined): obj is IconObject {
  return !!(obj as IconObject | undefined)?._isIcon;
}

export function tablerIconUrl(name: string) {
  return `/tabler-icons/${encodeURIComponent(name)}.svg`;
}

export function iconPreviewUrl(obj: fabric.FabricObject | null | undefined) {
  const icon = obj as IconObject | undefined;
  if (!icon) return tablerIconUrl("circle");
  if (icon._iconUrl) return icon._iconUrl;
  const name = icon._iconName || "circle";
  if (name.includes(":")) {
    return `/api/icons/svg?id=${encodeURIComponent(name)}`;
  }
  return tablerIconUrl(name);
}

export async function loadTablerIconNames(): Promise<string[]> {
  const resp = await fetch("/tabler-icons/index.json");
  const data = await resp.json();
  return Array.isArray(data) ? data.filter((n) => typeof n === "string") : [];
}

export function filterIconNames(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return names;
  return names
    .filter((name) => name.includes(q))
    .sort((a, b) => {
      const aStarts = a.startsWith(q);
      const bStarts = b.startsWith(q);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.localeCompare(b);
    });
}

function prepareSvg(svg: string, fill: string) {
  let out = svg
    .replace(/fill="currentColor"/g, `fill="${fill}"`)
    .replace(/stroke="currentColor"/g, `stroke="${fill}"`);
  out = out.replace(/<path\b([^>]*?)(\/?)>/g, (match, attrs: string, close: string) => {
    if (/\bfill\s*=/.test(attrs)) return match;
    return `<path fill="${fill}"${attrs}${close}>`;
  });
  return out;
}

function eachIconNode(obj: fabric.FabricObject, visit: (node: fabric.FabricObject) => void) {
  visit(obj);
  const group = obj as fabric.Group;
  if (typeof group.getObjects !== "function") return;
  for (const child of group.getObjects()) {
    eachIconNode(child, visit);
  }
}

function eachIconLeaf(obj: fabric.FabricObject, visit: (node: fabric.FabricObject) => void) {
  const group = obj as fabric.Group;
  if (typeof group.getObjects === "function") {
    const children = group.getObjects();
    if (children.length > 0) {
      for (const child of children) eachIconLeaf(child, visit);
      return;
    }
  }
  visit(obj);
}

function readHexColor(value: unknown): string {
  return typeof value === "string" && value.startsWith("#") ? value.slice(0, 7) : "";
}

export function applyIconFill(obj: fabric.FabricObject, fill: string) {
  eachIconNode(obj, (node) => {
    node.set({ fill });
    node.dirty = true;
  });
}

export function readIconFill(obj: fabric.FabricObject, fallback = "#6366f1"): string {
  const own = readHexColor(obj.fill);
  if (own) return own;
  let found = "";
  eachIconLeaf(obj, (node) => {
    if (!found) found = readHexColor(node.fill);
  });
  return found || fallback;
}

export function readIconStroke(obj: fabric.FabricObject, fallback = "#0f172a"): string {
  const own = readHexColor(obj.stroke);
  if (own) return own;
  let found = "";
  eachIconLeaf(obj, (node) => {
    if (!found) found = readHexColor(node.stroke);
  });
  return found || fallback;
}

export function readIconStrokeWidth(obj: fabric.FabricObject): number {
  const own = obj.strokeWidth;
  if (typeof own === "number" && own > 0) return own;
  let found = 0;
  eachIconLeaf(obj, (node) => {
    if (found <= 0 && typeof node.strokeWidth === "number") found = node.strokeWidth;
  });
  return found > 0 ? found : 0;
}

export function applyIconStroke(obj: fabric.FabricObject, stroke: unknown, strokeWidth?: number) {
  const color = typeof stroke === "string" ? stroke : "";
  const width = Math.max(0, strokeWidth ?? obj.strokeWidth ?? 0);
  const enabled = width > 0 && color !== "" && color !== "transparent" && color !== "none";
  const leafProps: Record<string, unknown> = enabled
    ? {
        stroke: color,
        strokeWidth: width,
        strokeUniform: true,
        paintFirst: "stroke",
        strokeLineJoin: "round",
        strokeLineCap: "round",
      }
    : {
        stroke: "",
        strokeWidth: 0,
      };

  eachIconLeaf(obj, (node) => {
    node.set(leafProps);
    node.objectCaching = !enabled;
    node.dirty = true;
  });

  obj.set({
    stroke: enabled ? color : "",
    strokeWidth: enabled ? width : 0,
    strokeUniform: true,
    padding: enabled ? Math.ceil(width) : 0,
    objectCaching: !enabled,
  });
  obj.dirty = true;
}

export async function createIconObjectFromSvg(
  svg: string,
  name: string,
  fill = "#6366f1",
  url?: string
): Promise<IconObject | null> {
  const { objects } = await fabric.loadSVGFromString(prepareSvg(svg, fill));
  const elements = (objects ?? []).filter((o): o is fabric.FabricObject => !!o);
  if (elements.length === 0) return null;
  // Group from path bounds only — SVG width/height on the root can differ from
  // viewBox and would scale X/Y independently (narrow/stretch icons).
  const obj = new fabric.Group(elements) as IconObject;
  obj.set({
    originX: "center",
    originY: "center",
    uniformScaling: true,
    lockScalingFlip: true,
  });
  obj.setCoords();
  obj._isIcon = true;
  obj._iconName = name;
  if (url) obj._iconUrl = url;
  applyIconFill(obj, fill);
  applyIconStroke(obj, "", 0);
  return obj;
}

export async function createTablerIconObject(name: string, fill = "#6366f1"): Promise<IconObject | null> {
  const resp = await fetch(tablerIconUrl(name));
  if (!resp.ok) return null;
  const raw = await resp.text();
  return createIconObjectFromSvg(raw, name, fill);
}
