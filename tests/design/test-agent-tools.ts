import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  agentToolContextPrompt,
  applyHostMediaResult,
  callHostTool,
  hostToolCatalog,
  putAgentToolSession,
} from "../../src/server/agent-tools.ts";
import { canvasFromDsl, documentToCanvasJson } from "../../src/mcp/session.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import * as store from "../../src/server/store.ts";
import { designChatBrief, parseDsl } from "../../src/design/index.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-agent-tools-"));

try {
  const catalog = hostToolCatalog();
  assert.equal(catalog.id, "opendesign");
  const names = catalog.tools.map((t) => t.name);
  assert.ok(names.includes("design_query"));
  assert.ok(names.includes("design_update"));
  assert.ok(names.includes("design_search_icons"));
  assert.ok(names.includes("design_screenshot"));
  assert.ok(!names.includes("design_export"));

  const brief = designChatBrief(parseDsl("canvas main 800 600\ntxt hero.title role=title x=40 y=40 w=200 h=40 text=Hello"));
  assert.match(brief, /native tools/);
  assert.doesNotMatch(brief, /emit JSON below/);
  assert.doesNotMatch(brief, /emit compact JSON tool calls/);

  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const parsed = canvasFromDsl(
    "canvas main 800 600\ntheme tanit-light\ntxt hero.title role=title x=40 y=40 w=400 h=60 text=Hello",
  );
  assert.ok(!("error" in parsed));
  const created = store.createDesign(roots, {
    name: "Agent Card",
    canvas_json: documentToCanvasJson(parsed, "test"),
    width: 800,
    height: 600,
  });

  putAgentToolSession({
    design: created.id,
    page: 1,
    selectionIds: ["hero.title"],
    projectRoot: roots.project,
  });

  const context = agentToolContextPrompt(cwd);
  assert.match(context, /Agent Card/);
  assert.match(context, /hero\.title/);
  assert.match(context, /Never say there is no UI|editor is connected/);

  const queried = await callHostTool(cwd, {
    name: "design_query",
    arguments: { query: "type=txt role=title", fields: ["id", "text"] },
  });
  assert.equal(queried.ok, true);
  const items = queried.result as Array<{ id: string; text: string }>;
  assert.equal(items[0]?.text, "Hello");

  const updated = await callHostTool(cwd, {
    name: "design_update",
    arguments: { where: "id=hero.title", set: { text: "Hola" } },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.saved, true);
  assert.equal(updated.document_id, created.id);
  assert.ok(updated.revision_after);

  const after = store.getDesign(roots, created.id);
  assert.equal(after?.updated_by, "cli");
  const reread = await callHostTool(cwd, {
    name: "design_query",
    arguments: { query: "id=hero.title", fields: ["id", "text"] },
  });
  const again = reread.result as Array<{ text: string }>;
  assert.equal(again[0]?.text, "Hola");

  const pictured = canvasFromDsl(
    "canvas main 800 600\nimg image_5 x=0 y=0 w=400 h=300 src=uploads/1789221162061_ak61sk.png",
  );
  assert.ok(!("error" in pictured));
  const photo = store.createDesign(roots, {
    name: "Photo Card",
    canvas_json: documentToCanvasJson(pictured, "test"),
    width: 800,
    height: 600,
  });
  putAgentToolSession({
    design: photo.id,
    page: 1,
    selectionIds: ["image_5"],
    projectRoot: roots.project,
  });
  const applied = applyHostMediaResult(cwd, {
    name: "image_transform",
    arguments: {
      paths: [`${roots.project}/uploads/1789221162061_ak61sk.png`],
    },
    result: {
      ok: true,
      results: [{ ok: true, output_path: `${roots.project}/uploads/1789221162061_ak61sk_red.png` }],
    },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  assert.equal(applied.tool, "design_update");
  assert.equal(applied.saved, true);
  const afterPhoto = await callHostTool(cwd, {
    name: "design_query",
    arguments: { query: "id=image_5", fields: ["id", "src"] },
  });
  const src = (afterPhoto.result as Array<{ src?: string }>)[0]?.src ?? "";
  assert.match(src, /1789221162061_ak61sk_red/);

  const missingShot = await callHostTool(cwd, { name: "design_screenshot", arguments: {} });
  assert.equal(missingShot.ok, false);
  putAgentToolSession({
    design: photo.id,
    page: 1,
    screenshotPath: `${roots.project}/uploads/screenshots/canvas.jpg`,
  });
  const shot = await callHostTool(cwd, { name: "design_screenshot", arguments: {} });
  assert.equal(shot.ok, true);
  assert.match(String((shot.result as { path?: string }).path), /canvas\.jpg/);

  const blank = store.createDesign(roots, {
    name: "Empty Board",
    canvas_json: "{}",
    width: 1920,
    height: 1080,
  });
  putAgentToolSession({ design: blank.id, page: 1 });
  const emptyCtx = agentToolContextPrompt(cwd);
  assert.match(emptyCtx, /Empty Board/);
  assert.match(emptyCtx, /empty SCENE is still the live canvas/i);
  assert.doesNotMatch(emptyCtx, /no Design DSL/i);
  const emptyQuery = await callHostTool(cwd, {
    name: "design_query",
    arguments: { query: "type=txt", limit: 20 },
  });
  assert.equal(emptyQuery.ok, true);
  assert.ok(Array.isArray(emptyQuery.result));
  assert.equal((emptyQuery.result as unknown[]).length, 0);

  const used = await callHostTool(cwd, {
    name: "design_use_widget",
    arguments: {
      widget: "feature-group",
      id: "feature.one",
      x: 80,
      y: 120,
      bindings: { icon: "star", title: "Fast and simple", caption: "Cap", body: "Everything you need." },
    },
  });
  assert.equal(used.ok, true);
  assert.equal(used.saved, true);
  const usedTitle = await callHostTool(cwd, {
    name: "design_query",
    arguments: { query: "id=feature.one.title", fields: ["id", "text"] },
  });
  assert.equal((usedTitle.result as Array<{ text?: string }>)[0]?.text, "Fast and simple");

  const blank2 = store.createDesign(roots, {
    name: "Empty Create",
    canvas_json: "{}",
    width: 1920,
    height: 1080,
  });
  putAgentToolSession({ design: blank2.id, page: 1 });
  const made = await callHostTool(cwd, {
    name: "design_create",
    arguments: {
      objects: [
        { type: "rect", id: "card1", x: 80, y: 120, w: 240, h: 180, fill: "#FFFFFF", radius: 16 },
        { type: "icon", id: "card1-icon", x: 104, y: 144, w: 32, h: 32, icon: "star" },
        { type: "txt", id: "card1-title", x: 104, y: 192, w: 200, h: 32, text: "Fast" },
      ],
    },
  });
  assert.equal(made.ok, true);
  assert.equal(made.saved, true);
  const createdIds = (made.result as { created?: string[] }).created ?? [];
  assert.ok(createdIds.includes("card1") && createdIds.includes("card1-icon") && createdIds.includes("card1-title"));
  const cardTitle = await callHostTool(cwd, {
    name: "design_query",
    arguments: { query: "id=card1-title", fields: ["id", "text"] },
  });
  assert.equal((cardTitle.result as Array<{ text?: string }>)[0]?.text, "Fast");

  putAgentToolSession({
    design: "does-not-exist",
    selectionIds: ["img.a", "img.b", "img.c"],
    selectionCount: 3,
  });
  const missing = agentToolContextPrompt(cwd);
  assert.match(missing, /editor is connected/i);
  assert.match(missing, /img\.a/);
  assert.doesNotMatch(missing, /no active UI/i);

  console.log("test:agent-tools PASS");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
