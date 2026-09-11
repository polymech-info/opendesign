export type IconSource = "local" | "iconify" | "all";

export type IconHit = {
  id: string;
  source: "local" | "iconify";
  aliases?: string[];
};

export type IconSearchArgs = {
  query?: string;
  source?: string;
  limit?: number;
};

/** Offline + brief catalog. Browser also merges `/tabler-icons/index.json`. */
const LOCAL: Array<{ id: string; aliases?: string[] }> = [
  { id: "message-circle", aliases: ["chat", "message", "talk"] },
  { id: "folder", aliases: ["files", "directory"] },
  { id: "folder-open", aliases: ["files"] },
  { id: "search", aliases: ["find", "lookup"] },
  { id: "player-play", aliases: ["audio", "player", "play", "music"] },
  { id: "player-pause", aliases: ["audio", "pause"] },
  { id: "player-stop", aliases: ["audio", "stop"] },
  { id: "player-track-next", aliases: ["audio", "next"] },
  { id: "volume", aliases: ["audio", "sound", "speaker"] },
  { id: "microphone", aliases: ["audio", "mic", "voice"] },
  { id: "photo", aliases: ["image", "picture"] },
  { id: "file", aliases: ["document"] },
  { id: "file-text", aliases: ["document"] },
  { id: "files", aliases: ["documents"] },
  { id: "home" },
  { id: "settings", aliases: ["gear"] },
  { id: "sparkles", aliases: ["ai", "magic"] },
  { id: "video" },
  { id: "camera" },
  { id: "download" },
  { id: "upload" },
  { id: "trash", aliases: ["delete"] },
  { id: "bookmark" },
  { id: "palette", aliases: ["color"] },
  { id: "layout" },
  { id: "plus" },
  { id: "x", aliases: ["close"] },
  { id: "copy" },
];

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/[_:]+/g, "-");
}

function localMatch(entry: { id: string; aliases?: string[] }, q: string): boolean {
  if (!q) return true;
  if (entry.id.includes(q) || norm(entry.id).includes(q)) return true;
  return (entry.aliases ?? []).some((alias) => alias.includes(q) || q.includes(alias));
}

export function searchIconsLocal(query: string, limit = 12): IconHit[] {
  const q = norm(query);
  const ranked = LOCAL.filter((entry) => localMatch(entry, q)).sort((a, b) => {
    const aStarts = a.id.startsWith(q) || (a.aliases ?? []).some((alias) => alias.startsWith(q));
    const bStarts = b.id.startsWith(q) || (b.aliases ?? []).some((alias) => alias.startsWith(q));
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return ranked.slice(0, Math.max(1, limit)).map((entry) => ({
    id: entry.id,
    source: "local" as const,
    aliases: entry.aliases,
  }));
}

function parseSource(raw: unknown): IconSource {
  const value = String(raw ?? "all").toLowerCase();
  if (value === "local" || value === "iconify") return value;
  return "all";
}

let tablerIndex: string[] | null = null;

async function loadTablerIndex(): Promise<string[]> {
  if (tablerIndex) return tablerIndex;
  if (typeof fetch !== "function") return [];
  try {
    const resp = await fetch("/tabler-icons/index.json");
    if (!resp.ok) return [];
    const data = await resp.json();
    tablerIndex = Array.isArray(data) ? data.filter((n): n is string => typeof n === "string") : [];
    return tablerIndex;
  } catch {
    return [];
  }
}

async function searchIconify(query: string, limit: number): Promise<IconHit[]> {
  if (typeof fetch !== "function" || query.trim().length < 2) return [];
  try {
    const params = new URLSearchParams({ q: query.trim(), start: "0", limit: String(limit) });
    const resp = await fetch(`/api/icons/search?${params}`);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { icons?: string[] };
    return (data.icons ?? []).filter((id) => typeof id === "string").map((id) => ({ id, source: "iconify" as const }));
  } catch {
    return [];
  }
}

export async function searchIcons(args: IconSearchArgs = {}): Promise<{
  ok: true;
  query: string;
  source: IconSource;
  icons: IconHit[];
}> {
  const query = String(args.query ?? "");
  const source = parseSource(args.source);
  const limit = Math.min(32, Math.max(1, Number(args.limit ?? 12) || 12));
  const icons: IconHit[] = [];
  const seen = new Set<string>();
  const push = (hit: IconHit) => {
    if (seen.has(hit.id) || icons.length >= limit) return;
    seen.add(hit.id);
    icons.push(hit);
  };

  if (source !== "iconify") {
    for (const hit of searchIconsLocal(query, limit)) push(hit);
    const q = norm(query);
    if (q) {
      for (const name of await loadTablerIndex()) {
        if (name.includes(q)) push({ id: name, source: "local" });
      }
    }
  }
  if (source !== "local") {
    for (const hit of await searchIconify(query, limit)) push(hit);
  }

  return { ok: true, query, source, icons };
}

export function iconAssetUrl(name: string): string {
  if (name.includes(":")) return `/api/icons/svg?id=${encodeURIComponent(name)}`;
  return `/tabler-icons/${encodeURIComponent(name)}.svg`;
}
