import { getNodes, projectNode, queryNodes } from "./query";
import { applyTransaction, createObjects, deleteObjects, updateObjects, useWidget, type CreateObject, type UpdateArgs } from "./mutate";
import { searchIcons, searchIconsLocal } from "./icons";
import { dedupeToolCalls } from "./chat-feedback";
import { documentFromCanvasJson } from "./project";
import { DEFAULT_FIELDS, type DesignDocument } from "./types";
import { serializeDsl } from "./serialize";

export type DesignToolName =
  | "design_query"
  | "design_get"
  | "design_create"
  | "design_update"
  | "design_delete"
  | "design_use_widget"
  | "design_translate"
  | "design_insert_asset"
  | "design_export"
  | "design_search_icons";

export type ToolCall = { id?: string; name: string; arguments: Record<string, unknown> };

let active: DesignDocument | null = null;

export function setActiveDocument(doc: DesignDocument | null) {
  active = doc;
}

export function getActiveDocument(): DesignDocument | null {
  return active;
}

/** Rehydrate IR from page/live canvas JSON when module active was cleared. */
export function resolveDesignDocument(sources: Array<string | null | undefined>): DesignDocument | null {
  if (active) return active;
  for (const raw of sources) {
    const doc = documentFromCanvasJson(raw);
    if (doc) {
      active = doc;
      return doc;
    }
  }
  return null;
}

function needDoc(doc?: DesignDocument | null): DesignDocument {
  const next = doc ?? active;
  if (!next) throw new Error("no design document");
  return next;
}

export function dispatchDesignTool(
  name: string,
  args: Record<string, unknown>,
  doc?: DesignDocument | null,
): unknown {
  if (name === "design_search_icons") {
    const query = String(args.query ?? "");
    const limit = args.limit != null ? Number(args.limit) : 12;
    return { ok: true, query, source: "local", icons: searchIconsLocal(query, limit) };
  }
  const target = needDoc(doc);
  switch (name) {
    case "design_query":
      return queryNodes(target, {
        query: String(args.query ?? ""),
        fields: Array.isArray(args.fields) ? args.fields.map(String) : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined,
      });
    case "design_get": {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const nodes = getNodes(target, ids, Boolean(args.include_children));
      return nodes.map((n) => projectNode(n, [...DEFAULT_FIELDS, "parent", "widget"], target));
    }
    case "design_create":
      return createObjects(target, (args.objects as CreateObject[]) ?? [], Boolean(args.dry_run));
    case "design_update":
      return updateObjects(target, args as UpdateArgs);
    case "design_delete":
      return deleteObjects(target, {
        where: args.where != null ? String(args.where) : undefined,
        ids: Array.isArray(args.ids) ? args.ids.map(String) : undefined,
        dry_run: Boolean(args.dry_run),
      });
    case "design_translate": {
      const keys = Array.isArray(args.keys) ? args.keys.map(String) : [];
      const written: string[] = [];
      for (const key of keys) {
        if (key.endsWith(".*")) {
          const prefix = key.slice(0, -2);
          for (const id of Object.keys(target.content)) {
            if (id.startsWith(prefix)) written.push(id);
          }
          continue;
        }
        if (target.content[key] != null) written.push(key);
      }
      return { ok: true, keys: written, source_locale: args.source_locale, target_locale: args.target_locale };
    }
    case "design_insert_asset": {
      const id = String(args.target ?? "");
      const node = target.nodes.find((n) => n.id === id);
      if (!node) return { ok: false, errors: [{ id, error: `unknown id ${id}` }] };
      node.src = String(args.asset ?? "");
      node.imageBinding = undefined;
      if (args.fit) node.props.fit = String(args.fit);
      return { ok: true, changed: 1, id };
    }
    case "design_use_widget":
      return useWidget(target, {
        widget: args.widget != null ? String(args.widget) : undefined,
        id: args.id != null ? String(args.id) : undefined,
        x: args.x != null ? Number(args.x) : undefined,
        y: args.y != null ? Number(args.y) : undefined,
        w: args.w != null ? Number(args.w) : args.width != null ? Number(args.width) : undefined,
        h: args.h != null ? Number(args.h) : args.height != null ? Number(args.height) : undefined,
        bindings: (args.bindings as Record<string, string>) ?? {},
        content: (args.content as Record<string, string>) ?? undefined,
      });
    case "design_export": {
      const format = String(args.format ?? "dsl");
      if (format === "dsl") return { ok: true, format, dsl: serializeDsl(target) };
      if (format === "json") return { ok: true, format, document: target };
      return { ok: false, errors: [{ error: `export format '${format}' needs canvas projection` }] };
    }
    default:
      if (args.transaction && Array.isArray(args.operations)) {
        return applyTransaction(target, args.operations as Array<Record<string, unknown>>);
      }
      throw new Error(`unknown design tool: ${name}`);
  }
}

/** Loopback-style script: run tool_calls against the IR, no HTTP / no model. */
export function emulateToolScript(
  doc: DesignDocument,
  steps: Array<{ tool_calls?: ToolCall[]; text?: string }>,
): { results: Array<{ name: string; result: unknown }>; text: string } {
  const results: Array<{ name: string; result: unknown }> = [];
  let text = "";
  for (const step of steps) {
    for (const call of step.tool_calls ?? []) {
      results.push({ name: call.name, result: dispatchDesignTool(call.name, call.arguments ?? {}, doc) });
    }
    if (step.text) text = step.text;
  }
  return { results, text };
}

const TOOL_DOCS: Array<{ name: DesignToolName; description: string; parameters: Record<string, unknown> }> = [
  {
    name: "design_query",
    description: "Query the design IR with simple predicates (type=txt role=title). Compact fields by default.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Predicate string, spaces AND, | OR" },
        fields: { type: "array", items: { type: "string" } },
        limit: { type: "integer", default: 50 },
      },
    },
  },
  {
    name: "design_get",
    description: "Fetch objects by stable id, optionally including widget children.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        include_children: { type: "boolean", default: false },
      },
      required: ["ids"],
    },
  },
  {
    name: "design_create",
    description: "Batch-create primitives on the current design document.",
    parameters: {
      type: "object",
      properties: {
        objects: { type: "array", items: { type: "object" } },
        dry_run: { type: "boolean" },
      },
      required: ["objects"],
    },
  },
  {
    name: "design_update",
    description: "Batch patch objects via where+set/transform or explicit patches.",
    parameters: {
      type: "object",
      properties: {
        where: { type: "string" },
        set: { type: "object" },
        transform: { type: "object" },
        replace: { type: "object" },
        patches: { type: "array", items: { type: "object" } },
        layout: { type: "object", description: "column|left|top-left stack, or row. area.x/y + gap." },
        dry_run: { type: "boolean" },
      },
    },
  },
  {
    name: "design_use_widget",
    description: "Instantiate a named widget (feature-group) with id, x/y, and slot bindings (icon/title/caption/body).",
    parameters: {
      type: "object",
      properties: {
        widget: { type: "string" },
        id: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        bindings: { type: "object" },
        content: { type: "object" },
      },
      required: ["widget", "id"],
    },
  },
  {
    name: "design_delete",
    description: "Delete objects by where predicate or ids.",
    parameters: {
      type: "object",
      properties: {
        where: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        dry_run: { type: "boolean" },
      },
    },
  },
  {
    name: "design_translate",
    description: "List content binding keys to persist a translation pass.",
    parameters: {
      type: "object",
      properties: {
        source_locale: { type: "string" },
        target_locale: { type: "string" },
        keys: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "design_insert_asset",
    description: "Point an img id at an asset reference.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string" },
        asset: { type: "string" },
        fit: { type: "string" },
      },
      required: ["target", "asset"],
    },
  },
  {
    name: "design_export",
    description: "Export the IR as dsl or json. png/svg need the Fabric projection.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["dsl", "json", "png", "svg"] },
        path: { type: "string" },
      },
    },
  },
  {
    name: "design_search_icons",
    description: "Search local Tabler icons and Iconify. Use a hit id with design_update set.icon.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        source: { type: "string", enum: ["local", "iconify", "all"] },
        limit: { type: "integer", default: 12 },
      },
      required: ["query"],
    },
  },
];

const MUTATING_TOOLS = new Set([
  "design_create",
  "design_update",
  "design_delete",
  "design_use_widget",
  "design_insert_asset",
  "design_translate",
]);

export type DesignToolsOptions = {
  onChange?: (doc: DesignDocument) => void;
};

/** OpenAI function tools for runTools / --serve client tools[]. Empty until an IR is loaded — chat stays streaming. */
export function createDesignTools(doc?: DesignDocument | null, opts?: DesignToolsOptions) {
  const bound = doc === undefined ? active : doc;
  if (!bound) return [];
  return TOOL_DOCS.map((spec) => ({
    type: "function" as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      function: async (raw: unknown) => {
        const args = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
        const result =
          spec.name === "design_search_icons" ? await searchIcons(args) : dispatchDesignTool(spec.name, args, bound);
        if (MUTATING_TOOLS.has(spec.name)) opts?.onChange?.(bound);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },
  }));
}

export function designToolNames(): string[] {
  return TOOL_DOCS.map((t) => t.name);
}

export function designToolCatalog(names?: string[]): string {
  const allow = names?.length ? new Set(names) : null;
  return TOOL_DOCS.filter((t) => !allow || allow.has(t.name))
    .map((t) => `${t.name}: ${t.description} params=${JSON.stringify(t.parameters)}`)
    .join("\n");
}

function extractJsonObjects(text: string): unknown[] {
  const cleaned = text.replace(/```(?:json)?/gi, "```");
  const bodies = cleaned
    .split("```")
    .map((part, i) => (i % 2 === 1 ? part.trim() : part))
    .filter(Boolean);
  const blobs = bodies.length > 1 ? bodies : [text];
  const found: unknown[] = [];
  for (const blob of blobs) {
    let pos = 0;
    while (pos < blob.length) {
      const start = blob.indexOf("{", pos);
      if (start < 0) break;
      let depth = 0;
      let end = -1;
      for (let i = start; i < blob.length; i++) {
        if (blob[i] === "{") depth += 1;
        else if (blob[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) break;
      try {
        found.push(JSON.parse(blob.slice(start, end + 1)));
      } catch {
        /* skip malformed object */
      }
      pos = end + 1;
    }
  }
  return found;
}

function asToolCall(value: unknown): ToolCall | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const name = String(rec.name ?? rec.tool ?? rec.function ?? "");
  if (!name) return null;
  if (name === "done") return { name: "done", arguments: {} };
  let args = rec.arguments ?? rec.args ?? rec.parameters ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = { raw: args };
    }
  }
  if (!args || typeof args !== "object") args = {};
  return { name, arguments: args as Record<string, unknown> };
}

/** Parse a Local Gemma / loopback text reply into design tool_calls. */
export function parseEmittedToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const obj of extractJsonObjects(text)) {
    if (!obj || typeof obj !== "object") continue;
    const rec = obj as Record<string, unknown>;
    if (Array.isArray(rec.tool_calls)) {
      for (const item of rec.tool_calls) {
        const call = asToolCall(item);
        if (call) calls.push(call);
      }
      continue;
    }
    const call = asToolCall(rec);
    if (call) calls.push(call);
  }
  return calls;
}

export function isDoneCall(call: ToolCall): boolean {
  return call.name === "done";
}

/** Host-run JSON tool_calls from a streamed --serve reply. */
export async function applyEmittedDesignTools(
  text: string,
  doc?: DesignDocument | null,
  opts?: DesignToolsOptions,
): Promise<Array<{ name: string; result: unknown }>> {
  const parsed = parseEmittedToolCalls(text);
  const calls = dedupeToolCalls(parsed);
  if (parsed.length > calls.length) {
    console.info("[design] skipped duplicate tool calls", { before: parsed.length, after: calls.length });
  }
  const target = doc === undefined ? active : doc;
  const needsDoc = calls.some((c) => c.name.startsWith("design_") && c.name !== "design_search_icons");
  if (needsDoc && !target) {
    return [
      {
        name: "design",
        result: {
          ok: false,
          error: "no design IR loaded — open a Feature Cards design (or any design with embedded DSL) before editing",
        },
      },
    ];
  }
  const out: Array<{ name: string; result: unknown }> = [];
  let mutated = false;
  for (const call of calls) {
    if (isDoneCall(call)) continue;
    try {
      const result =
        call.name === "design_search_icons"
          ? await searchIcons(call.arguments)
          : dispatchDesignTool(call.name, call.arguments, target);
      out.push({ name: call.name, result });
      if (MUTATING_TOOLS.has(call.name)) mutated = true;
    } catch (err) {
      out.push({ name: call.name, result: { ok: false, error: err instanceof Error ? err.message : String(err) } });
    }
  }
  if (mutated && target) opts?.onChange?.(target);
  return out;
}
