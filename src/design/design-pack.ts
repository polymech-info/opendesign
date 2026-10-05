import { listCanvasAssets, uploadKeyFromUrl } from "../shared/canvas-json";

import { isZipBytes, readZip, writeZip } from "../shared/zip-store";

export const DESIGN_PACK_FORMAT = "opendesign-pack";
export const DESIGN_PACK_VERSION = 1;
export const DESIGN_PACK_ZIP_EXT = ".odpack.zip";
export const DESIGN_PACK_JSON_EXT = ".odpack.json";

export type DesignPackPage = {
  title: string;
  canvas_json: string;
  sort_order: number;
};

export type DesignPackDesign = {
  name: string;
  width: number;
  height: number;
  canvas_json: string;
  thumbnail_url: string | null;
  pages: DesignPackPage[];
};

export type DesignPackAsset = {
  key: string;
  contentType: string;
  data: string;
};

export type DesignPack = {
  format: typeof DESIGN_PACK_FORMAT;
  version: typeof DESIGN_PACK_VERSION;
  exported_at: string;
  designs: DesignPackDesign[];
  assets: DesignPackAsset[];
  missing: string[];
};

export type DesignPackSource = {
  name: string;
  width: number;
  height: number;
  canvas_json: string;
  thumbnail_url?: string | null;
  pages?: { title?: string; canvas_json?: string; sort_order?: number }[];
};

export type DesignPackImportResult = {
  designs: { id: string; name: string }[];
  written: number;
  reused: number;
  missing: string[];
};

const PUBLIC_PREFIX = "/api/uploads/file/";
const UPLOAD_IN_URL = /\/api\/uploads\/file\/(uploads\/(?:[A-Za-z0-9._~%-]+\/)*[A-Za-z0-9._~%-]+)/g;
const BARE_UPLOAD = /(?:^|["'\s=])(uploads\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+)/g;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}

export function designPackFilename(names: string[]): string {
  if (names.length === 1) {
    const slug = names[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `${slug || "design"}${DESIGN_PACK_ZIP_EXT}`;
  }
  return `designs${DESIGN_PACK_ZIP_EXT}`;
}

export function packToZip(pack: DesignPack): Uint8Array {
  return writeZip([
    {
      name: "pack.json",
      data: new TextEncoder().encode(
        JSON.stringify({
          ...pack,
          assets: pack.assets.map(({ key, contentType }) => ({ key, contentType })),
        }),
      ),
    },
    ...pack.assets.map((asset) => ({
      name: asset.key.replace(/\\/g, "/"),
      data: base64ToBytes(asset.data),
    })),
  ]);
}

export function packFromZip(bytes: Uint8Array): DesignPack {
  const files = new Map(readZip(bytes).map((entry) => [entry.name.replace(/\\/g, "/"), entry.data]));
  const manifest = files.get("pack.json");
  if (!manifest) throw new Error("Zip is missing pack.json");
  const row = asRecord(JSON.parse(new TextDecoder().decode(manifest)), "Pack");
  const listed = Array.isArray(row.assets) ? row.assets : [];
  const missing = new Set(
    Array.isArray(row.missing) ? row.missing.filter((key): key is string => typeof key === "string") : [],
  );
  const assets: DesignPackAsset[] = [];
  for (const item of listed) {
    const asset = asRecord(item, "Asset");
    const key = typeof asset.key === "string" ? asset.key.replace(/\\/g, "/") : "";
    const data = files.get(key);
    if (!key || !data) {
      if (key) missing.add(key);
      continue;
    }
    assets.push({
      key,
      contentType: typeof asset.contentType === "string" ? asset.contentType : contentTypeForKey(key),
      data: bytesToBase64(data),
    });
  }
  const seen = new Set(assets.map((asset) => asset.key));
  for (const [name, data] of files) {
    if (name === "pack.json" || !name.startsWith("uploads/") || seen.has(name)) continue;
    assets.push({ key: name, contentType: contentTypeForKey(name), data: bytesToBase64(data) });
  }
  return parseDesignPack({ ...row, assets, missing: [...missing] });
}

export function parsePackBytes(bytes: Uint8Array): DesignPack {
  if (isZipBytes(bytes)) return packFromZip(bytes);
  return parseDesignPack(JSON.parse(new TextDecoder().decode(bytes)));
}

function rememberKey(keys: Set<string>, raw: string) {
  let key = (raw.split("?")[0] ?? raw).trim();
  try {
    key = decodeURIComponent(key);
  } catch {
    /* keep the raw key */
  }
  if (!key.startsWith("uploads/") || key.includes("..")) return;
  const name = key.split("/").pop() || "";
  if (!name.includes(".") || name.endsWith(".")) return;
  keys.add(key);
}

function skipEmbedded(src: string): boolean {
  return (
    !src ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.includes("/tabler-icons/") ||
    src.includes("/api/icons/")
  );
}

/** Upload keys referenced by canvas JSON, DSL text, or a thumbnail URL. */
export function collectUploadKeys(...texts: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(new RegExp(UPLOAD_IN_URL.source, "g"))) {
      if (match[1]) rememberKey(keys, match[1]);
    }
    for (const match of text.matchAll(new RegExp(BARE_UPLOAD.source, "g"))) {
      if (match[1]) rememberKey(keys, match[1]);
    }
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      for (const asset of listCanvasAssets(data)) {
        if (skipEmbedded(asset.src)) continue;
        if (/^https?:\/\//i.test(asset.src) && !asset.src.includes("/api/uploads/file/")) continue;
        const fromUrl = uploadKeyFromUrl(asset.src);
        if (fromUrl) rememberKey(keys, fromUrl);
        else if (asset.src.startsWith("uploads/")) rememberKey(keys, asset.src);
      }
    } catch {
      /* plain text, thumbnail URL, or DSL */
    }
  }
  return [...keys];
}

export function rewriteUploadKeys(text: string, map: Map<string, string>): string {
  if (!text || map.size === 0) return text;
  const pairs = [...map.entries()]
    .filter(([from, to]) => from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [from, to] of pairs) {
    out = out.split(PUBLIC_PREFIX + from).join(PUBLIC_PREFIX + to);
    out = out.split(`"${from}"`).join(`"${to}"`);
    out = out.split(`'${from}'`).join(`'${to}'`);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function suffixedKey(key: string, n: number): string {
  const slash = key.lastIndexOf("/");
  const dir = slash >= 0 ? key.slice(0, slash + 1) : "";
  const file = slash >= 0 ? key.slice(slash + 1) : key;
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  return `${dir}${stem}-import-${n}${ext}`;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseDesignPack(raw: unknown): DesignPack {
  const row = asRecord(raw, "Pack");
  if (row.format !== DESIGN_PACK_FORMAT) throw new Error("Not an OpenDesign pack");
  if (row.version !== DESIGN_PACK_VERSION) throw new Error(`Unsupported pack version: ${String(row.version)}`);
  if (!Array.isArray(row.designs) || row.designs.length === 0) throw new Error("Pack has no designs");
  const designs: DesignPackDesign[] = row.designs.map((item, index) => {
    const design = asRecord(item, `Design ${index + 1}`);
    const pages = Array.isArray(design.pages) ? design.pages : [];
    return {
      name: typeof design.name === "string" && design.name.trim() ? design.name : "Untitled Design",
      width: Number(design.width) > 0 ? Number(design.width) : 1080,
      height: Number(design.height) > 0 ? Number(design.height) : 1080,
      canvas_json: typeof design.canvas_json === "string" ? design.canvas_json : "{}",
      thumbnail_url: typeof design.thumbnail_url === "string" ? design.thumbnail_url : null,
      pages: pages.map((page, pageIndex) => {
        const rec = asRecord(page, `Design ${index + 1} page ${pageIndex + 1}`);
        return {
          title: typeof rec.title === "string" && rec.title.trim() ? rec.title : `Page ${pageIndex + 1}`,
          canvas_json: typeof rec.canvas_json === "string" ? rec.canvas_json : "{}",
          sort_order: Number.isFinite(Number(rec.sort_order)) ? Number(rec.sort_order) : pageIndex,
        };
      }),
    };
  });
  const assets: DesignPackAsset[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(row.assets) ? row.assets : []) {
    const asset = asRecord(item, "Asset");
    const key = typeof asset.key === "string" ? asset.key : "";
    if (!key.startsWith("uploads/") || key.includes("..") || seen.has(key)) continue;
    if (typeof asset.data !== "string" || !asset.data) throw new Error(`Asset ${key} has no data`);
    seen.add(key);
    assets.push({
      key,
      contentType: typeof asset.contentType === "string" ? asset.contentType : contentTypeForKey(key),
      data: asset.data,
    });
  }
  const missing = Array.isArray(row.missing)
    ? row.missing.filter((key): key is string => typeof key === "string")
    : [];
  return {
    format: DESIGN_PACK_FORMAT,
    version: DESIGN_PACK_VERSION,
    exported_at: typeof row.exported_at === "string" ? row.exported_at : new Date().toISOString(),
    designs,
    assets,
    missing,
  };
}

function sourceTexts(design: DesignPackSource | DesignPackDesign): string[] {
  return [
    design.canvas_json,
    design.thumbnail_url,
    ...(design.pages ?? []).map((page) => page.canvas_json),
  ].filter((text): text is string => typeof text === "string");
}

export async function buildDesignPack(
  designs: DesignPackSource[],
  readAsset: (key: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>,
): Promise<DesignPack> {
  if (!designs.length) throw new Error("No designs to export");
  const keys = collectUploadKeys(...designs.flatMap(sourceTexts));
  const assets: DesignPackAsset[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const hit = await readAsset(key);
    if (!hit) {
      missing.push(key);
      continue;
    }
    assets.push({
      key,
      contentType: hit.contentType || contentTypeForKey(key),
      data: bytesToBase64(hit.bytes),
    });
  }
  return {
    format: DESIGN_PACK_FORMAT,
    version: DESIGN_PACK_VERSION,
    exported_at: new Date().toISOString(),
    designs: designs.map((design) => ({
      name: design.name,
      width: design.width,
      height: design.height,
      canvas_json: design.canvas_json,
      thumbnail_url: design.thumbnail_url ?? null,
      pages: (design.pages ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((page, index) => ({
          title: page.title?.trim() || `Page ${index + 1}`,
          canvas_json: page.canvas_json || "{}",
          sort_order: page.sort_order ?? index,
        })),
    })),
    assets,
    missing,
  };
}

export async function applyDesignPack(
  raw: unknown,
  io: {
    readAsset: (key: string) => Promise<Uint8Array | null>;
    writeAsset: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
    writeDesign: (design: DesignPackDesign) => Promise<{ id: string; name: string }>;
  },
): Promise<DesignPackImportResult> {
  const pack = parseDesignPack(raw);
  const map = new Map<string, string>();
  let written = 0;
  let reused = 0;
  for (const asset of pack.assets) {
    const bytes = base64ToBytes(asset.data);
    let candidate = asset.key;
    let placed = false;
    for (let n = 0; n < 1000; n++) {
      const existing = await io.readAsset(candidate);
      if (!existing) {
        await io.writeAsset(candidate, bytes, asset.contentType || contentTypeForKey(candidate));
        written += 1;
        placed = true;
        break;
      }
      if (sameBytes(existing, bytes)) {
        reused += 1;
        placed = true;
        break;
      }
      candidate = suffixedKey(asset.key, n + 1);
    }
    if (!placed) throw new Error(`No free name for ${asset.key}`);
    if (candidate !== asset.key) map.set(asset.key, candidate);
  }

  const designs = [];
  const missing = new Set<string>();
  for (const design of pack.designs) {
    const next: DesignPackDesign = {
      ...design,
      canvas_json: rewriteUploadKeys(design.canvas_json, map),
      thumbnail_url: design.thumbnail_url ? rewriteUploadKeys(design.thumbnail_url, map) : null,
      pages: design.pages.map((page) => ({
        ...page,
        canvas_json: rewriteUploadKeys(page.canvas_json, map),
      })),
    };
    for (const key of collectUploadKeys(...sourceTexts(next))) {
      const bytes = await io.readAsset(key);
      if (!bytes) missing.add(key);
    }
    designs.push(await io.writeDesign(next));
  }
  return { designs, written, reused, missing: [...missing] };
}
