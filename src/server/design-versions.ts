import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { jsonPath, mergeByKey, readJsonFile, writeJsonFile } from "./json-files.js";
import { layerRoot, mergeOrder, safeId, type Layer, type Roots } from "./paths.js";
import type { DesignRecord, DesignWriter, Page } from "./store.js";

export type VersionKind = "auto" | "manual";

export type DesignVersionMeta = {
  id: string;
  design_id: string;
  rev: number;
  kind: VersionKind;
  title: string;
  description: string;
  created_at: string;
  created_by: DesignWriter;
  content_hash: string;
  name: string;
  width: number;
  height: number;
};

export type DesignVersion = DesignVersionMeta & {
  canvas_json: string;
  pages: Page[];
  thumbnail_url: string | null;
};

const VERSION_FILE = /^(.+)_(\d+)\.json$/;

export function isDesignVersionFilename(file: string): boolean {
  return VERSION_FILE.test(file);
}

export function parseVersionFilename(file: string): { designId: string; rev: number } | null {
  const m = file.match(VERSION_FILE);
  if (!m) return null;
  return { designId: m[1], rev: Number(m[2]) };
}

export function versionFilename(designId: string, rev: number): string {
  return `${safeId(designId)}_${rev}.json`;
}

function nowIso() {
  return new Date().toISOString();
}

export function designContentHash(row: Pick<DesignRecord, "name" | "width" | "height" | "canvas_json" | "pages">): string {
  const hash = createHash("sha1");
  hash.update(row.name);
  hash.update("\0");
  hash.update(String(row.width));
  hash.update("x");
  hash.update(String(row.height));
  hash.update("\0");
  hash.update(row.canvas_json ?? "");
  for (const page of [...(row.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
    hash.update(page.id);
    hash.update("\0");
    hash.update(page.canvas_json ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function versionPath(root: string, designId: string, rev: number) {
  return path.join(root, "designs", versionFilename(designId, rev));
}

function toMeta(row: DesignVersion): DesignVersionMeta {
  const {
    canvas_json: _canvas,
    pages: _pages,
    thumbnail_url: _thumb,
    ...meta
  } = row;
  return meta;
}

function readVersionFile(file: string): DesignVersion | null {
  const row = readJsonFile<DesignVersion>(file);
  if (!row || typeof row.rev !== "number" || !row.design_id) return null;
  return row;
}

export function listDesignVersions(roots: Roots, designId: string): DesignVersionMeta[] {
  safeId(designId);
  const layers = mergeOrder(roots).map((entry) => {
    const dir = path.join(entry.root, "designs");
    if (!fs.existsSync(dir)) return [] as DesignVersion[];
    const rows: DesignVersion[] = [];
    for (const file of fs.readdirSync(dir)) {
      const parsed = parseVersionFilename(file);
      if (!parsed || parsed.designId !== designId) continue;
      const row = readVersionFile(path.join(dir, file));
      if (row) rows.push(row);
    }
    return rows;
  });
  return mergeByKey((row) => String(row.rev), ...layers)
    .map(toMeta)
    .sort((a, b) => b.rev - a.rev);
}

export function getDesignVersion(roots: Roots, designId: string, rev: number): DesignVersion | null {
  safeId(designId);
  for (const entry of [...mergeOrder(roots)].reverse()) {
    const row = readVersionFile(versionPath(entry.root, designId, rev));
    if (row) return row;
  }
  return null;
}

export function updateDesignVersion(
  roots: Roots,
  designId: string,
  rev: number,
  patch: { canvas_json?: string; pages?: Array<{ id: string; canvas_json: string }> },
): DesignVersion | null {
  safeId(designId);
  for (const entry of [...mergeOrder(roots)].reverse()) {
    const file = versionPath(entry.root, designId, rev);
    const row = readVersionFile(file);
    if (!row) continue;
    const pages = (row.pages ?? []).map((page) => {
      const hit = patch.pages?.find((item) => item.id === page.id);
      return hit ? { ...page, canvas_json: hit.canvas_json } : page;
    });
    const canvas_json = patch.canvas_json ?? pages[0]?.canvas_json ?? row.canvas_json;
    const next: DesignVersion = {
      ...row,
      pages,
      canvas_json,
      content_hash: designContentHash({
        name: row.name,
        width: row.width,
        height: row.height,
        canvas_json,
        pages,
      }),
    };
    writeJsonFile(file, next);
    return next;
  }
  return null;
}

export function nextVersionRev(roots: Roots, designId: string): number {
  const existing = listDesignVersions(roots, designId);
  return (existing[0]?.rev ?? 0) + 1;
}

export function createDesignVersion(
  roots: Roots,
  design: DesignRecord,
  input: {
    kind: VersionKind;
    title?: string;
    description?: string;
    created_by?: DesignWriter;
  },
): { version: DesignVersionMeta; created: boolean } {
  const content_hash = designContentHash(design);
  const existing = listDesignVersions(roots, design.id);
  const latest = existing[0];
  if (input.kind === "auto" && latest?.content_hash === content_hash) {
    return { version: latest, created: false };
  }

  const rev = (latest?.rev ?? 0) + 1;
  const title = input.title?.trim() || (input.kind === "manual" ? "" : "Autosave");
  const row: DesignVersion = {
    id: `${design.id}_${rev}`,
    design_id: design.id,
    rev,
    kind: input.kind,
    title,
    description: input.description?.trim() ?? "",
    created_at: nowIso(),
    created_by: input.created_by ?? "editor",
    content_hash,
    name: design.name,
    width: design.width,
    height: design.height,
    thumbnail_url: design.thumbnail_url,
    canvas_json: design.canvas_json,
    pages: design.pages ?? [],
  };
  const layer: Layer = design.source === "global" ? "global" : "project";
  writeJsonFile(versionPath(layerRoot(roots, layer), design.id, rev), row);
  return { version: toMeta(row), created: true };
}

export function deleteDesignVersion(roots: Roots, designId: string, rev: number): boolean {
  safeId(designId);
  let removed = false;
  for (const entry of mergeOrder(roots)) {
    const file = versionPath(entry.root, designId, rev);
    if (!fs.existsSync(file)) continue;
    fs.unlinkSync(file);
    removed = true;
  }
  return removed;
}

export function deleteAllDesignVersions(roots: Roots, designId: string) {
  safeId(designId);
  for (const entry of mergeOrder(roots)) {
    const dir = path.join(entry.root, "designs");
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const parsed = parseVersionFilename(file);
      if (!parsed || parsed.designId !== designId) continue;
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

export function restoreDesignVersion(
  roots: Roots,
  live: DesignRecord,
  version: DesignVersion,
  updatedBy: DesignWriter = "editor",
): DesignRecord {
  return {
    ...live,
    name: version.name || live.name,
    width: version.width || live.width,
    height: version.height || live.height,
    canvas_json: version.canvas_json,
    thumbnail_url: version.thumbnail_url ?? live.thumbnail_url,
    pages: version.pages?.length ? version.pages : live.pages,
    updated_at: nowIso(),
    updated_by: updatedBy,
  };
}
