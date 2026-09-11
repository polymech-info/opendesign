const LEGACY_IMAGE_URL = "image";
const DEAD_IMAGE_MARKERS = ["spider-10450253", "cdn.pixabay.com/photo/2026"];
const LOCAL_ASSET = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/.*)$/i;
const URL_KEYS = ["src", "image", "source", "_iconUrl"] as const;

export function rewriteLocalAssetUrl(src: string): string {
  const m = src.match(LOCAL_ASSET);
  return m ? m[1] : src;
}

function imageSrc(rec: Record<string, unknown>): string | null {
  if (typeof rec.src === "string") return rec.src;
  if (typeof rec[LEGACY_IMAGE_URL] === "string") return rec[LEGACY_IMAGE_URL] as string;
  return null;
}

function isDeadImageSrc(src: string): boolean {
  return DEAD_IMAGE_MARKERS.some((marker) => src.includes(marker));
}

export function walkCanvasRecords(node: unknown, visit: (rec: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkCanvasRecords(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  visit(rec);
  if (Array.isArray(rec.objects)) walkCanvasRecords(rec.objects, visit);
  if (rec.clipPath) walkCanvasRecords(rec.clipPath, visit);
  if (rec.fill && typeof rec.fill === "object") walkCanvasRecords(rec.fill, visit);
  if (rec.backgroundImage && typeof rec.backgroundImage === "object") {
    walkCanvasRecords(rec.backgroundImage, visit);
  }
}

export function rewriteCanvasRecordUrls(rec: Record<string, unknown>) {
  let rewroteSrc = false;
  for (const key of URL_KEYS) {
    const value = rec[key];
    if (typeof value !== "string" || !value) continue;
    const next = rewriteLocalAssetUrl(value);
    if (next === value) continue;
    rec[key] = next;
    if (key === "src" || key === "image") rewroteSrc = true;
  }
  if (rewroteSrc && rec.crossOrigin) rec.crossOrigin = null;
}

export type CanvasAsset = {
  kind: "background" | "image" | "pattern" | "icon" | "asset";
  src: string;
  id?: string;
};

function assetKind(rec: Record<string, unknown>, type: string): CanvasAsset["kind"] {
  if (rec._isBgImage === true) return "background";
  if (type === "image") return "image";
  if (type === "pattern" || typeof rec.source === "string") return "pattern";
  if (rec._isIcon === true || typeof rec._iconName === "string") return "icon";
  return "asset";
}

export function listCanvasAssets(data: Record<string, unknown>): CanvasAsset[] {
  const assets: CanvasAsset[] = [];
  const seen = new Set<string>();
  walkCanvasRecords(data.objects ?? data, (rec) => {
    const type = String(rec.type ?? "").toLowerCase();
    const srcs: string[] = [];
    if (typeof rec.src === "string") srcs.push(rec.src);
    else if (typeof rec.image === "string") srcs.push(rec.image);
    if (typeof rec.source === "string") srcs.push(rec.source);
    if (typeof rec._iconUrl === "string") srcs.push(rec._iconUrl);
    else if (typeof rec._iconName === "string" && rec._isIcon === true) {
      srcs.push(
        rec._iconName.includes(":")
          ? `/api/icons/svg?id=${encodeURIComponent(rec._iconName)}`
          : `/tabler-icons/${encodeURIComponent(rec._iconName)}.svg`
      );
    }
    for (const src of srcs) {
      if (!src || src.startsWith("data:")) continue;
      const kind = assetKind(rec, type);
      const key = `${kind}:${src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push({
        kind,
        src,
        id: typeof rec._id === "string" ? rec._id : typeof rec._iconName === "string" ? rec._iconName : undefined,
      });
    }
  });
  return assets;
}

export function parseFabricJSON(raw: string): Record<string, unknown> {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const objects = data.objects;
  if (!Array.isArray(objects)) {
    walkCanvasRecords(data, rewriteCanvasRecordUrls);
    return data;
  }
  data.objects = objects.filter((obj) => {
    if (!obj || typeof obj !== "object") return false;
    const rec = obj as Record<string, unknown>;
    const type = String(rec.type ?? "").toLowerCase();
    const src = imageSrc(rec);
    if (type === "image" && src && isDeadImageSrc(src)) return false;
    if (type === "image" && typeof rec.src !== "string" && src) {
      rec.src = src;
      delete rec[LEGACY_IMAGE_URL];
    }
    return true;
  });
  walkCanvasRecords(data, rewriteCanvasRecordUrls);
  return data;
}

export function sanitizeCanvasJSONString(raw: string): string {
  try {
    return JSON.stringify(parseFabricJSON(raw));
  } catch {
    return raw;
  }
}

export function uploadKeyFromUrl(src: string): string | null {
  const path = rewriteLocalAssetUrl(src);
  const m = path.match(/\/api\/uploads\/file\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
