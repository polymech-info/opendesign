export type RecentUploadKind = "images" | "backgrounds";

export const RECENT_UPLOADS_MAX = 12;

function storageKey(kind: RecentUploadKind) {
  return `opend-recent-uploads:${kind}`;
}

export function bumpRecentUrls(list: string[], url: string, max = RECENT_UPLOADS_MAX): string[] {
  const next = url.trim();
  if (!next) return list.slice(0, max);
  return [next, ...list.filter((item) => item !== next)].slice(0, max);
}

export function readRecentUploadUrls(kind: RecentUploadKind): string[] {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, RECENT_UPLOADS_MAX);
  } catch {
    return [];
  }
}

export function rememberRecentUpload(kind: RecentUploadKind, url: string) {
  const next = bumpRecentUrls(readRecentUploadUrls(kind), url);
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
