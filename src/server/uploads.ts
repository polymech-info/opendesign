import fs from "node:fs";
import path from "node:path";
import { layerRoot, mergeOrder, type Layer, type Roots } from "./paths.js";

export type UploadKind = "images" | "backgrounds" | "icons";

export type ListedUpload = {
  key: string;
  filename: string;
  url: string;
  source: Layer;
};

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function mime(filename: string) {
  return MIME[filename.split(".").pop()?.toLowerCase() || "png"] || "application/octet-stream";
}

function sanitizeKey(key: string) {
  const cleaned = key.replace(/\\/g, "/").replace(/[^a-zA-Z0-9._/-]/g, "");
  const parts = cleaned.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

function prefixFor(kind: UploadKind) {
  if (kind === "backgrounds") return "uploads/backgrounds/";
  if (kind === "icons") return "uploads/icons/";
  return "uploads/";
}

function assertUploadKey(key: string) {
  const safe = sanitizeKey(key);
  if (!safe.startsWith("uploads/")) throw new Error("Invalid upload key");
  return safe;
}

function publicUrl(key: string) {
  return `/api/uploads/file/${key}`;
}

function abs(root: string, key: string) {
  return path.join(root, key.split("/").join(path.sep));
}

export function putUpload(
  roots: Roots,
  kind: UploadKind,
  filename: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
  layer: Layer = "project"
): ListedUpload {
  const safeName = sanitizeKey(filename).split("/").pop() || filename;
  const key = assertUploadKey(prefixFor(kind) + safeName);
  const file = abs(layerRoot(roots, layer), key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data)));
  void contentType;
  return { key, filename: safeName, url: publicUrl(key), source: layer };
}

export function getUpload(
  roots: Roots,
  key: string
): { data: Buffer; contentType: string; source: Layer } | null {
  const safe = sanitizeKey(key);
  for (const entry of [...mergeOrder(roots)].reverse()) {
    const file = abs(entry.root, safe);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    return { data: fs.readFileSync(file), contentType: mime(safe), source: entry.layer };
  }
  return null;
}

export function deleteUpload(roots: Roots, key: string): boolean {
  const safe = assertUploadKey(key);
  for (const entry of [...mergeOrder(roots)].reverse()) {
    const file = abs(entry.root, safe);
    if (!fs.existsSync(file)) continue;
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

function listRoot(root: string, kind: UploadKind, layer: Layer): ListedUpload[] {
  const prefix = prefixFor(kind);
  const dir = abs(root, prefix.replace(/\/$/, ""));
  if (!fs.existsSync(dir)) return [];
  const items: ListedUpload[] = [];
  for (const filename of fs.readdirSync(dir)) {
    const file = path.join(dir, filename);
    if (!fs.statSync(file).isFile()) continue;
    if (kind === "images" && (filename === "backgrounds" || filename === "icons")) continue;
    const key = prefix + filename;
    items.push({ key, filename, url: publicUrl(key), source: layer });
  }
  return items;
}

export function listUploads(roots: Roots, kind: UploadKind): ListedUpload[] {
  const layers = mergeOrder(roots).map((entry) => listRoot(entry.root, kind, entry.layer));
  const map = new Map<string, ListedUpload>();
  for (const layer of layers) {
    for (const item of layer) map.set(item.filename, item);
  }
  return [...map.values()].sort((a, b) => b.filename.localeCompare(a.filename));
}
