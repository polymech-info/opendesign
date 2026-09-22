/**
 * MCP tool definitions. Handlers call store + Design DSL directly (no HTTP hop).
 */

import { runCliPrompt } from "../cli-prompt.js";
import {
  DESIGN_TOOL_DOCS,
  MUTATING_DESIGN_TOOLS,
  dispatchDesignTool,
  searchIcons,
  serializeDsl,
} from "../design/index.js";
import { ensureLiveLlm, type LlmTarget } from "../server/llm.js";
import * as store from "../server/store.js";
import { exportDesignFile } from "./export.js";
import {
  blankDocument,
  canvasFromDsl,
  documentToCanvasJson,
  findDesign,
  mcpRoots,
  persistDesignPage,
  resolveDesignPage,
  summarizeDesign,
} from "./session.js";

export type McpContext = {
  cwd: string;
  llm?: LlmTarget;
  complete?: Parameters<typeof runCliPrompt>[0]["complete"];
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: McpContext) => Promise<unknown>;
};

const SKIP_IR_TOOLS = new Set(["design_screenshot", "design_export"]);

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pageNumber(args: Record<string, unknown>): number {
  return Math.max(1, Math.floor(num(args, "page") ?? 1));
}

function designQuery(args: Record<string, unknown>): string | undefined {
  return str(args, "design") ?? str(args, "id") ?? str(args, "name");
}

function findTemplate(cwd: string, query: string) {
  const q = query.toLowerCase();
  const all = store.listTemplates(mcpRoots(cwd));
  return (
    all.find((t) => t.id === query) ??
    all.find((t) => t.name.toLowerCase() === q) ??
    all.find((t) => t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) ??
    null
  );
}

const listDesignsTool: McpTool = {
  name: "list_designs",
  description: "List designs in the current project folder (.OpenDesign/designs).",
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, { cwd }) => {
    return store.listDesigns(mcpRoots(cwd)).map((d) => ({
      id: d.id,
      name: d.name,
      width: d.width,
      height: d.height,
      updated_at: d.updated_at,
      updated_by: d.updated_by,
    }));
  },
};

const getDesignTool: McpTool = {
  name: "get_design",
  description:
    "Load a design by id or name. Returns metadata, page list, and Design DSL for the selected page (default 1).",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
      page: { type: "integer", description: "1-based page (default 1)" },
    },
    required: ["design"],
  },
  handler: async (args, { cwd }) => {
    const session = resolveDesignPage(cwd, designQuery(args), pageNumber(args));
    if ("error" in session) {
      const design = findDesign(cwd, designQuery(args));
      if ("error" in design) return design;
      return { ...summarizeDesign(design, pageNumber(args)), warning: session.error };
    }
    return summarizeDesign(session.design, session.pageNumber, session.doc);
  },
};

const createDesignTool: McpTool = {
  name: "create_design",
  description:
    "Create a new design on disk. Supply dsl for a Design DSL scene, template for a bundled/project template (e.g. feature-cards), or neither for a blank canvas. Then prompt_design for natural-language edits, or design_* when you already know ids.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Design name (default Untitled Design)" },
      width: { type: "number", description: "Canvas width (default 1920, or from dsl/template)" },
      height: { type: "number", description: "Canvas height (default 1080, or from dsl/template)" },
      dsl: { type: "string", description: "Design DSL source (wins over template)" },
      template: { type: "string", description: "Template id or name, e.g. feature-cards" },
    },
  },
  handler: async (args, { cwd }) => {
    const roots = mcpRoots(cwd);
    const name = str(args, "name");
    const dsl = str(args, "dsl");
    const templateQuery = str(args, "template");
    if (dsl) {
      const doc = canvasFromDsl(dsl, num(args, "width"), num(args, "height"));
      if ("error" in doc) return doc;
      const created = store.createDesign(roots, {
        name: name || "Untitled Design",
        width: doc.canvas.width,
        height: doc.canvas.height,
        canvas_json: documentToCanvasJson(doc),
      });
      return { success: true, ...summarizeDesign({ ...created, pages: store.getDesign(roots, created.id)?.pages ?? [] }, 1, doc) };
    }
    if (templateQuery) {
      const template = findTemplate(cwd, templateQuery);
      if (!template) return { error: `Template not found: ${templateQuery}. Call list_templates.` };
      const created = store.createDesign(roots, {
        name: name || template.name,
        width: num(args, "width") ?? template.width,
        height: num(args, "height") ?? template.height,
        canvas_json: template.canvas_json,
      });
      const full = store.getDesign(roots, created.id)!;
      const session = resolveDesignPage(cwd, created.id, 1);
      return {
        success: true,
        template: { id: template.id, name: template.name },
        ...summarizeDesign(full, 1, "error" in session ? undefined : session.doc),
      };
    }
    const doc = blankDocument(num(args, "width") ?? 1920, num(args, "height") ?? 1080);
    const created = store.createDesign(roots, {
      name: name || "Untitled Design",
      width: doc.canvas.width,
      height: doc.canvas.height,
      canvas_json: documentToCanvasJson(doc),
    });
    return {
      success: true,
      ...summarizeDesign({ ...created, pages: store.getDesign(roots, created.id)?.pages ?? [] }, 1, doc),
    };
  },
};

const updateDesignTool: McpTool = {
  name: "update_design",
  description: "Rename a design or change canvas size. For scene edits use design_update / design_create / design_use_widget.",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
      name: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["design"],
  },
  handler: async (args, { cwd }) => {
    const design = findDesign(cwd, designQuery(args));
    if ("error" in design) return design;
    const patch: { name?: string; width?: number; height?: number } = {};
    if (str(args, "name")) patch.name = str(args, "name");
    if (num(args, "width") != null) patch.width = num(args, "width");
    if (num(args, "height") != null) patch.height = num(args, "height");
    const updated = store.updateDesign(mcpRoots(cwd), design.id, patch, "cli");
    if (!updated) return { error: "Could not update design" };
    return { success: true, id: updated.id, name: updated.name, width: updated.width, height: updated.height };
  },
};

const deleteDesignTool: McpTool = {
  name: "delete_design",
  description: "Delete a design and its version snapshots.",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
    },
    required: ["design"],
  },
  handler: async (args, { cwd }) => {
    const design = findDesign(cwd, designQuery(args));
    if ("error" in design) return design;
    store.deleteDesign(mcpRoots(cwd), design.id);
    return { success: true, id: design.id, name: design.name };
  },
};

const addPageTool: McpTool = {
  name: "add_page",
  description: "Add a page to a design. Optional dsl seeds the new page.",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
      title: { type: "string" },
      dsl: { type: "string", description: "Optional Design DSL for the new page" },
    },
    required: ["design"],
  },
  handler: async (args, { cwd }) => {
    const design = findDesign(cwd, designQuery(args));
    if ("error" in design) return design;
    const dsl = str(args, "dsl");
    let canvasJson = "{}";
    let doc = blankDocument(design.width, design.height);
    if (dsl) {
      const parsed = canvasFromDsl(dsl);
      if ("error" in parsed) return parsed;
      doc = parsed;
      canvasJson = documentToCanvasJson(doc);
    } else {
      canvasJson = documentToCanvasJson(doc);
    }
    const page = store.addPage(mcpRoots(cwd), design.id, {
      title: str(args, "title"),
      canvas_json: canvasJson,
    });
    if (!page) return { error: "Could not add page" };
    const full = store.getDesign(mcpRoots(cwd), design.id)!;
    const number = [...full.pages].sort((a, b) => a.sort_order - b.sort_order).findIndex((p) => p.id === page.id) + 1;
    return { success: true, ...summarizeDesign(full, number, doc) };
  },
};

const deletePageTool: McpTool = {
  name: "delete_page",
  description: "Delete a page from a design. Cannot delete the last page.",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
      page: { type: "integer", description: "1-based page number to delete" },
    },
    required: ["design", "page"],
  },
    handler: async (args, { cwd }) => {
    const design = findDesign(cwd, designQuery(args));
    if ("error" in design) return design;
    const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const n = pageNumber(args);
    const page = pages[n - 1];
    if (!page) return { error: `Page ${n} missing (${pages.length} page${pages.length === 1 ? "" : "s"})` };
    const result = store.deletePage(mcpRoots(cwd), page.id);
    if ("error" in result) return { error: result.error };
    return { success: true, id: design.id, deleted_page: page.id };
  },
};

const listTemplatesTool: McpTool = {
  name: "list_templates",
  description: "List bundled and project templates you can pass to create_design template=…",
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, { cwd }) => {
    return store.listTemplates(mcpRoots(cwd)).map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      width: t.width,
      height: t.height,
    }));
  },
};

function irTool(spec: (typeof DESIGN_TOOL_DOCS)[number]): McpTool {
  const properties = {
    design: { type: "string", description: "Design id or name" },
    page: { type: "integer", description: "1-based page (default 1)" },
    ...((spec.parameters.properties as Record<string, unknown>) ?? {}),
  };
  const required = [
    ...(spec.name === "design_search_icons" ? [] : ["design"]),
    ...((spec.parameters.required as string[]) ?? []),
  ];
  const needsDesign = spec.name !== "design_search_icons";
  return {
    name: spec.name,
    description: needsDesign ? `${spec.description} Pass design= id or name.` : spec.description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    },
    handler: async (args, { cwd }) => {
      if (spec.name === "design_search_icons") {
        return searchIcons(args);
      }
      const session = resolveDesignPage(cwd, designQuery(args), pageNumber(args));
      if ("error" in session) return session;
      const result = dispatchDesignTool(spec.name, args, session.doc);
      const mutated = MUTATING_DESIGN_TOOLS.has(spec.name);
      if (mutated) persistDesignPage(session, "mcp", spec.name);
      return {
        ok: true,
        design: { id: session.design.id, name: session.design.name },
        page: session.pageNumber,
        saved: mutated,
        result,
      };
    },
  };
}

const exportDesignTool: McpTool = {
  name: "design_export",
  description:
    "Write the selected page to a file and return {path}. format=dsl|md|json|png. path is relative to the project folder (or a directory). PNG uses the same headless Chrome export as pm-opendesign export (needs a built client).",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
      page: { type: "integer", description: "1-based page (default 1)" },
      format: { type: "string", enum: ["dsl", "md", "json", "png"], description: "Default dsl (writes .md)" },
      path: { type: "string", description: "Output file or directory. Default: <design-name>.md/.json/.png" },
      scale: { type: "number", description: "PNG multiplier (default 2)" },
    },
    required: ["design"],
  },
  handler: async (args, { cwd }) => {
    return exportDesignFile({
      cwd,
      design: designQuery(args),
      page: pageNumber(args),
      format: str(args, "format"),
      out: str(args, "path"),
      scale: num(args, "scale"),
    });
  },
};

const promptDesignTool: McpTool = {
  name: "prompt_design",
  description:
    "Natural-language edit through the same Tanit agent loop as `pm-opendesign prompt`. Prefer this for multi-step or fuzzy requests (\"dark theme\", \"translate titles to Spanish\"). Use design_* tools when you already know ids. Requires tanit-cli --serve (editor LLM or OPEND_LLM_URL).",
  inputSchema: {
    type: "object",
    properties: {
      design: { type: "string", description: "Design id or name" },
      prompt: { type: "string", description: "What to change, in plain language" },
      page: { type: "integer", description: "1-based page (default 1)" },
      model: { type: "string", description: "Tanit model/preset (default quick or OPEND_LLM_PRESET)" },
      max_rounds: { type: "integer", description: "Maximum agent/tool rounds (default 8)" },
      dry_run: { type: "boolean", description: "Run the loop without saving" },
    },
    required: ["design", "prompt"],
  },
  handler: async (args, ctx) => {
    const prompt = str(args, "prompt");
    if (!prompt) return { error: "prompt is required" };
    const design = findDesign(ctx.cwd, designQuery(args));
    if ("error" in design) return design;
    if (!ctx.complete && !ctx.llm) {
      return {
        error:
          "LLM not configured. Start the editor (inherits tanit-cli --serve), set OPEND_LLM_URL, or run `tanit-cli --no-gui llm agent --serve`.",
      };
    }
    const llm =
      (await ensureLiveLlm(ctx.llm)) ??
      { url: "http://127.0.0.1:8090", key: "", cwd: mcpRoots(ctx.cwd).project };
    try {
      const result = await runCliPrompt({
        cwd: ctx.cwd,
        query: design.id,
        prompt,
        page: pageNumber(args),
        model: str(args, "model") || process.env.OPEND_LLM_PRESET?.trim() || "quick",
        maxRounds: Math.max(1, Math.floor(num(args, "max_rounds") ?? 8)),
        dryRun: Boolean(args.dry_run),
        llm,
        complete: ctx.complete,
        log: (line) => process.stderr.write(`[mcp prompt] ${line}\n`),
      });
      const session = resolveDesignPage(ctx.cwd, design.id, result.page);
      return {
        success: true,
        design: { id: result.designId, name: result.designName },
        page: result.page,
        page_id: result.pageId,
        rounds: result.rounds,
        saved: result.saved,
        calls: result.calls.map((call) => call.name),
        dsl: "error" in session ? undefined : serializeDsl(session.doc),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const catalogTools: McpTool[] = [
  listDesignsTool,
  getDesignTool,
  createDesignTool,
  promptDesignTool,
  updateDesignTool,
  deleteDesignTool,
  addPageTool,
  deletePageTool,
  listTemplatesTool,
  exportDesignTool,
];

const irTools = DESIGN_TOOL_DOCS.filter((spec) => !SKIP_IR_TOOLS.has(spec.name)).map(irTool);

export const MCP_TOOLS: McpTool[] = [...catalogTools, ...irTools];
export const MCP_TOOLS_MAP = new Map(MCP_TOOLS.map((t) => [t.name, t]));
