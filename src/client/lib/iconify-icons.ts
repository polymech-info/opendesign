import { createIconObjectFromSvg, createTablerIconObject, type IconObject } from "./tabler-icons";

export type IconPick =
  | { source: "local"; name: string }
  | { source: "iconify"; id: string }
  | { source: "saved"; name: string; url: string };

export type SavedIcon = { key: string; filename: string; url: string; id: string };

export const ICONIFY_PAGE_SIZE = 32;

export function parseIconifyId(id: string): { prefix: string; name: string } | null {
  const colon = id.indexOf(":");
  if (colon <= 0 || colon === id.length - 1) return null;
  return { prefix: id.slice(0, colon), name: id.slice(colon + 1) };
}

export function iconifyPreviewUrl(id: string) {
  const parsed = parseIconifyId(id);
  if (!parsed) return "";
  return `/api/icons/svg?id=${encodeURIComponent(`${parsed.prefix}:${parsed.name}`)}`;
}

export function svgToMaskUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const previewCache = new Map<string, string>();

export async function loadIconifyPreviews(ids: string[]): Promise<Record<string, string>> {
  const missing = ids.filter((id) => id && !previewCache.has(id));
  if (missing.length > 0) {
    const resp = await fetch("/api/icons/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: missing }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { svgs?: Record<string, string> };
      for (const [id, svg] of Object.entries(data.svgs ?? {})) {
        if (svg) {
          if (previewCache.size > 400) {
            const first = previewCache.keys().next().value;
            if (first) previewCache.delete(first);
          }
          previewCache.set(id, svg);
        }
      }
    }
  }
  const out: Record<string, string> = {};
  for (const id of ids) {
    const svg = previewCache.get(id);
    if (svg) out[id] = svg;
  }
  return out;
}

export function iconIdFromFilename(filename: string) {
  const base = filename.replace(/\.svg$/i, "");
  const sep = base.indexOf("--");
  if (sep <= 0) return base;
  return `${base.slice(0, sep)}:${base.slice(sep + 2)}`;
}

export async function searchIconify(
  query: string,
  start = 0,
  limit = ICONIFY_PAGE_SIZE
): Promise<{ icons: string[]; total: number; error?: string }> {
  const q = query.trim();
  if (q.length < 2) return { icons: [], total: 0 };
  const params = new URLSearchParams({ q, start: String(start), limit: String(limit) });
  const resp = await fetch(`/api/icons/search?${params}`);
  if (resp.status === 429) return { icons: [], total: 0, error: "Iconify is rate-limiting — wait a moment and search again" };
  if (!resp.ok) return { icons: [], total: 0, error: "Iconify search failed" };
  const data = (await resp.json()) as { icons?: string[]; total?: number };
  return { icons: Array.isArray(data.icons) ? data.icons : [], total: data.total ?? 0 };
}

export async function listSavedIcons(): Promise<SavedIcon[]> {
  const resp = await fetch("/api/uploads?kind=icons");
  if (!resp.ok) return [];
  const data = (await resp.json()) as { items?: { key: string; filename: string; url: string }[] };
  return (data.items ?? []).map((item) => ({
    ...item,
    id: iconIdFromFilename(item.filename),
  }));
}

export async function downloadIconifyIcon(id: string): Promise<{ id: string; url: string; svg: string } | null> {
  const resp = await fetch("/api/icons/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { id?: string; url?: string; svg?: string };
  if (!data.svg || !data.url || !data.id) return null;
  window.dispatchEvent(new Event("opend-uploads-changed"));
  return { id: data.id, url: data.url, svg: data.svg };
}

export async function createIconFromPick(pick: IconPick, fill = "#6366f1"): Promise<IconObject | null> {
  if (pick.source === "local") return createTablerIconObject(pick.name, fill);
  if (pick.source === "saved") {
    const resp = await fetch(pick.url);
    if (!resp.ok) return null;
    return createIconObjectFromSvg(await resp.text(), pick.name, fill, pick.url);
  }
  const saved = await downloadIconifyIcon(pick.id);
  if (saved) return createIconObjectFromSvg(saved.svg, saved.id, fill, saved.url);
  const cached = previewCache.get(pick.id);
  if (!cached) return null;
  return createIconObjectFromSvg(cached, pick.id, fill);
}

export function sameIconPick(pick: IconPick, current?: string) {
  if (!current) return false;
  if (pick.source === "local") return pick.name === current;
  if (pick.source === "iconify") return pick.id === current;
  return pick.name === current;
}
