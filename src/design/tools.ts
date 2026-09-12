import { getNodes, projectNode, queryNodes } from "./query";
import { stylePropsOnly } from "./props-sync";
import {
  applyTransaction,
  copyWidgetStyles,
  createObjects,
  deleteObjects,
  insertImage,
  setPageBackground,
  updateObjects,
  useWidget,
  type CreateObject,
  type UpdateArgs,
} from "./mutate";
import { resolveUploadKey, uploadPublicUrl } from "./upload-paths";
import { searchIcons, searchIconsLocal } from "./icons";
import { dedupeToolCalls } from "./chat-feedback";
import { enrichDocumentFromFabric } from "./props-sync";
import { documentFromCanvasJson, projectToFabricJSON, validateFabricProjection } from "./project";
import { cloneDocument, DEFAULT_FIELDS, type DesignDocument } from "./types";
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
  | "design_set_page_background"
  | "design_insert_image"
  | "design_copy_styles"
  | "design_export"
  | "design_screenshot"
  | "design_search_icons";

export type ToolCall = { id?: string; name: string; arguments: Record<string, unknown> };

let active: DesignDocument | null = null;

export function setActiveDocument(doc: DesignDocument | null) {
  active = doc;
}

export function getActiveDocument(): DesignDocument | null {
  return active;
}

type ResolveSource = string | DesignDocument | null | undefined;

/** Rehydrate IR for the next chat edit. Prefers in-memory IR, then live canvas DSL, then saved page JSON. */
export function resolveDesignDocument(sources: Array<ResolveSource>): DesignDocument | null {
  let doc: DesignDocument | null = null;
  for (const raw of sources) {
    if (raw && typeof raw === "object" && "nodes" in raw) {
      doc = cloneDocument(raw as DesignDocument);
      break;
    }
  }
  if (!doc) {
    for (const raw of sources) {
      if (!raw || typeof raw !== "string" || raw === "{}") continue;
      const parsed = documentFromCanvasJson(raw);
      if (parsed) {
        doc = parsed;
        break;
      }
    }
  }
  if (!doc && active) doc = cloneDocument(active);
  if (!doc) return null;

  const fabricRaw = sources.find(
    (raw): raw is string => typeof raw === "string" && raw !== "{}" && /"objects"\s*:/.test(raw),
  );
  if (fabricRaw) enrichDocumentFromFabric(doc, fabricRaw);
  active = doc;
  return cloneDocument(doc);
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
  if (name === "design_screenshot") {
    return { ok: true, pending: "canvas", format: "jpeg" };
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
      return nodes.map((n) => {
        const styles = stylePropsOnly(n.props);
        return {
          ...projectNode(n, [...DEFAULT_FIELDS, "parent", "widget"], target),
          type: n.type,
          ...(Object.keys(styles).length ? { props: styles } : {}),
        };
      });
    }
    case "design_copy_styles":
      return copyWidgetStyles(target, {
        from: String(args.from ?? ""),
        to: String(args.to ?? ""),
        slots: Array.isArray(args.slots) ? args.slots.map(String) : undefined,
      });
    case "design_create":
      return createObjects(target, (args.objects as CreateObject[]) ?? [], Boolean(args.dry_run), {
        behind: Boolean(args.behind),
      });
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
      const asset = String(args.asset ?? "");
      node.src = asset.startsWith("asset:") || asset.startsWith("http") || asset.startsWith("/")
        ? asset
        : uploadPublicUrl(resolveUploadKey(asset));
      node.imageBinding = undefined;
      if (args.fit) node.props.fit = String(args.fit);
      return { ok: true, changed: 1, id };
    }
    case "design_set_page_background":
      return setPageBackground(target, {
        src: args.src != null ? String(args.src) : undefined,
        clear: Boolean(args.clear),
      });
    case "design_insert_image":
      return insertImage(target, {
        id: String(args.id ?? ""),
        src: String(args.src ?? ""),
        x: args.x != null ? Number(args.x) : undefined,
        y: args.y != null ? Number(args.y) : undefined,
        w: args.w != null ? Number(args.w) : undefined,
        h: args.h != null ? Number(args.h) : undefined,
        fit: args.fit != null ? String(args.fit) : undefined,
      });
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
      if (format === "png" || format === "jpeg" || format === "jpg") {
        return { ok: true, pending: "canvas", format: format === "png" ? "png" : "jpeg" };
      }
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

export const DESIGN_TOOL_DOCS: Array<{ name: DesignToolName; description: string; parameters: Record<string, unknown> }> = [
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
        behind: { type: "boolean", description: "Insert new shapes under existing cards (pane / backdrop)." },
        dry_run: { type: "boolean" },
      },
      required: ["objects"],
    },
  },
  {
    name: "design_copy_styles",
    description: "Copy style props (fill, glass, shadow, …) from one feature-group instance to another.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source widget instance id e.g. feature.chat" },
        to: { type: "string", description: "Target widget instance id e.g. feature.local" },
        slots: { type: "array", items: { type: "string" }, description: "Optional slot subset: bg, icon, title, caption, body" },
      },
      required: ["from", "to"],
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
        layout: { type: "object", description: "column|row stack, or fit (scale selection into area/canvas). area.x/y/w/h + gap." },
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
    description: "Point an img id at an upload key or asset reference.",
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
    name: "design_set_page_background",
    description: "Set full-page photo background from uploads/backgrounds/ key or clear it.",
    parameters: {
      type: "object",
      properties: {
        src: { type: "string", description: "uploads/backgrounds/hero-v1.png or public URL" },
        clear: { type: "boolean" },
      },
    },
  },
  {
    name: "design_insert_image",
    description: "Place an uploaded raster image on the canvas (uploads/ key or URL).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        src: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
        fit: { type: "string" },
      },
      required: ["id", "src"],
    },
  },
  {
    name: "design_export",
    description: "Export the IR as dsl or json. For a canvas screenshot use design_screenshot (last resort).",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["dsl", "json", "png", "svg"] },
        path: { type: "string" },
      },
    },
  },
  {
    name: "design_screenshot",
    description:
      "Capture the live editor canvas to uploads/screenshots/canvas.jpg and return {path}. Then call image_understand with that exact path. Prefer SCENE / design_query / design_get when DSL is enough.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the DSL is not enough (overlap, stacking, clipped text, …)" },
      },
    },
  },
  {
    name: "design_search_icons",
    description:
      "Search local Tabler icons and Iconify. Iconify query must be a single word (shield, lock, chat) — not a phrase. Use a hit id with design_update set.icon.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "One word only, e.g. shield. Do not pass \"security shield\" or other multi-word phrases.",
        },
        source: { type: "string", enum: ["local", "iconify", "all"] },
        limit: { type: "integer", default: 12 },
      },
      required: ["query"],
    },
  },
];

export const MUTATING_DESIGN_TOOLS = new Set([
  "design_create",
  "design_update",
  "design_copy_styles",
  "design_delete",
  "design_use_widget",
  "design_insert_asset",
  "design_set_page_background",
  "design_insert_image",
  "design_translate",
]);

export type DesignToolsOptions = {
  onChange?: (doc: DesignDocument) => void;
};

/** OpenAI function tools for runTools / --serve client tools[]. Empty until an IR is loaded — chat stays streaming. */
export function createDesignTools(doc?: DesignDocument | null, opts?: DesignToolsOptions) {
  const bound = doc === undefined ? active : doc;
  if (!bound) return [];
  return DESIGN_TOOL_DOCS.map((spec) => ({
    type: "function" as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      function: async (raw: unknown) => {
        const args = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
        const result =
          spec.name === "design_search_icons" ? await searchIcons(args) : dispatchDesignTool(spec.name, args, bound);
        if (MUTATING_DESIGN_TOOLS.has(spec.name)) opts?.onChange?.(bound);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },
  }));
}

export function designToolNames(): string[] {
  return DESIGN_TOOL_DOCS.map((t) => t.name);
}

export function designToolCatalog(names?: string[]): string {
  const allow = names?.length ? new Set(names) : null;
  return DESIGN_TOOL_DOCS.filter((t) => !allow || allow.has(t.name))
    .map((t) => `${t.name}: ${t.description} params=${JSON.stringify(t.parameters)}`)
    .join("\n");
}

function scanJsonObjectEnd(blob: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < blob.length; i++) {
    const ch = blob[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function repairTruncatedJson(slice: string): string | null {
  const trimmed = slice.trimStart();
  if (!trimmed.startsWith("{")) return null;
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let repaired = slice;
  if (inString) repaired += '"';
  if (/[,{]\s*"(?:[^"\\]|\\.)*"\s*$/.test(repaired)) repaired += ':""';
  while (stack.length) repaired += stack.pop();
  return repaired;
}

function tryParseJsonObject(blob: string, start: number): { value: unknown; end: number } | null {
  const end = scanJsonObjectEnd(blob, start);
  if (end >= 0) {
    try {
      return { value: JSON.parse(blob.slice(start, end + 1)), end };
    } catch {
      /* try repair below */
    }
  }
  const repaired = repairTruncatedJson(blob.slice(start));
  if (!repaired) return null;
  try {
    return { value: JSON.parse(repaired), end: blob.length - 1 };
  } catch {
    return null;
  }
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
      const parsed = tryParseJsonObject(blob, start);
      if (!parsed) break;
      found.push(parsed.value);
      pos = parsed.end + 1;
    }
  }
  return found;
}

function isEmittedToolJsonBlob(slice: string): boolean {
  return (
    /(?:design_|image_)[a-z_]+/i.test(slice) ||
    /"name"\s*:\s*"(?:image_create|image_transform|transform)"/i.test(slice)
  );
}

/** Remove emitted tool JSON blobs from assistant text (prose-only display / chat history). */
export function stripDesignToolJsonFromText(text: string): string {
  let result = text.replace(/```(?:json)?[\s\S]*?```/gi, "");
  const cuts: Array<{ start: number; end: number }> = [];
  let pos = 0;
  while (pos < result.length) {
    const start = result.indexOf("{", pos);
    if (start < 0) break;
    const end = scanJsonObjectEnd(result, start);
    if (end < 0) {
      if (isEmittedToolJsonBlob(result.slice(start))) cuts.push({ start, end: result.length });
      break;
    }
    if (isEmittedToolJsonBlob(result.slice(start, end + 1))) cuts.push({ start, end: end + 1 });
    pos = end + 1;
  }
  for (const cut of cuts.reverse()) result = result.slice(0, cut.start) + result.slice(cut.end);
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export type DesignToolJsonIssue = {
  at: number;
  snippet: string;
  kind: "unclosed_object";
};

/** Find incomplete `{...design_*...}` blobs (for logging / truncation UX). */
export function describeDesignToolJsonIssues(text: string): DesignToolJsonIssue[] {
  const issues: DesignToolJsonIssue[] = [];
  if (!/design_[a-z_]+/i.test(text)) return issues;
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("{", pos);
    if (start < 0) break;
    const slice = text.slice(start);
    if (!/design_[a-z_]+/i.test(slice)) {
      pos = start + 1;
      continue;
    }
    if (scanJsonObjectEnd(text, start) < 0) {
      issues.push({
        at: start,
        kind: "unclosed_object",
        snippet: text.slice(start, Math.min(text.length, start + 120)),
      });
      break;
    }
    pos = start + 1;
  }
  return issues;
}

/** True when assistant text looks like cut-off design tool JSON. */
export function looksTruncatedDesignToolJson(text: string): boolean {
  return describeDesignToolJsonIssues(text).length > 0;
}

function extractCompleteArrayObjects(blob: string, bracketStart: number): unknown[] {
  const found: unknown[] = [];
  let pos = bracketStart + 1;
  while (pos < blob.length) {
    while (pos < blob.length && /[\s,]/.test(blob[pos]!)) pos += 1;
    if (pos >= blob.length || blob[pos] === "]") break;
    if (blob[pos] !== "{") break;
    const end = scanJsonObjectEnd(blob, pos);
    if (end < 0) break;
    try {
      found.push(JSON.parse(blob.slice(pos, end + 1)));
      pos = end + 1;
    } catch {
      break;
    }
  }
  return found;
}

function tryParseToolObjectAt(text: string, start: number, push: (call: ToolCall | null) => void) {
  if (start < 0) return;
  const end = scanJsonObjectEnd(text, start);
  if (end >= 0) {
    try {
      push(asToolCall(JSON.parse(text.slice(start, end + 1))));
    } catch {
      /* skip */
    }
    return;
  }
  const repaired = repairTruncatedJson(text.slice(start));
  if (!repaired) return;
  try {
    push(asToolCall(JSON.parse(repaired)));
  } catch {
    /* skip */
  }
}

function salvageToolCallsFromText(text: string): ToolCall[] {
  const seen = new Set<string>();
  const calls: ToolCall[] = [];
  const push = (call: ToolCall | null) => {
    if (!call) return;
    const key = `${call.name}\0${JSON.stringify(call.arguments)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(call);
  };

  const marker = /"tool_calls"\s*:/g;
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    const bracket = text.indexOf("[", match.index);
    if (bracket < 0) continue;
    for (const item of extractCompleteArrayObjects(text, bracket)) {
      push(asToolCall(item));
    }
    let scanFrom = bracket;
    while (scanFrom < text.length) {
      const slice = text.slice(scanFrom);
      const rel = slice.search(/"name"\s*:\s*"design_/i);
      if (rel < 0) break;
      const hit = scanFrom + rel;
      const start = text.lastIndexOf("{", hit);
      scanFrom = hit + 1;
      if (start < bracket) continue;
      const end = scanJsonObjectEnd(text, start);
      if (end >= 0) continue;
      tryParseToolObjectAt(text, start, push);
    }
  }

  const nameRe = /"name"\s*:\s*"(?:design_|image_)[a-z_]+"/gi;
  for (let match = nameRe.exec(text); match; match = nameRe.exec(text)) {
    tryParseToolObjectAt(text, text.lastIndexOf("{", match.index), push);
  }
  return calls;
}

function asToolCall(value: unknown): ToolCall | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.function && typeof rec.function === "object") return asToolCall(rec.function);
  const name = String(rec.name ?? rec.tool ?? "");
  if (!name || name === "[object Object]") return null;
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

function toolCallsFromObject(obj: unknown): ToolCall[] {
  if (!obj || typeof obj !== "object") return [];
  const rec = obj as Record<string, unknown>;
  if (Array.isArray(rec.tool_calls)) {
    return rec.tool_calls.map((item) => asToolCall(item)).filter((c): c is ToolCall => !!c && !isDoneCall(c));
  }
  const single = asToolCall(rec);
  return single && !isDoneCall(single) ? [single] : [];
}

function isMediaToolName(name: string): boolean {
  return name === "image_create" || name === "image_transform" || name === "transform";
}

/** Last tool-bearing object only — used when an old image_* blob is glued to a newer design_* call. */
function toolCallsFromLastObject(objects: unknown[]): ToolCall[] {
  for (let i = objects.length - 1; i >= 0; i--) {
    const calls = toolCallsFromObject(objects[i]);
    if (calls.length) return calls;
  }
  return [];
}

/** All design_* blobs in order; drop earlier image_* when a later design_* blob is present. */
function collectEmittedToolCalls(objects: unknown[]): ToolCall[] {
  const perObject = objects.map(toolCallsFromObject);
  const flat = perObject.flat();
  if (!flat.length) return [];
  if (objects.length <= 1) return flat;
  const last = perObject[perObject.length - 1] ?? [];
  const lastHasDesign = last.some((c) => c.name.startsWith("design_"));
  const lastHasMedia = last.some((c) => isMediaToolName(c.name));
  if (lastHasDesign && !lastHasMedia) {
    return flat.filter((c) => c.name.startsWith("design_") || !isMediaToolName(c.name));
  }
  if (flat.some((c) => isMediaToolName(c.name)) && lastHasDesign) return toolCallsFromLastObject(objects);
  return flat;
}

export function countEmittedJsonObjects(text: string): number {
  return extractJsonObjects(text).length;
}

/** Parse a Local Gemma / loopback text reply into design tool_calls. */
export function parseEmittedToolCalls(text: string): ToolCall[] {
  const objects = extractJsonObjects(text);
  if (objects.length) {
    const calls = collectEmittedToolCalls(objects);
    if (calls.length) return dedupeToolCalls(calls);
  }

  const salvaged = salvageToolCallsFromText(text);
  if (salvaged.length) return dedupeToolCalls(salvaged);
  return [];
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
  const parsed = parseEmittedToolCalls(text).filter(
    (c) =>
      c.name !== "image_create" &&
      c.name !== "image_transform" &&
      c.name !== "transform" &&
      c.name !== "image_understand",
  );
  const calls = dedupeToolCalls(parsed);
  if (parsed.length > calls.length) {
    console.info("[design] skipped duplicate tool calls", { before: parsed.length, after: calls.length });
  }
  const base = doc === undefined ? active : doc;
  const target = base && opts?.onChange ? cloneDocument(base) : base;
  const needsDoc = calls.some(
    (c) => c.name.startsWith("design_") && c.name !== "design_search_icons" && c.name !== "design_screenshot",
  );
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
      if (MUTATING_DESIGN_TOOLS.has(call.name)) mutated = true;
    } catch (err) {
      out.push({ name: call.name, result: { ok: false, error: err instanceof Error ? err.message : String(err) } });
    }
  }
  if (mutated && target) {
    const projection = validateFabricProjection(target, projectToFabricJSON(target));
    if (!projection.ok) {
      console.warn("[design] projection validation failed after tool run", projection);
      const last = out[out.length - 1];
      if (last?.result && typeof last.result === "object" && !Array.isArray(last.result)) {
        (last.result as Record<string, unknown>).projection = projection;
      }
    } else if (projection.offCanvas.length) {
      console.info("[design] widget instance off visible canvas", projection.offCanvas, projection.instances);
      const last = out[out.length - 1];
      if (last?.result && typeof last.result === "object" && !Array.isArray(last.result)) {
        (last.result as Record<string, unknown>).projection = projection;
      }
    }
    active = target;
    opts?.onChange?.(target);
  }
  return out;
}
