import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  fetchIconifySvg,
  fetchIconifySvgs,
  iconFilename,
  parseIconId,
  searchIconify,
} from "./iconify.js";
import { ensureLayouts, sameRoots, type Roots } from "./paths.js";
import * as store from "./store.js";
import { tablerMiddleware } from "./tabler.js";
import {
  appendExportLog,
  completeExportJob,
  failExportJob,
  isExportToken,
} from "./export-jobs.js";
import {
  deleteUpload,
  getUpload,
  listUploads,
  putUpload,
  putUploadKey,
  type UploadKind,
} from "./uploads.js";
import { mountLlmProxy, type LlmTarget } from "./llm.js";
import { mountAgentTools } from "./agent-tools.js";
import { appendDesignJournal, readDesignJournal } from "./design-journal.js";
import { mcpDeleteResponse, mcpGetResponse, mcpOptionsResponse, mcpPostResponse } from "../mcp/http.js";
import { loadProjectGuides } from "./project-guides.js";
import { imageBytesFromDataUrl, pngBytesFromDataUrl, writeDocsAssetScreenshot, writeProjectDesignPng } from "./project-png.js";

export type AppOptions = {
  roots: Roots;
  iconDir: string;
  llm?: LlmTarget;
};

const DesignSchema = z.object({
  id: z.string(),
  name: z.string(),
  canvas_json: z.string(),
  width: z.number(),
  height: z.number(),
  thumbnail_url: z.string().nullable(),
  thumbnail_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  updated_by: z.enum(["editor", "cli"]).optional(),
  source: z.string().optional(),
});

const DesignRevisionSchema = z.object({
  id: z.string(),
  updated_at: z.string(),
  updated_by: z.enum(["editor", "cli"]).optional(),
});

const DesignVersionMetaSchema = z.object({
  id: z.string(),
  design_id: z.string(),
  rev: z.number(),
  kind: z.enum(["auto", "manual"]),
  title: z.string(),
  description: z.string(),
  created_at: z.string(),
  created_by: z.enum(["editor", "cli"]),
  content_hash: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
});

const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  canvas_json: z.string(),
  width: z.number(),
  height: z.number(),
  thumbnail_url: z.string().nullable(),
  sort_order: z.number(),
  source: z.string().optional(),
});

const PageSchema = z.object({
  id: z.string(),
  design_id: z.string(),
  title: z.string(),
  canvas_json: z.string(),
  sort_order: z.number(),
  created_at: z.string(),
});

const DesignVersionDetailSchema = DesignVersionMetaSchema.extend({
  canvas_json: z.string(),
  thumbnail_url: z.string().nullable().optional(),
  pages: z.array(PageSchema),
});

const DesignWithPagesSchema = DesignSchema.extend({
  pages: z.array(PageSchema),
});

const LibraryElementSchema = z.object({
  id: z.string(),
  name: z.string(),
  canvas_json: z.string(),
  width: z.number(),
  height: z.number(),
  created_at: z.string(),
  source: z.string().optional(),
});

const ErrorSchema = z.object({ error: z.string() });

function uploadKindFromQuery(value: string | undefined): UploadKind {
  if (value === "backgrounds") return "backgrounds";
  if (value === "icons") return "icons";
  return "images";
}

export function createOpenDesignApp(opts: AppOptions) {
  const { roots, iconDir, llm } = opts;
  ensureLayouts(roots);

  const app = new OpenAPIHono();

  app.use("*", async (c, next) => tablerMiddleware(iconDir, c, next));
  if (llm) mountLlmProxy(app, llm);
  mountAgentTools(app, { cwd: roots.cwd });

  app.get("/api/meta", (c) =>
    c.json({
      cwd: roots.cwd,
      project: roots.project,
      global: roots.global,
      merged: !sameRoots(roots),
      merge: "union of global + project; same id/key uses the project copy",
    })
  );

  app.get("/api/guides", (c) => c.json(loadProjectGuides(roots.cwd)));

  const mcpCtx = { cwd: roots.cwd, llm };
  for (const route of ["/api/mcp", "/mcp"]) {
    app.options(route, () => mcpOptionsResponse());
    app.get(route, (c) => mcpGetResponse(c));
    app.delete(route, (c) => mcpDeleteResponse(c));
    app.post(route, (c) => mcpPostResponse(c, mcpCtx));
  }

  app.post("/api/export-jobs/:token/log", async (c) => {
    const token = c.req.param("token");
    if (!isExportToken(token)) return c.json({ error: "Invalid token" }, 400);
    const body = await c.req.json<{ line?: string; lines?: string[] }>().catch(() => ({}));
    const lines = [
      ...(Array.isArray(body.lines) ? body.lines : []),
      ...(typeof body.line === "string" ? [body.line] : []),
    ];
    for (const line of lines) {
      if (typeof line === "string") appendExportLog(token, line);
    }
    return c.json({ ok: true });
  });

  app.post("/api/export-jobs/:token", async (c) => {
    const token = c.req.param("token");
    if (!isExportToken(token)) return c.json({ error: "Invalid token" }, 400);
    const type = c.req.header("content-type") || "";
    if (type.includes("application/json")) {
      const body = await c.req.json<{ error?: string; logs?: string[] }>().catch(() => ({ error: "export failed" }));
      for (const line of body.logs ?? []) appendExportLog(token, line);
      failExportJob(token, new Error(body.error || "export failed"));
      return c.json({ ok: false });
    }
    const png = Buffer.from(await c.req.arrayBuffer());
    if (!png.byteLength) {
      failExportJob(token, new Error("empty PNG"));
      return c.json({ error: "empty PNG" }, 400);
    }
    if (!completeExportJob(token, png)) return c.json({ error: "unknown job" }, 404);
    return c.json({ ok: true });
  });

  app.get("/llms.txt", (c) =>
    c.text(`# OpenDesign

Local design editor. JSON + files on disk, no cloud.

## Folders
- Project: ${roots.project}
- Global: ${roots.global}

Lists MERGE both folders (union). Same id/filename: project copy is used; unique items from both appear. Writes go to project except Iconify downloads (global icon library). Delete removes the visible layer (project first), which can reveal the global copy underneath.

## API
- GET /api/meta
- GET/POST /api/designs
- GET /api/designs/{id}/revision
- GET/POST /api/designs/{id}/versions
- DELETE /api/designs/{id}/versions/{rev}
- POST /api/designs/{id}/versions/{rev}/restore
- GET/PUT/DELETE /api/designs/{id}
- POST /api/designs/{id}/duplicate
- POST /api/designs/{id}/pages
- PUT/DELETE /api/pages/{pageId}
- POST /api/pages/{pageId}/duplicate
- GET /api/templates
- GET /api/templates/{id}
- GET/POST /api/elements
- DELETE /api/elements/{id}
- POST /api/export/png
- GET/POST /api/uploads
- GET/DELETE /api/uploads/file/{key}
- GET /api/icons/search
- POST /api/icons/preview
- GET /api/icons/svg
- POST /api/icons/download
- GET /api/openapi.json
- ALL /api/llm/*  (proxy to tanit-cli llm agent --serve)
- POST /api/path-tools/call  (image_create / image_transform / image_understand → tanit path-tools)
- GET /api/agent-tools
- GET /api/agent-tools/context
- PUT /api/agent-tools/session
- POST /api/agent-tools/call
- GET/POST /api/design/journal  (append/read design tool apply log — .OpenDesign/journal/design-changes.jsonl)
`)
  );

  const listDesigns = createRoute({
    method: "get",
    path: "/api/designs",
    responses: { 200: { content: { "application/json": { schema: z.array(DesignSchema) } }, description: "OK" } },
  });
  app.openapi(listDesigns, (c) => c.json(store.listDesigns(roots), 200));

  const getDesign = createRoute({
    method: "get",
    path: "/api/designs/{id}",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: DesignWithPagesSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(getDesign, (c) => {
    const { id } = c.req.valid("param");
    const row = store.getDesign(roots, id);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const getDesignRevision = createRoute({
    method: "get",
    path: "/api/designs/{id}/revision",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: DesignRevisionSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(getDesignRevision, (c) => {
    const { id } = c.req.valid("param");
    const row = store.getDesignRevision(roots, id);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const listVersions = createRoute({
    method: "get",
    path: "/api/designs/{id}/versions",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: z.array(DesignVersionMetaSchema) } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(listVersions, (c) => {
    const { id } = c.req.valid("param");
    if (!store.getDesign(roots, id)) return c.json({ error: "Not found" }, 404);
    return c.json(store.listVersions(roots, id), 200);
  });

  const createVersion = createRoute({
    method: "post",
    path: "/api/designs/{id}/versions",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              kind: z.enum(["auto", "manual"]).optional(),
              title: z.string().optional(),
              description: z.string().optional(),
              created_by: z.enum(["editor", "cli"]).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ version: DesignVersionMetaSchema, created: z.boolean() }),
          },
        },
        description: "OK",
      },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(createVersion, (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const result = store.snapshotDesignVersion(roots, id, {
      kind: body.kind ?? "manual",
      title: body.title,
      description: body.description,
      created_by: body.created_by ?? "editor",
    });
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result, 200);
  });

  const getVersion = createRoute({
    method: "get",
    path: "/api/designs/{id}/versions/{rev}",
    request: { params: z.object({ id: z.string(), rev: z.coerce.number().int().positive() }) },
    responses: {
      200: { content: { "application/json": { schema: DesignVersionDetailSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(getVersion, (c) => {
    const { id, rev } = c.req.valid("param");
    const row = store.readVersion(roots, id, rev);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const updateVersion = createRoute({
    method: "put",
    path: "/api/designs/{id}/versions/{rev}",
    request: {
      params: z.object({ id: z.string(), rev: z.coerce.number().int().positive() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              canvas_json: z.string().optional(),
              pages: z.array(z.object({ id: z.string(), canvas_json: z.string() })).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { content: { "application/json": { schema: DesignVersionDetailSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(updateVersion, (c) => {
    const { id, rev } = c.req.valid("param");
    const row = store.writeVersion(roots, id, rev, c.req.valid("json"));
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const deleteVersion = createRoute({
    method: "delete",
    path: "/api/designs/{id}/versions/{rev}",
    request: { params: z.object({ id: z.string(), rev: z.coerce.number().int().positive() }) },
    responses: {
      200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(deleteVersion, (c) => {
    const { id, rev } = c.req.valid("param");
    if (!store.removeDesignVersion(roots, id, rev)) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true }, 200);
  });

  const restoreVersion = createRoute({
    method: "post",
    path: "/api/designs/{id}/versions/{rev}/restore",
    request: { params: z.object({ id: z.string(), rev: z.coerce.number().int().positive() }) },
    responses: {
      200: { content: { "application/json": { schema: DesignWithPagesSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(restoreVersion, (c) => {
    const { id, rev } = c.req.valid("param");
    const row = store.restoreVersion(roots, id, rev, "editor");
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const createDesign = createRoute({
    method: "post",
    path: "/api/designs",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().optional(),
              canvas_json: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: { 200: { content: { "application/json": { schema: DesignSchema } }, description: "OK" } },
  });
  app.openapi(createDesign, (c) => {
    const body = c.req.valid("json");
    return c.json(store.createDesign(roots, body), 200);
  });

  const updateDesign = createRoute({
    method: "put",
    path: "/api/designs/{id}",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().optional(),
              canvas_json: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              thumbnail_url: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { content: { "application/json": { schema: DesignSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(updateDesign, (c) => {
    const { id } = c.req.valid("param");
    const row = store.updateDesign(roots, id, c.req.valid("json"));
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  app.post("/api/designs/:id/thumbnail", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { image?: unknown } | null;
    const image = typeof body?.image === "string" ? body.image : "";
    const parsed = imageBytesFromDataUrl(image);
    if (!parsed) return c.json({ error: "Expected a PNG or JPEG data URL" }, 400);
    if (parsed.bytes.length > 4 * 1024 * 1024) return c.json({ error: "Thumbnail too large" }, 413);
    const uploaded = putUploadKey(roots, `uploads/thumbs/${id}.${parsed.ext}`, parsed.bytes);
    const row = store.setDesignThumbnail(roots, id, uploaded.url);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const duplicateDesign = createRoute({
    method: "post",
    path: "/api/designs/{id}/duplicate",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: DesignWithPagesSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(duplicateDesign, (c) => {
    const { id } = c.req.valid("param");
    const row = store.duplicateDesign(roots, id);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  const deleteDesign = createRoute({
    method: "delete",
    path: "/api/designs/{id}",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "OK" } },
  });
  app.openapi(deleteDesign, (c) => {
    const { id } = c.req.valid("param");
    store.deleteDesign(roots, id);
    return c.json({ ok: true }, 200);
  });

  const addPage = createRoute({
    method: "post",
    path: "/api/designs/{id}/pages",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string().optional(),
              canvas_json: z.string().optional(),
              after_sort_order: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { content: { "application/json": { schema: PageSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(addPage, (c) => {
    const { id } = c.req.valid("param");
    const page = store.addPage(roots, id, c.req.valid("json"));
    if (!page) return c.json({ error: "Not found" }, 404);
    return c.json(page, 200);
  });

  const duplicatePage = createRoute({
    method: "post",
    path: "/api/pages/{pageId}/duplicate",
    request: { params: z.object({ pageId: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: PageSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(duplicatePage, (c) => {
    const { pageId } = c.req.valid("param");
    const page = store.duplicatePage(roots, pageId);
    if (!page) return c.json({ error: "Not found" }, 404);
    return c.json(page, 200);
  });

  const updatePage = createRoute({
    method: "put",
    path: "/api/pages/{pageId}",
    request: {
      params: z.object({ pageId: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string().optional(),
              canvas_json: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { content: { "application/json": { schema: PageSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(updatePage, (c) => {
    const { pageId } = c.req.valid("param");
    const page = store.updatePage(roots, pageId, c.req.valid("json"));
    if (!page) return c.json({ error: "Not found" }, 404);
    return c.json(page, 200);
  });

  const deletePage = createRoute({
    method: "delete",
    path: "/api/pages/{pageId}",
    request: { params: z.object({ pageId: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "OK" },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Cannot delete last page" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(deletePage, (c) => {
    const { pageId } = c.req.valid("param");
    const result = store.deletePage(roots, pageId);
    if ("error" in result) {
      if (result.status === 400) return c.json({ error: result.error }, 400);
      return c.json({ error: result.error }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  const listTemplates = createRoute({
    method: "get",
    path: "/api/templates",
    responses: { 200: { content: { "application/json": { schema: z.array(TemplateSchema) } }, description: "OK" } },
  });
  app.openapi(listTemplates, (c) => c.json(store.listTemplates(roots), 200));

  const getTemplate = createRoute({
    method: "get",
    path: "/api/templates/{id}",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: TemplateSchema } }, description: "OK" },
      404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    },
  });
  app.openapi(getTemplate, (c) => {
    const { id } = c.req.valid("param");
    const row = store.getTemplate(roots, id);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(row, 200);
  });

  app.post("/api/export/png", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; image?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "design";
    const image = typeof body?.image === "string" ? body.image : "";
    const bytes = pngBytesFromDataUrl(image);
    if (!bytes) return c.json({ error: "Expected a PNG data URL" }, 400);
    if (bytes.length > 25 * 1024 * 1024) return c.json({ error: "PNG too large" }, 413);
    return c.json(writeProjectDesignPng(roots, name, bytes), 200);
  });

  app.post("/api/export/app-screenshot", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { image?: unknown } | null;
    const image = typeof body?.image === "string" ? body.image : "";
    const bytes = pngBytesFromDataUrl(image);
    if (!bytes) return c.json({ error: "Expected a PNG data URL" }, 400);
    if (bytes.length > 25 * 1024 * 1024) return c.json({ error: "PNG too large" }, 413);
    return c.json(writeDocsAssetScreenshot(roots, bytes), 200);
  });

  app.get("/api/uploads", (c) => {
    const kind = uploadKindFromQuery(c.req.query("kind"));
    return c.json({ items: listUploads(roots, kind) }, 200);
  });

  app.get("/api/icons/search", async (c) => {
    const q = (c.req.query("q") || "").trim();
    if (q.length < 2) return c.json({ icons: [], total: 0, limit: 32, start: 0 }, 200);
    const limit = Math.min(64, Math.max(1, Number(c.req.query("limit")) || 32));
    const start = Math.max(0, Number(c.req.query("start")) || 0);
    const result = await searchIconify(q, limit, start);
    if ("error" in result) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return c.json(result, 200);
  });

  app.post("/api/icons/preview", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
    const svgs = await fetchIconifySvgs(ids);
    return c.json({ svgs }, 200);
  });

  app.get("/api/icons/svg", async (c) => {
    const parsed = parseIconId(String(c.req.query("id") || ""));
    if (!parsed) return c.json({ error: "Invalid icon id" }, 400);
    const svg = await fetchIconifySvg(parsed.prefix, parsed.name);
    if (!svg) return c.json({ error: "Icon not found" }, 404);
    return c.body(svg, 200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    });
  });

  app.post("/api/icons/download", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: string };
    const parsed = parseIconId(String(body.id || ""));
    if (!parsed) return c.json({ error: "Invalid icon id" }, 400);
    const svg = await fetchIconifySvg(parsed.prefix, parsed.name);
    if (!svg) return c.json({ error: "Icon not found" }, 404);
    const filename = iconFilename(parsed.prefix, parsed.name);
    const item = putUpload(roots, "icons", filename, new TextEncoder().encode(svg), "image/svg+xml", "global");
    return c.json({ ...item, id: `${parsed.prefix}:${parsed.name}`, svg }, 200);
  });

  app.post("/api/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || typeof file === "string") return c.json({ error: "No file provided" }, 400);
    const ext = file.name?.split(".").pop()?.toLowerCase() || "png";
    const allowed = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
    if (!allowed.has(ext)) return c.json({ error: "Unsupported file type" }, 400);
    const kind: UploadKind =
      body["kind"] === "backgrounds"
        ? "backgrounds"
        : body["kind"] === "icons"
          ? "icons"
          : body["kind"] === "screenshots"
            ? "screenshots"
            : "images";
    const requestedKey = typeof body["key"] === "string" ? body["key"].trim() : "";
    const requestedName = typeof body["filename"] === "string" ? body["filename"].trim() : "";
    const filename = requestedName || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const data = await file.arrayBuffer();
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
    if (requestedKey.startsWith("uploads/")) {
      try {
        return c.json(putUploadKey(roots, requestedKey, data, "project"), 200);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Invalid upload key" }, 400);
      }
    }
    return c.json(putUpload(roots, kind, filename, data, mime, "project"), 200);
  });

  app.get("/api/uploads/file/*", (c) => {
    const key = c.req.path.replace(/^\/api\/uploads\/file\//, "");
    const result = getUpload(roots, key);
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.body(new Uint8Array(result.data), 200, {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=31536000",
      "Access-Control-Allow-Origin": "*",
    });
  });

  app.delete("/api/uploads/file/*", (c) => {
    const key = c.req.path.replace(/^\/api\/uploads\/file\//, "");
    try {
      deleteUpload(roots, key);
    } catch {
      return c.json({ error: "Invalid key" }, 400);
    }
    return c.json({ ok: true }, 200);
  });

  app.get("/api/elements", (c) => c.json(store.listElements(roots), 200));

  app.post("/api/elements", async (c) => {
    const body = await c.req.json<{ name?: string; canvas_json?: string; width?: number; height?: number }>();
    if (!body?.canvas_json) return c.json({ error: "Missing canvas_json" }, 400);
    return c.json(store.createElement(roots, { ...body, canvas_json: body.canvas_json }), 200);
  });

  app.delete("/api/elements/:id", (c) => {
    store.deleteElement(roots, c.req.param("id"));
    return c.json({ ok: true }, 200);
  });

  app.get("/api/design/journal", (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") || 80)));
    return c.json({ entries: readDesignJournal(roots, limit) }, 200);
  });

  app.post("/api/design/journal", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "Invalid body" }, 400);
    const entry = appendDesignJournal(roots, body as Parameters<typeof appendDesignJournal>[1]);
    return c.json({ ok: true, id: entry.id, ts: entry.ts }, 200);
  });

  app.doc("/api/openapi.json", {
    openapi: "3.0.0",
    info: { title: "OpenDesign API", version: "1.0.0" },
  });

  return app;
}
