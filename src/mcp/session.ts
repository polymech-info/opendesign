import {
  documentFromCanvasJson,
  emptyDocument,
  parseDsl,
  projectToFabricJSON,
  serializeDsl,
  writeCliCanvasJson,
  type DesignDocument,
} from "../design/index.js";
import { FEATURE_CARD_SEED } from "../design/example.js";
import { ensureLayouts, resolveRoots, type Roots } from "../server/paths.js";
import * as store from "../server/store.js";
import type { DesignRecord, Page } from "../server/store.js";

export type DesignPageSession = {
  roots: Roots;
  design: DesignRecord;
  page: Page;
  pageNumber: number;
  doc: DesignDocument;
};

function asError(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}

export function mcpRoots(cwd: string): Roots {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  return roots;
}

function formatDesignList(rows: Array<{ id: string; name: string }>): string {
  return rows.map((d) => `${d.name} (${d.id})`).join(", ");
}

export function findDesign(cwd: string, query?: string): DesignRecord | { error: string } {
  const roots = mcpRoots(cwd);
  const all = store.listDesigns(roots);
  if (!query?.trim()) {
    if (all.length === 1) return store.getDesign(roots, all[0]!.id)!;
    if (!all.length) return { error: "No designs in this folder. Call create_design first." };
    return { error: `Pass design id or name. Designs: ${formatDesignList(all)}` };
  }
  const exactId = all.find((d) => d.id === query);
  if (exactId) return store.getDesign(roots, exactId.id)!;
  const q = query.toLowerCase();
  const named = all.filter((d) => d.name.toLowerCase() === q);
  if (named.length === 1) return store.getDesign(roots, named[0]!.id)!;
  const fuzzy = all.filter((d) => d.id.startsWith(query) || d.name.toLowerCase().includes(q));
  if (fuzzy.length === 1) return store.getDesign(roots, fuzzy[0]!.id)!;
  if (fuzzy.length > 1) return { error: `Ambiguous design "${query}": ${formatDesignList(fuzzy)}` };
  if (named.length > 1) return { error: `Ambiguous design "${query}": ${formatDesignList(named)}` };
  return { error: `Design not found: ${query}` };
}

export function resolveDesignPage(
  cwd: string,
  query: string | undefined,
  pageNumber = 1,
): DesignPageSession | { error: string } {
  const design = findDesign(cwd, query);
  if ("error" in design) return design;
  const roots = mcpRoots(cwd);
  const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const pageCount = Math.max(1, pages.length);
  if (pageNumber < 1 || pageNumber > pageCount) {
    return { error: `Page ${pageNumber} missing (${pageCount} page${pageCount === 1 ? "" : "s"})` };
  }
  const page = pages[pageNumber - 1];
  if (!page) return { error: `Design "${design.name}" has no saved page` };
  const doc =
    documentFromCanvasJson(page.canvas_json) ??
    documentFromCanvasJson(design.canvas_json) ??
    documentForEmptyPage(design, page);
  return { roots, design, page, pageNumber, doc };
}

function canvasSizeFromJson(raw?: string): { width?: number; height?: number } {
  if (!raw || raw === "{}") return {};
  try {
    const data = JSON.parse(raw) as {
      width?: number;
      height?: number;
      objects?: Array<{ _id?: string; width?: number; height?: number }>;
    };
    const bg = data.objects?.find((o) => o._id === "canvas.bg");
    const width = typeof data.width === "number" ? data.width : bg?.width;
    const height = typeof data.height === "number" ? data.height : bg?.height;
    return {
      width: typeof width === "number" && width > 0 ? width : undefined,
      height: typeof height === "number" && height > 0 ? height : undefined,
    };
  } catch {
    return {};
  }
}

/** New editor designs are `canvas_json: "{}"` — still a live page, just no IR yet. */
export function documentForEmptyPage(design: DesignRecord, page: Page): DesignDocument {
  const fromFabric = canvasSizeFromJson(page.canvas_json);
  const doc = blankDocument(fromFabric.width ?? design.width ?? 1920, fromFabric.height ?? design.height ?? 1080);
  seedDefaultWidgets(doc);
  return doc;
}

export function seedDefaultWidgets(doc: DesignDocument) {
  if (doc.widgets["feature-group"]) return;
  const seed = parseDsl(FEATURE_CARD_SEED);
  doc.widgets = { ...seed.widgets, ...doc.widgets };
  doc.presets = { ...seed.presets, ...doc.presets };
  if (!doc.theme) doc.theme = seed.theme || "tanit-light";
}

export function persistDesignPage(
  session: DesignPageSession,
  source: string,
  description?: string,
): { saved: true; design_id: string; page_id: string } {
  const canvasJson = writeCliCanvasJson(session.page.canvas_json, session.doc, { source });
  const savedPage = store.updatePage(session.roots, session.page.id, { canvas_json: canvasJson }, "cli");
  if (!savedPage) throw new Error(`Could not save page ${session.page.id}`);
  if (session.pageNumber === 1) {
    const savedDesign = store.updateDesign(
      session.roots,
      session.design.id,
      {
        canvas_json: canvasJson,
        width: session.doc.canvas.width,
        height: session.doc.canvas.height,
      },
      "cli",
    );
    if (!savedDesign) throw new Error(`Could not save design ${session.design.id}`);
  }
  store.snapshotDesignVersion(session.roots, session.design.id, {
    kind: "auto",
    title: source === "mcp" ? "MCP" : source === "agent" ? "Agent" : "CLI",
    description: (description ?? source).slice(0, 280),
    created_by: "cli",
  });
  session.page.canvas_json = canvasJson;
  return { saved: true, design_id: session.design.id, page_id: session.page.id };
}

export function canvasFromDsl(dsl: string, width?: number, height?: number): DesignDocument | { error: string } {
  try {
    const doc = parseDsl(dsl);
    if (width) doc.canvas.width = width;
    if (height) doc.canvas.height = height;
    if (doc.errors.length) {
      return { error: `DSL parse errors: ${doc.errors.map((e) => e.message).join("; ")}` };
    }
    return doc;
  } catch (err) {
    return asError(err);
  }
}

export function blankDocument(width = 1920, height = 1080): DesignDocument {
  const doc = emptyDocument();
  doc.canvas.width = width;
  doc.canvas.height = height;
  doc.theme = "tanit-light";
  return doc;
}

export function documentToCanvasJson(doc: DesignDocument, source = "mcp"): string {
  return projectToFabricJSON(doc, { source });
}

export function summarizeDesign(design: DesignRecord, pageNumber = 1, doc?: DesignDocument | null) {
  const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: design.id,
    name: design.name,
    width: design.width,
    height: design.height,
    updated_at: design.updated_at,
    updated_by: design.updated_by,
    pages: pages.map((p, i) => ({
      id: p.id,
      number: i + 1,
      title: p.title,
    })),
    page: pages[pageNumber - 1]
      ? {
          id: pages[pageNumber - 1]!.id,
          number: pageNumber,
          title: pages[pageNumber - 1]!.title,
        }
      : undefined,
    dsl: doc ? serializeDsl(doc) : undefined,
  };
}
