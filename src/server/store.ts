import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { jsonPath, mergeByKey, readJsonDir, readJsonFile, writeJsonFile } from "./json-files.js";
import { layerRoot, mergeOrder, type Layer, type Roots } from "./paths.js";
import { sanitizeCanvasJSONString } from "./sanitize-json.js";
import { SEED_TEMPLATES } from "./seed-templates.js";

export type Source = "bundled" | Layer;

export type Page = {
  id: string;
  design_id: string;
  title: string;
  canvas_json: string;
  sort_order: number;
  created_at: string;
};

export type Design = {
  id: string;
  name: string;
  canvas_json: string;
  width: number;
  height: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
};

export type DesignRecord = Design & { pages: Page[]; source?: Source };

export type Template = {
  id: string;
  name: string;
  category: string;
  canvas_json: string;
  width: number;
  height: number;
  thumbnail_url: string | null;
  sort_order: number;
  source?: Source;
};

export type LibraryElement = {
  id: string;
  name: string;
  canvas_json: string;
  width: number;
  height: number;
  created_at: string;
  source?: Source;
};

function nowIso() {
  return new Date().toISOString();
}

function stripSource<T extends { source?: Source }>(row: T): Omit<T, "source"> & { source?: Source } {
  return row;
}

function findInLayers<T extends { id: string }>(
  roots: Roots,
  folder: string,
  id: string
): { row: T; layer: Layer; file: string } | null {
  for (const entry of [...mergeOrder(roots)].reverse()) {
    const file = jsonPath(entry.root, folder, id);
    const row = readJsonFile<T>(file);
    if (row) return { row, layer: entry.layer, file };
  }
  return null;
}

function owningLayer(roots: Roots, folder: string, id: string): Layer | null {
  return findInLayers(roots, folder, id)?.layer ?? null;
}

function writeLayer<T extends { id: string }>(roots: Roots, folder: string, layer: Layer, row: T) {
  writeJsonFile(jsonPath(layerRoot(roots, layer), folder, row.id), row);
}

function deleteLayer(roots: Roots, folder: string, id: string) {
  const hit = findInLayers(roots, folder, id);
  if (!hit) return false;
  fs.unlinkSync(hit.file);
  return true;
}

export function listDesigns(roots: Roots): Design[] {
  const layers = mergeOrder(roots).map((entry) =>
    readJsonDir<DesignRecord>(path.join(entry.root, "designs"), entry.layer)
  );
  return mergeByKey((d) => d.id, ...layers)
    .map((row) => {
      const { pages: _pages, ...design } = row;
      return stripSource(design);
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getDesign(roots: Roots, id: string): DesignRecord | null {
  const hit = findInLayers<DesignRecord>(roots, "designs", id);
  if (!hit) return null;
  const pages = [...(hit.row.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return { ...hit.row, pages, source: hit.layer };
}

export function createDesign(
  roots: Roots,
  input: { name?: string; canvas_json?: string; width?: number; height?: number }
): Design {
  const id = randomUUID();
  const created = nowIso();
  const canvas = sanitizeCanvasJSONString(input.canvas_json || "{}");
  const page: Page = {
    id: randomUUID(),
    design_id: id,
    title: "Page 1",
    canvas_json: canvas,
    sort_order: 0,
    created_at: created,
  };
  const row: DesignRecord = {
    id,
    name: input.name || "Untitled Design",
    canvas_json: canvas,
    width: input.width || 1080,
    height: input.height || 1080,
    thumbnail_url: null,
    created_at: created,
    updated_at: created,
    pages: [page],
  };
  writeLayer(roots, "designs", "project", row);
  const { pages: _pages, source: _source, ...design } = row;
  return design;
}

export function updateDesign(
  roots: Roots,
  id: string,
  patch: Partial<Pick<Design, "name" | "canvas_json" | "width" | "height" | "thumbnail_url">>
): Design | null {
  const hit = findInLayers<DesignRecord>(roots, "designs", id);
  if (!hit) return null;
  const canvas =
    patch.canvas_json !== undefined ? sanitizeCanvasJSONString(patch.canvas_json) : hit.row.canvas_json;
  const next: DesignRecord = {
    ...hit.row,
    name: patch.name ?? hit.row.name,
    canvas_json: canvas,
    width: patch.width ?? hit.row.width,
    height: patch.height ?? hit.row.height,
    thumbnail_url: patch.thumbnail_url !== undefined ? patch.thumbnail_url : hit.row.thumbnail_url,
    updated_at: nowIso(),
    pages: hit.row.pages ?? [],
  };
  writeLayer(roots, "designs", hit.layer, next);
  const { pages: _pages, source: _source, ...design } = next;
  return design;
}

export function deleteDesign(roots: Roots, id: string) {
  return deleteLayer(roots, "designs", id);
}

function saveDesignRecord(roots: Roots, layer: Layer, row: DesignRecord) {
  writeLayer(roots, "designs", layer, {
    ...row,
    updated_at: nowIso(),
    canvas_json: row.pages[0]?.canvas_json ?? row.canvas_json,
  });
}

export function addPage(
  roots: Roots,
  designId: string,
  input: { title?: string; canvas_json?: string; after_sort_order?: number }
): Page | null {
  const hit = findInLayers<DesignRecord>(roots, "designs", designId);
  if (!hit) return null;
  const pages = [...(hit.row.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  let insertOrder: number;
  if (input.after_sort_order !== undefined) {
    for (const page of pages) {
      if (page.sort_order > input.after_sort_order) page.sort_order += 1;
    }
    insertOrder = input.after_sort_order + 1;
  } else {
    insertOrder = pages.reduce((max, page) => Math.max(max, page.sort_order), -1) + 1;
  }
  const page: Page = {
    id: randomUUID(),
    design_id: designId,
    title: input.title || `Page ${pages.length + 1}`,
    canvas_json: sanitizeCanvasJSONString(input.canvas_json || "{}"),
    sort_order: insertOrder,
    created_at: nowIso(),
  };
  pages.push(page);
  saveDesignRecord(roots, hit.layer, { ...hit.row, pages });
  return page;
}

export function getPage(roots: Roots, pageId: string): { page: Page; design: DesignRecord; layer: Layer } | null {
  for (const entry of [...mergeOrder(roots)].reverse()) {
    for (const row of readJsonDir<DesignRecord>(path.join(entry.root, "designs"), entry.layer)) {
      const page = row.pages?.find((p) => p.id === pageId);
      if (page) return { page, design: row, layer: entry.layer };
    }
  }
  return null;
}

export function duplicatePage(roots: Roots, pageId: string): Page | null {
  const hit = getPage(roots, pageId);
  if (!hit) return null;
  const pages = [...(hit.design.pages ?? [])];
  for (const page of pages) {
    if (page.sort_order > hit.page.sort_order) page.sort_order += 1;
  }
  const copy: Page = {
    ...hit.page,
    id: randomUUID(),
    title: `${hit.page.title} (copy)`,
    sort_order: hit.page.sort_order + 1,
    created_at: nowIso(),
  };
  pages.push(copy);
  saveDesignRecord(roots, hit.layer, { ...hit.design, pages });
  return copy;
}

export function updatePage(
  roots: Roots,
  pageId: string,
  patch: { title?: string; canvas_json?: string }
): Page | null {
  const hit = getPage(roots, pageId);
  if (!hit) return null;
  const pages = (hit.design.pages ?? []).map((page) => {
    if (page.id !== pageId) return page;
    return {
      ...page,
      title: patch.title ?? page.title,
      canvas_json:
        patch.canvas_json !== undefined ? sanitizeCanvasJSONString(patch.canvas_json) : page.canvas_json,
    };
  });
  saveDesignRecord(roots, hit.layer, { ...hit.design, pages });
  return pages.find((page) => page.id === pageId) ?? null;
}

export function deletePage(roots: Roots, pageId: string): { ok: true } | { error: string; status: 400 | 404 } {
  const hit = getPage(roots, pageId);
  if (!hit) return { error: "Not found", status: 404 };
  const pages = hit.design.pages ?? [];
  if (pages.length <= 1) return { error: "Cannot delete the last page", status: 400 };
  saveDesignRecord(roots, hit.layer, {
    ...hit.design,
    pages: pages.filter((page) => page.id !== pageId),
  });
  return { ok: true };
}

export function listTemplates(roots: Roots): Template[] {
  const bundled: Template[] = SEED_TEMPLATES.map((t) => ({
    ...t,
    thumbnail_url: null,
    canvas_json: sanitizeCanvasJSONString(t.canvas_json),
    source: "bundled",
  }));
  const layered = mergeOrder(roots).map((entry) =>
    readJsonDir<Template>(path.join(entry.root, "templates"), entry.layer).map((row) => ({
      ...row,
      canvas_json: sanitizeCanvasJSONString(row.canvas_json),
    }))
  );
  return mergeByKey((t) => t.id, bundled, ...layered).sort((a, b) => a.sort_order - b.sort_order);
}

export function getTemplate(roots: Roots, id: string): Template | null {
  return listTemplates(roots).find((t) => t.id === id) ?? null;
}

export function listElements(roots: Roots): LibraryElement[] {
  const layered = mergeOrder(roots).map((entry) =>
    readJsonDir<LibraryElement>(path.join(entry.root, "elements"), entry.layer)
  );
  return mergeByKey((el) => el.id, ...layered).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createElement(
  roots: Roots,
  input: { name?: string; canvas_json: string; width?: number; height?: number }
): LibraryElement {
  const row: LibraryElement = {
    id: randomUUID(),
    name: input.name || "Element",
    canvas_json: sanitizeCanvasJSONString(input.canvas_json),
    width: input.width || 0,
    height: input.height || 0,
    created_at: nowIso(),
    source: "project",
  };
  writeLayer(roots, "elements", "project", row);
  return row;
}

export function deleteElement(roots: Roots, id: string) {
  return deleteLayer(roots, "elements", id);
}

export function designOwningLayer(roots: Roots, id: string) {
  return owningLayer(roots, "designs", id);
}
