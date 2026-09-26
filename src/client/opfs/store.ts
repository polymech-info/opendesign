import { SEED_TEMPLATES } from "../../server/seed-templates";
import { sanitizeCanvasJSONString } from "../../shared/canvas-json";
import type {
  Design,
  DesignRevision,
  DesignVersion,
  DesignVersionDetail,
  DesignWithPages,
  LibraryElement,
  Page,
  SavedStyle,
  Template,
} from "../types";

const ROOT_NAME = "opendesign";

type StoredDesign = DesignWithPages;

type UploadRow = {
  key: string;
  filename: string;
  kind: string;
  mime: string;
  mtime: number;
};

type Db = {
  designs: StoredDesign[];
  versions: DesignVersionDetail[];
  elements: LibraryElement[];
  styles: SavedStyle[];
  uploads: UploadRow[];
};

const empty = (): Db => ({
  designs: [],
  versions: [],
  elements: [],
  styles: [],
  uploads: [],
});

let mem: Db | null = null;
let opening: Promise<Db> | null = null;
let chain: Promise<unknown> = Promise.resolve();
const memoryFiles = new Map<string, Uint8Array>();
let opfsRoot: FileSystemDirectoryHandle | null | undefined;

function lock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function nowIso() {
  return new Date().toISOString();
}

function hashText(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

function mimeForName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  return "application/octet-stream";
}

function appBase() {
  const url = new URL(document.baseURI);
  url.hash = "";
  url.search = "";
  if (url.pathname.endsWith("/")) return url.href;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) url.pathname = url.pathname.replace(/[^/]*$/, "");
  else url.pathname += "/";
  return url.href;
}

function staticAssetUrl(rel: string) {
  if (typeof document === "undefined") return `/${rel}`;
  return new URL(rel, appBase()).href;
}

function withoutPages(row: StoredDesign): Design {
  const { pages: _pages, ...design } = row;
  return design;
}

async function directory() {
  if (opfsRoot !== undefined) return opfsRoot;
  try {
    const root = await navigator.storage.getDirectory();
    opfsRoot = await root.getDirectoryHandle(ROOT_NAME, { create: true });
  } catch {
    opfsRoot = null;
  }
  return opfsRoot;
}

async function nestedDir(root: FileSystemDirectoryHandle, parts: string[], create: boolean) {
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function readBytes(key: string): Promise<Uint8Array | null> {
  const cached = memoryFiles.get(key);
  if (cached) return cached;
  const root = await directory();
  if (!root) return null;
  const parts = key.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  try {
    const dir = await nestedDir(root, ["files", ...parts], false);
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function writeBytes(key: string, bytes: Uint8Array) {
  memoryFiles.set(key, bytes);
  const root = await directory();
  if (!root) return;
  const parts = key.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  const dir = await nestedDir(root, ["files", ...parts], true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

async function removeBytes(key: string) {
  memoryFiles.delete(key);
  const root = await directory();
  if (!root) return;
  const parts = key.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  try {
    const dir = await nestedDir(root, ["files", ...parts], false);
    await dir.removeEntry(name);
  } catch {
    /* already gone */
  }
}

async function readDbFile(): Promise<Db | null> {
  const root = await directory();
  if (!root) return null;
  try {
    const handle = await root.getFileHandle("db.json");
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as Db;
  } catch {
    return null;
  }
}

async function writeDbFile(db: Db) {
  const root = await directory();
  if (!root) return;
  const handle = await root.getFileHandle("db.json", { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(db));
  await writable.close();
}

function seedDesign(templateId: string, db: Db) {
  const template = SEED_TEMPLATES.find((row) => row.id === templateId);
  if (!template) return;
  const created = nowIso();
  const id = crypto.randomUUID();
  const canvas = sanitizeCanvasJSONString(template.canvas_json);
  const page: Page = {
    id: crypto.randomUUID(),
    design_id: id,
    title: "Page 1",
    canvas_json: canvas,
    sort_order: 0,
    created_at: created,
  };
  db.designs.push({
    id,
    name: template.name,
    canvas_json: canvas,
    width: template.width,
    height: template.height,
    thumbnail_url: null,
    created_at: created,
    updated_at: created,
    updated_by: "editor",
    pages: [page],
  });
}

async function db(): Promise<Db> {
  if (mem) return mem;
  if (!opening) opening = loadDb();
  return opening;
}

async function loadDb(): Promise<Db> {
  const stored = await readDbFile();
  if (stored) {
    mem = {
      designs: stored.designs ?? [],
      versions: stored.versions ?? [],
      elements: stored.elements ?? [],
      styles: stored.styles ?? [],
      uploads: stored.uploads ?? [],
    };
    return mem;
  }
  mem = empty();
  seedDesign("quote-card", mem);
  seedDesign("stats-highlight", mem);
  await writeDbFile(mem);
  return mem;
}

async function save(store: Db) {
  mem = store;
  await writeDbFile(store);
}

function findDesign(store: Db, id: string) {
  return store.designs.find((row) => row.id === id) ?? null;
}

function touch(row: StoredDesign) {
  row.updated_at = nowIso();
  row.updated_by = "editor";
  row.canvas_json = row.pages[0]?.canvas_json ?? row.canvas_json;
  row.pages = [...row.pages].sort((a, b) => a.sort_order - b.sort_order);
}

function contentHash(row: StoredDesign) {
  return hashText(JSON.stringify({ canvas: row.canvas_json, pages: row.pages }));
}

function versionMeta(row: DesignVersionDetail): DesignVersion {
  const { canvas_json: _canvas, pages: _pages, thumbnail_url: _thumb, ...meta } = row;
  return meta;
}

function dataUrlBytes(image: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(image);
  if (!match) return null;
  const bin = atob(match[2].replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mime = match[1];
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return { bytes, mime, ext };
}

function uploadKind(raw: string | null | undefined) {
  if (raw === "backgrounds" || raw === "icons" || raw === "screenshots") return raw;
  return "images";
}

function uploadPrefix(kind: string) {
  if (kind === "backgrounds") return "uploads/backgrounds/";
  if (kind === "icons") return "uploads/icons/";
  if (kind === "screenshots") return "uploads/screenshots/";
  return "uploads/";
}

function listedUpload(row: UploadRow, kind: string) {
  if (kind === "images") {
    return (
      row.key.startsWith("uploads/") &&
      !row.key.startsWith("uploads/backgrounds/") &&
      !row.key.startsWith("uploads/icons/") &&
      !row.key.startsWith("uploads/screenshots/") &&
      !row.key.startsWith("uploads/thumbs/")
    );
  }
  return row.key.startsWith(uploadPrefix(kind));
}

async function dataUrlForKey(store: Db, key: string) {
  const bytes = await readBytes(key);
  if (!bytes) return null;
  const row = store.uploads.find((item) => item.key === key);
  return bytesToDataUrl(bytes, row?.mime || mimeForName(key));
}

async function liveUrl(store: Db, url: string | null | undefined) {
  if (!url) return url ?? null;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  const path = url.split("?")[0] ?? url;
  const tabler = /\/tabler-icons\/([a-z0-9-]+)\.svg$/i.exec(path);
  if (tabler) return staticAssetUrl(`tabler-icons/${tabler[1]}.svg`);
  const upload = /\/api\/uploads\/file\/(uploads\/.+)$/.exec(path);
  if (!upload?.[1]) return url;
  return (await dataUrlForKey(store, decodeURIComponent(upload[1]))) || url;
}

async function liveCanvas(store: Db, raw: string) {
  if (!raw || (!raw.includes("/tabler-icons/") && !raw.includes("/api/uploads/file/"))) return raw;
  let out = raw.replace(/\/tabler-icons\/([a-z0-9-]+)\.svg/gi, (_match, name: string) =>
    staticAssetUrl(`tabler-icons/${name}.svg`),
  );
  const keys = new Set<string>();
  for (const match of out.matchAll(/\/api\/uploads\/file\/(uploads\/[A-Za-z0-9._/-]+)/g)) {
    if (match[1]) keys.add(match[1]);
  }
  for (const key of keys) {
    const data = await dataUrlForKey(store, key);
    if (data) out = out.split(`/api/uploads/file/${key}`).join(data);
  }
  return out;
}

async function liveDesign(store: Db, row: StoredDesign): Promise<StoredDesign> {
  const pages = [];
  for (const page of [...row.pages].sort((a, b) => a.sort_order - b.sort_order)) {
    pages.push({ ...page, canvas_json: await liveCanvas(store, page.canvas_json) });
  }
  return {
    ...row,
    canvas_json: await liveCanvas(store, row.canvas_json),
    thumbnail_url: await liveUrl(store, row.thumbnail_url),
    pages,
  };
}

async function listUploads(store: Db, kind: string) {
  const items = [];
  for (const row of store.uploads) {
    if (!listedUpload(row, kind)) continue;
    const bytes = await readBytes(row.key);
    if (!bytes) continue;
    items.push({
      key: row.key,
      filename: row.filename,
      url: bytesToDataUrl(bytes, row.mime || mimeForName(row.filename)),
      source: "project" as const,
      mtime: row.mtime,
    });
  }
  return items;
}

async function putUpload(store: Db, key: string, filename: string, kind: string, mime: string, bytes: Uint8Array) {
  await writeBytes(key, bytes);
  const row: UploadRow = { key, filename, kind, mime, mtime: Date.now() };
  store.uploads = store.uploads.filter((item) => item.key !== key);
  store.uploads.push(row);
  return { key, filename, url: bytesToDataUrl(bytes, mime), source: "project" as const, mtime: row.mtime };
}

function templates(): Template[] {
  return SEED_TEMPLATES.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    canvas_json: sanitizeCanvasJSONString(row.canvas_json),
    width: row.width,
    height: row.height,
    thumbnail_url: null,
    sort_order: row.sort_order,
  })).sort((a, b) => a.sort_order - b.sort_order);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function route(method: string, path: string, query: URLSearchParams, body: unknown): Promise<unknown> {
  const store = await db();
  const designId = path.match(/^\/api\/designs\/([^/]+)$/);
  const revision = path.match(/^\/api\/designs\/([^/]+)\/revision$/);
  const thumbnail = path.match(/^\/api\/designs\/([^/]+)\/thumbnail$/);
  const duplicate = path.match(/^\/api\/designs\/([^/]+)\/duplicate$/);
  const versions = path.match(/^\/api\/designs\/([^/]+)\/versions$/);
  const version = path.match(/^\/api\/designs\/([^/]+)\/versions\/(\d+)$/);
  const restore = path.match(/^\/api\/designs\/([^/]+)\/versions\/(\d+)\/restore$/);
  const pages = path.match(/^\/api\/designs\/([^/]+)\/pages$/);
  const page = path.match(/^\/api\/pages\/([^/]+)$/);
  const pageCopy = path.match(/^\/api\/pages\/([^/]+)\/duplicate$/);
  const style = path.match(/^\/api\/styles\/([^/]+)$/);
  const element = path.match(/^\/api\/elements\/([^/]+)$/);

  if (method === "GET" && path === "/api/designs") {
    const listed = [];
    for (const row of [...store.designs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      const design = withoutPages(row);
      design.thumbnail_url = await liveUrl(store, design.thumbnail_url);
      listed.push(design);
    }
    return listed;
  }
  if (method === "POST" && path === "/api/designs") {
    const input = (body ?? {}) as { name?: string; canvas_json?: string; width?: number; height?: number };
    const created = nowIso();
    const id = crypto.randomUUID();
    const canvas = sanitizeCanvasJSONString(input.canvas_json || "{}");
    const row: StoredDesign = {
      id,
      name: input.name || "Untitled Design",
      canvas_json: canvas,
      width: input.width || 1080,
      height: input.height || 1080,
      thumbnail_url: null,
      created_at: created,
      updated_at: created,
      updated_by: "editor",
      pages: [
        {
          id: crypto.randomUUID(),
          design_id: id,
          title: "Page 1",
          canvas_json: canvas,
          sort_order: 0,
          created_at: created,
        },
      ],
    };
    store.designs.push(row);
    await save(store);
    return withoutPages(row);
  }
  if (designId && method === "GET") {
    const row = findDesign(store, decodeURIComponent(designId[1]));
    if (!row) throw new HttpError(404, "Not found");
    return liveDesign(store, row);
  }
  if (designId && method === "PUT") {
    const row = findDesign(store, decodeURIComponent(designId[1]));
    if (!row) throw new HttpError(404, "Not found");
    const patch = (body ?? {}) as Partial<Pick<Design, "name" | "canvas_json" | "width" | "height" | "thumbnail_url">>;
    if (patch.name != null) row.name = patch.name;
    if (patch.canvas_json != null) row.canvas_json = sanitizeCanvasJSONString(patch.canvas_json);
    if (patch.width != null) row.width = patch.width;
    if (patch.height != null) row.height = patch.height;
    if (patch.thumbnail_url !== undefined) {
      row.thumbnail_url = patch.thumbnail_url;
      row.thumbnail_at = row.updated_at;
    }
    row.updated_at = nowIso();
    row.updated_by = "editor";
    await save(store);
    return withoutPages(row);
  }
  if (designId && method === "DELETE") {
    const id = decodeURIComponent(designId[1]);
    store.designs = store.designs.filter((row) => row.id !== id);
    store.versions = store.versions.filter((row) => row.design_id !== id);
    await save(store);
    return { ok: true };
  }
  if (revision && method === "GET") {
    const row = findDesign(store, decodeURIComponent(revision[1]));
    if (!row) throw new HttpError(404, "Not found");
    const rev: DesignRevision = { id: row.id, updated_at: row.updated_at, updated_by: row.updated_by };
    return rev;
  }
  if (thumbnail && method === "POST") {
    const row = findDesign(store, decodeURIComponent(thumbnail[1]));
    if (!row) throw new HttpError(404, "Not found");
    const image = typeof (body as { image?: unknown } | null)?.image === "string" ? (body as { image: string }).image : "";
    const parsed = dataUrlBytes(image);
    if (!parsed) throw new HttpError(400, "Expected a PNG or JPEG data URL");
    if (parsed.bytes.length > 4 * 1024 * 1024) throw new HttpError(413, "Thumbnail too large");
    const key = `uploads/thumbs/${row.id}.${parsed.ext}`;
    const uploaded = await putUpload(store, key, `${row.id}.${parsed.ext}`, "thumbs", parsed.mime, parsed.bytes);
    row.thumbnail_url = uploaded.url;
    row.thumbnail_at = row.updated_at;
    await save(store);
    return withoutPages(row);
  }
  if (duplicate && method === "POST") {
    const src = findDesign(store, decodeURIComponent(duplicate[1]));
    if (!src) throw new HttpError(404, "Not found");
    const created = nowIso();
    const id = crypto.randomUUID();
    const pages = src.pages.map((item, index) => ({
      ...item,
      id: crypto.randomUUID(),
      design_id: id,
      created_at: created,
      sort_order: item.sort_order ?? index,
      canvas_json: sanitizeCanvasJSONString(item.canvas_json || "{}"),
    }));
    const row: StoredDesign = {
      id,
      name: `${src.name} (copy)`,
      canvas_json: pages[0]?.canvas_json ?? src.canvas_json,
      width: src.width,
      height: src.height,
      thumbnail_url: null,
      created_at: created,
      updated_at: created,
      updated_by: "editor",
      pages,
    };
    store.designs.push(row);
    await save(store);
    return liveDesign(store, row);
  }
  if (versions && method === "GET") {
    const id = decodeURIComponent(versions[1]);
    if (!findDesign(store, id)) return [];
    return store.versions
      .filter((row) => row.design_id === id)
      .sort((a, b) => b.rev - a.rev)
      .map(versionMeta);
  }
  if (versions && method === "POST") {
    const id = decodeURIComponent(versions[1]);
    const design = findDesign(store, id);
    if (!design) throw new HttpError(404, "Not found");
    const input = (body ?? {}) as { kind?: "auto" | "manual"; title?: string; description?: string; created_by?: "editor" | "cli" };
    const hash = contentHash(design);
    const latest = store.versions.filter((row) => row.design_id === id).sort((a, b) => b.rev - a.rev)[0];
    if (input.kind === "auto" && latest?.content_hash === hash) {
      return { version: versionMeta(latest), created: false };
    }
    const rev = (latest?.rev ?? 0) + 1;
    const row: DesignVersionDetail = {
      id: `${id}_${rev}`,
      design_id: id,
      rev,
      kind: input.kind === "manual" ? "manual" : "auto",
      title: input.title?.trim() || (input.kind === "manual" ? "" : "Autosave"),
      description: input.description?.trim() ?? "",
      created_at: nowIso(),
      created_by: input.created_by ?? "editor",
      content_hash: hash,
      name: design.name,
      width: design.width,
      height: design.height,
      canvas_json: design.canvas_json,
      pages: design.pages.map((item) => ({ ...item })),
      thumbnail_url: design.thumbnail_url,
    };
    store.versions.push(row);
    await save(store);
    return { version: versionMeta(row), created: true };
  }
  if (version && method === "GET") {
    const id = decodeURIComponent(version[1]);
    const rev = Number(version[2]);
    const row = store.versions.find((item) => item.design_id === id && item.rev === rev);
    if (!row) throw new HttpError(404, "Not found");
    return liveDesign(store, row);
  }
  if (version && method === "PUT") {
    const id = decodeURIComponent(version[1]);
    const rev = Number(version[2]);
    const row = store.versions.find((item) => item.design_id === id && item.rev === rev);
    if (!row) throw new HttpError(404, "Not found");
    const patch = (body ?? {}) as { canvas_json?: string; pages?: Array<{ id: string; canvas_json: string }> };
    if (patch.canvas_json != null) row.canvas_json = sanitizeCanvasJSONString(patch.canvas_json);
    if (patch.pages) {
      row.pages = row.pages.map((item) => {
        const hit = patch.pages?.find((pageRow) => pageRow.id === item.id);
        return hit ? { ...item, canvas_json: sanitizeCanvasJSONString(hit.canvas_json) } : item;
      });
    }
    row.content_hash = hashText(JSON.stringify({ canvas: row.canvas_json, pages: row.pages }));
    await save(store);
    return liveDesign(store, row);
  }
  if (version && method === "DELETE") {
    const id = decodeURIComponent(version[1]);
    const rev = Number(version[2]);
    const before = store.versions.length;
    store.versions = store.versions.filter((item) => !(item.design_id === id && item.rev === rev));
    if (store.versions.length === before) throw new HttpError(404, "Not found");
    await save(store);
    return { ok: true };
  }
  if (restore && method === "POST") {
    const id = decodeURIComponent(restore[1]);
    const rev = Number(restore[2]);
    const live = findDesign(store, id);
    const snapshot = store.versions.find((item) => item.design_id === id && item.rev === rev);
    if (!live || !snapshot) throw new HttpError(404, "Not found");
    live.name = snapshot.name || live.name;
    live.width = snapshot.width || live.width;
    live.height = snapshot.height || live.height;
    live.canvas_json = snapshot.canvas_json;
    live.thumbnail_url = snapshot.thumbnail_url ?? live.thumbnail_url;
    if (snapshot.pages.length) live.pages = snapshot.pages.map((item) => ({ ...item }));
    touch(live);
    await save(store);
    return liveDesign(store, live);
  }
  if (pages && method === "POST") {
    const design = findDesign(store, decodeURIComponent(pages[1]));
    if (!design) throw new HttpError(404, "Not found");
    const input = (body ?? {}) as { title?: string; canvas_json?: string; after_sort_order?: number };
    const list = [...design.pages].sort((a, b) => a.sort_order - b.sort_order);
    let insertOrder: number;
    if (input.after_sort_order !== undefined) {
      for (const item of list) {
        if (item.sort_order > input.after_sort_order) item.sort_order += 1;
      }
      insertOrder = input.after_sort_order + 1;
    } else {
      insertOrder = list.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1;
    }
    const created: Page = {
      id: crypto.randomUUID(),
      design_id: design.id,
      title: input.title || `Page ${list.length + 1}`,
      canvas_json: sanitizeCanvasJSONString(input.canvas_json || "{}"),
      sort_order: insertOrder,
      created_at: nowIso(),
    };
    list.push(created);
    design.pages = list;
    touch(design);
    await save(store);
    return created;
  }
  if (page && method === "PUT") {
    const pageId = decodeURIComponent(page[1]);
    const patch = (body ?? {}) as { title?: string; canvas_json?: string };
    for (const design of store.designs) {
      const hit = design.pages.find((item) => item.id === pageId);
      if (!hit) continue;
      if (patch.title != null) hit.title = patch.title;
      if (patch.canvas_json != null) hit.canvas_json = sanitizeCanvasJSONString(patch.canvas_json);
      touch(design);
      await save(store);
      return { ...hit, canvas_json: await liveCanvas(store, hit.canvas_json) };
    }
    throw new HttpError(404, "Not found");
  }
  if (page && method === "DELETE") {
    const pageId = decodeURIComponent(page[1]);
    for (const design of store.designs) {
      const hit = design.pages.find((item) => item.id === pageId);
      if (!hit) continue;
      if (design.pages.length <= 1) throw new HttpError(400, "Cannot delete the last page");
      design.pages = design.pages.filter((item) => item.id !== pageId);
      touch(design);
      await save(store);
      return { ok: true };
    }
    throw new HttpError(404, "Not found");
  }
  if (pageCopy && method === "POST") {
    const pageId = decodeURIComponent(pageCopy[1]);
    for (const design of store.designs) {
      const hit = design.pages.find((item) => item.id === pageId);
      if (!hit) continue;
      for (const item of design.pages) {
        if (item.sort_order > hit.sort_order) item.sort_order += 1;
      }
      const copy: Page = {
        ...hit,
        id: crypto.randomUUID(),
        title: `${hit.title} (copy)`,
        sort_order: hit.sort_order + 1,
        created_at: nowIso(),
        canvas_json: sanitizeCanvasJSONString(hit.canvas_json || "{}"),
      };
      design.pages.push(copy);
      touch(design);
      await save(store);
      return copy;
    }
    throw new HttpError(404, "Not found");
  }
  if (method === "GET" && path === "/api/templates") {
    const rows = templates();
    for (const row of rows) row.canvas_json = await liveCanvas(store, row.canvas_json);
    return rows;
  }
  if (method === "GET" && path === "/api/elements") {
    return [...store.elements].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if (method === "POST" && path === "/api/elements") {
    const input = (body ?? {}) as { name?: string; canvas_json?: string; width?: number; height?: number };
    if (!input.canvas_json) throw new HttpError(400, "Missing canvas_json");
    const row: LibraryElement = {
      id: crypto.randomUUID(),
      name: input.name || "Element",
      canvas_json: sanitizeCanvasJSONString(input.canvas_json),
      width: input.width || 0,
      height: input.height || 0,
      created_at: nowIso(),
    };
    store.elements.push(row);
    await save(store);
    return row;
  }
  if (element && method === "DELETE") {
    const id = decodeURIComponent(element[1]);
    store.elements = store.elements.filter((row) => row.id !== id);
    await save(store);
    return { ok: true };
  }
  if (method === "GET" && path === "/api/styles") {
    return [...store.styles].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  if (method === "POST" && path === "/api/styles") {
    const input = (body ?? {}) as { name?: string; swatch?: string; style?: Record<string, unknown> };
    if (!input.style || typeof input.style !== "object") throw new HttpError(400, "Missing style");
    const created = nowIso();
    const row: SavedStyle = {
      id: `s_${crypto.randomUUID()}`,
      name: (input.name || "Style").trim() || "Style",
      swatch: input.swatch,
      style: input.style,
      created_at: created,
      updated_at: created,
      source: "project",
    };
    store.styles.push(row);
    await save(store);
    return row;
  }
  if (style && method === "PUT") {
    const row = store.styles.find((item) => item.id === decodeURIComponent(style[1]));
    if (!row) throw new HttpError(404, "Not found");
    const patch = (body ?? {}) as { name?: string; swatch?: string; style?: Record<string, unknown> };
    if (patch.name != null) row.name = patch.name.trim() || row.name;
    if (patch.swatch != null) row.swatch = patch.swatch;
    if (patch.style) row.style = patch.style;
    row.updated_at = nowIso();
    await save(store);
    return row;
  }
  if (style && method === "DELETE") {
    const id = decodeURIComponent(style[1]);
    if (!store.styles.some((row) => row.id === id)) throw new HttpError(404, "Not found");
    store.styles = store.styles.filter((row) => row.id !== id);
    await save(store);
    return { ok: true };
  }
  if (method === "GET" && path === "/api/uploads") {
    return { items: await listUploads(store, uploadKind(query.get("kind"))) };
  }
  if (method === "POST" && path === "/api/design/journal") return { ok: true };
  if (method === "GET" && path === "/api/design/journal") return { entries: [] };
  if (method === "GET" && path === "/api/meta") {
    return { cwd: "opfs", project: "browser", global: "browser", merged: false };
  }
  if (method === "GET" && path === "/api/llm/ready") return { ready: false };
  throw new HttpError(404, "Not available in the browser build");
}

async function readForm(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file provided");
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const allowed = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  if (!allowed.has(ext)) throw new HttpError(400, "Unsupported file type");
  const kind = uploadKind(typeof form.get("kind") === "string" ? String(form.get("kind")) : null);
  const requestedName = typeof form.get("filename") === "string" ? String(form.get("filename")).trim() : "";
  const filename = (requestedName || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`).replace(
    /[^a-zA-Z0-9._-]/g,
    "",
  );
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : ext === "svg"
            ? "image/svg+xml"
            : "image/png";
  const requestedKey = typeof form.get("key") === "string" ? String(form.get("key")).trim() : "";
  const key = requestedKey.startsWith("uploads/")
    ? requestedKey.replace(/[^a-zA-Z0-9._/-]/g, "")
    : `${uploadPrefix(kind)}${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { key, filename: key.split("/").pop() || filename, kind, mime, bytes };
}

let installed = false;

export function installOpfsFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, "http://local");
    if (!url.pathname.startsWith("/api") && !url.pathname.startsWith("/tabler-icons") && url.pathname !== "/llms.txt") {
      return orig(input, init);
    }
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "GET" && url.pathname.startsWith("/tabler-icons/")) {
      return orig(staticAssetUrl(url.pathname.replace(/^\//, "")));
    }
    if (url.pathname.startsWith("/api/uploads/file/")) {
      if (method === "GET") {
        const key = decodeURIComponent(url.pathname.replace(/^\/api\/uploads\/file\//, ""));
        const bytes = await readBytes(key);
        const store = await db();
        const row = store.uploads.find((item) => item.key === key);
        if (!bytes) return Response.json({ error: "Not found" }, { status: 404 });
        return new Response(bytes, { status: 200, headers: { "Content-Type": row?.mime || "application/octet-stream" } });
      }
      if (method === "DELETE") {
        const key = decodeURIComponent(url.pathname.replace(/^\/api\/uploads\/file\//, ""));
        await lock(async () => {
          const store = await db();
          store.uploads = store.uploads.filter((item) => item.key !== key);
          await removeBytes(key);
          await save(store);
        });
        return Response.json({ ok: true });
      }
    }
    let json: unknown;
    let form: FormData | undefined;
    const payload = init?.body;
    if (payload instanceof FormData) form = payload;
    else if (typeof payload === "string" && payload) {
      try {
        json = JSON.parse(payload);
      } catch {
        json = undefined;
      }
    }
    if (method === "POST" && url.pathname === "/api/uploads") {
      try {
        if (!form) return Response.json({ error: "No file provided" }, { status: 400 });
        const file = await readForm(form);
        const saved = await lock(async () => {
          const store = await db();
          const row = await putUpload(store, file.key, file.filename, file.kind, file.mime, file.bytes);
          await save(store);
          return row;
        });
        return Response.json(saved);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Request failed";
        return Response.json({ error: message }, { status });
      }
    }
    try {
      const data = await lock(() => route(method, url.pathname, url.searchParams, json));
      return Response.json(data ?? { ok: true });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Request failed";
      return Response.json({ error: message }, { status });
    }
  };
}

export async function opfsApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith("http") ? new URL(path) : new URL(path, "http://local");
  try {
    const data = await lock(() => route(method.toUpperCase(), url.pathname, url.searchParams, body));
    return data as T;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Request failed");
  }
}
