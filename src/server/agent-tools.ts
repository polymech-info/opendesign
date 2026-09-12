import path from "node:path";
import {
  DESIGN_TOOL_DOCS,
  MUTATING_DESIGN_TOOLS,
  applyUploadFromToolResult,
  designChatBrief,
  dispatchDesignTool,
  isMediaWriteTool,
  pathToolFailed,
  searchIcons,
  type DesignBriefAttachment,
  type ProjectGuides,
} from "../design/index.js";
import { persistDesignPage, resolveDesignPage } from "../mcp/session.js";
import { loadProjectGuides } from "./project-guides.js";
import { PROJECT_DIRNAME } from "./paths.js";
import * as store from "./store.js";

export const HOST_TOOL_PROVIDER_ID = "opendesign";

const HOST_SKIP = new Set(["design_export"]);

export type AgentToolSession = {
  design?: string;
  page?: number;
  selectionIds?: string[];
  selectionCount?: number;
  projectRoot?: string;
  attachments?: DesignBriefAttachment[];
  screenshotPath?: string;
};

let heartbeat: AgentToolSession = {};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function hostToolCatalog() {
  const tools = DESIGN_TOOL_DOCS.filter((spec) => !HOST_SKIP.has(spec.name)).map((spec) => {
    const properties = {
      design: {
        type: "string",
        description: "Design id or name. Defaults to the open editor design.",
      },
      page: {
        type: "integer",
        description: "1-based page. Defaults to the open editor page.",
      },
      ...((spec.parameters.properties as Record<string, unknown>) ?? {}),
    };
    const required = [...((spec.parameters.required as string[]) ?? [])];
    return {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      },
    };
  });
  return {
    id: HOST_TOOL_PROVIDER_ID,
    name: "OpenDesign",
    tools,
  };
}

export function putAgentToolSession(body: unknown): AgentToolSession {
  const rec = asRecord(body);
  const attachments = Array.isArray(rec.attachments)
    ? rec.attachments
        .map((row) => {
          const item = asRecord(row);
          const src = str(item.src);
          if (!src) return null;
          return { src, name: str(item.name) };
        })
        .filter((row): row is DesignBriefAttachment => Boolean(row))
    : undefined;
  const selectionIds = Array.isArray(rec.selectionIds)
    ? rec.selectionIds.map((id) => String(id).trim()).filter(Boolean)
    : undefined;
  heartbeat = {
    design: str(rec.design),
    page: Math.max(1, Math.floor(num(rec.page) ?? 1)),
    selectionIds,
    selectionCount: Math.max(0, Math.floor(num(rec.selectionCount) ?? selectionIds?.length ?? 0)),
    projectRoot: str(rec.projectRoot),
    attachments,
    screenshotPath: str(rec.screenshotPath),
  };
  return heartbeat;
}

export function getAgentToolSession(): AgentToolSession {
  return { ...heartbeat };
}

function sessionCwd(fallbackCwd: string, extra?: Record<string, unknown>): string {
  const fromExtra = str(extra?.cwd);
  if (fromExtra && path.basename(fromExtra) !== PROJECT_DIRNAME) return fromExtra;
  if (fromExtra) return path.dirname(fromExtra);
  return fallbackCwd;
}

function selectionFallbackLine(): string {
  const ids = heartbeat.selectionIds ?? [];
  if (ids.length) return `SELECTION: ${ids.join(", ")}`;
  const count = heartbeat.selectionCount ?? 0;
  if (count > 0) {
    return `SELECTION: ${count} canvas object(s) with no Design DSL ids — call design_query or ask the user to save the page.`;
  }
  return "SELECTION: none";
}

export function agentToolContextPrompt(fallbackCwd: string): string {
  const cwd = sessionCwd(fallbackCwd);
  const designQuery = heartbeat.design;
  const page = heartbeat.page ?? 1;
  const session = resolveDesignPage(cwd, designQuery, page);
  if ("error" in session) {
    return [
      "The OpenDesign editor is connected. Host tools are live (design_query, design_update, …).",
      `DESIGN heartbeat: ${designQuery || "(none)"} page ${page}`,
      selectionFallbackLine(),
      `Scene unavailable: ${session.error}`,
      "Call design_query once you have a design id. Do not use info_lookup or app_command. Do not say there is no UI.",
    ].join("\n");
  }
  const guides: ProjectGuides = loadProjectGuides(cwd);
  return [
    "OpenDesign host tools are native on this turn. Call design_* then answer the user.",
    `DESIGN: ${session.design.name} (${session.design.id}) page ${session.pageNumber}`,
    designChatBrief(session.doc, {
      selectionIds: heartbeat.selectionIds,
      guides,
      projectRoot: heartbeat.projectRoot || session.roots.project,
      attachments: heartbeat.attachments,
    }),
    heartbeat.screenshotPath
      ? `SCREENSHOT: ${heartbeat.screenshotPath} — design_screenshot returns this path; copy it into image_understand.`
      : "",
    heartbeat.selectionCount && !(heartbeat.selectionIds ?? []).length
      ? selectionFallbackLine()
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function callHostTool(
  fallbackCwd: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const rec = asRecord(body);
  const name = str(rec.name);
  if (!name) return { ok: false, error: "'name' is required" };
  const args = asRecord(rec.arguments);
  const extra = asRecord(rec.context);
  const cwd = sessionCwd(fallbackCwd, extra);

  if (name === "design_search_icons") {
    const result = await searchIcons(args);
    return { ok: true, result };
  }

  const catalog = hostToolCatalog();
  if (!catalog.tools.some((tool) => tool.name === name)) {
    return { ok: false, error: `unknown host tool: ${name}` };
  }

  if (name === "design_screenshot") {
    const shot = heartbeat.screenshotPath;
    if (!shot) {
      return {
        ok: false,
        error:
          "no live canvas screenshot yet — send from the editor chat so the canvas can be captured, then call design_screenshot again",
      };
    }
    return {
      ok: true,
      saved: false,
      result: {
        ok: true,
        path: shot,
        format: "jpeg",
        next_step: "Call image_understand with this exact disk path from PICTURES or this result.",
      },
    };
  }

  const designQuery = str(args.design) || heartbeat.design;
  const page = Math.max(1, Math.floor(num(args.page) ?? heartbeat.page ?? 1));
  const session = resolveDesignPage(cwd, designQuery, page);
  if ("error" in session) return { ok: false, error: session.error };

  const before = store.getDesign(session.roots, session.design.id);
  let result: unknown;
  try {
    result = dispatchDesignTool(name, args, session.doc);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (result && typeof result === "object" && (result as { ok?: boolean }).ok === false) {
    return { ok: false, document_id: session.design.id, result };
  }

  const mutated = MUTATING_DESIGN_TOOLS.has(name);
  if (mutated) persistDesignPage(session, "agent", name);
  const after = store.getDesign(session.roots, session.design.id);
  return {
    ok: true,
    document_id: session.design.id,
    revision_before: before?.updated_at,
    revision_after: after?.updated_at,
    saved: mutated,
    design: { id: session.design.id, name: session.design.name },
    page: session.pageNumber,
    result,
  };
}

/** Point the live canvas at an image_transform / image_create output. */
export function applyHostMediaResult(
  fallbackCwd: string,
  body: unknown,
): Record<string, unknown> {
  const rec = asRecord(body);
  const name = str(rec.name) ?? "";
  if (!isMediaWriteTool(name)) {
    return { ok: false, error: "apply-media expects image_transform or image_create" };
  }
  const args = asRecord(rec.arguments);
  const result = rec.result ?? rec.envelope ?? rec;
  if (pathToolFailed(result)) return { ok: false, error: "media tool failed" };

  const extra = asRecord(rec.context);
  const cwd = sessionCwd(fallbackCwd, extra);
  const session = resolveDesignPage(cwd, heartbeat.design, heartbeat.page ?? 1);
  if ("error" in session) return { ok: false, error: session.error };

  const before = store.getDesign(session.roots, session.design.id);
  const applied = applyUploadFromToolResult(session.doc, name, result, args, {
    selectionIds: heartbeat.selectionIds,
  });
  if (!applied) return { ok: true, applied: false, document_id: session.design.id };

  const changed = Number(asRecord(applied.result).changed ?? 1);
  if (changed !== 0) persistDesignPage(session, "agent", applied.tool);
  const after = store.getDesign(session.roots, session.design.id);
  return {
    ok: true,
    applied: true,
    tool: applied.tool,
    output_path: applied.outputPath,
    document_id: session.design.id,
    revision_before: before?.updated_at,
    revision_after: after?.updated_at,
    saved: changed !== 0,
    result: applied.result,
  };
}

export function mountAgentTools(
  app: {
    get: (path: string, handler: (c: { json: (body: unknown, status?: number) => Response }) => Response | Promise<Response>) => unknown;
    put: (path: string, handler: (c: { req: { json: () => Promise<unknown> }; json: (body: unknown, status?: number) => Response }) => Response | Promise<Response>) => unknown;
    post: (path: string, handler: (c: { req: { json: () => Promise<unknown> }; json: (body: unknown, status?: number) => Response }) => Response | Promise<Response>) => unknown;
  },
  opts: { cwd: string },
) {
  app.get("/api/agent-tools", (c) => c.json(hostToolCatalog()));
  app.get("/api/agent-tools/context", (c) =>
    c.json({ prompt: agentToolContextPrompt(opts.cwd) }),
  );
  app.put("/api/agent-tools/session", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ ok: true, session: putAgentToolSession(body) });
  });
  app.post("/api/agent-tools/call", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await callHostTool(opts.cwd, body);
    return c.json(result);
  });
  app.post("/api/agent-tools/apply-media", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(applyHostMediaResult(opts.cwd, body));
  });
}
