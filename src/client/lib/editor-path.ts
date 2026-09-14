export const EDITOR_PANELS = [
  "chat",
  "templates",
  "text",
  "shapes",
  "icons",
  "layers",
  "images",
  "background",
  "designs",
  "versions",
] as const;

export type EditorPanel = (typeof EDITOR_PANELS)[number];

/** First open from home still lands on Templates. */
export const DEFAULT_EDITOR_PANEL: EditorPanel = "templates";

export function isEditorPanel(value: string | undefined | null): value is EditorPanel {
  return !!value && (EDITOR_PANELS as readonly string[]).includes(value);
}

export function parseEditorPanel(value: string | undefined | null): EditorPanel | null {
  return isEditorPanel(value) ? value : null;
}

export function editorHref(designId: string, panel?: EditorPanel | null): string {
  if (!panel) return `/design/${designId}`;
  return `/design/${designId}/${panel}`;
}

export function designIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/design\/([^/]+)/);
  return m?.[1] ?? null;
}

export function panelFromPath(pathname: string): EditorPanel | null {
  const m = pathname.match(/^\/design\/[^/]+\/([^/]+)\/?$/);
  return parseEditorPanel(m?.[1]);
}

export function exportIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/export\/([^/]+)\/?$/);
  return m?.[1] ?? null;
}
