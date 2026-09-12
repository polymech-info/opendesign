import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCliPrompt } from "../../src/cli-prompt.ts";
import {
  buildFeatureCardsDocument,
  documentFromCanvasJson,
  fabricJsonHasGroups,
  findNode,
  projectToFabricJSON,
} from "../../src/design/index.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import * as store from "../../src/server/store.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-cli-prompt-"));

try {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const seed = buildFeatureCardsDocument();
  const created = store.createDesign(roots, {
    name: "CLI Prompt Fixture",
    width: seed.canvas.width,
    height: seed.canvas.height,
    canvas_json: projectToFabricJSON(seed),
  });

  const replies = [
    '{"tool_calls":[{"name":"design_update","arguments":{"patches":[{"id":"feature.chat","set":{"x":640,"y":96}}]}},{"name":"done","arguments":{}}]}',
  ];
  const result = await runCliPrompt({
    cwd,
    query: created.id,
    prompt: "Move feature.chat to x 640 y 96.",
    page: 1,
    model: "mock",
    maxRounds: 4,
    llm: { url: "http://127.0.0.1:1", key: "", cwd: roots.project },
    complete: async () => replies.shift() ?? '{"name":"done","arguments":{}}',
    log: () => {},
  });

  assert.equal(result.saved, true);
  assert.equal(result.calls[0]?.name, "design_update");
  const saved = store.getDesign(roots, created.id);
  assert.ok(saved?.pages[0]);
  const doc = documentFromCanvasJson(saved.pages[0].canvas_json);
  assert.equal(findNode(doc!, "feature.chat")?.bounds.x, 640);
  assert.equal(findNode(doc!, "feature.chat")?.bounds.y, 96);
  assert.equal(documentFromCanvasJson(saved.canvas_json)?.nodes.find((n) => n.id === "feature.chat")?.bounds.x, 640);

  const beforeDryRun = saved.pages[0].canvas_json;
  const dryReplies = [
    '{"tool_calls":[{"name":"design_update","arguments":{"patches":[{"id":"feature.chat","set":{"x":800}}]}},{"name":"done","arguments":{}}]}',
  ];
  const dry = await runCliPrompt({
    cwd,
    query: created.id,
    prompt: "Move feature.chat to x 800.",
    page: 1,
    model: "mock",
    maxRounds: 4,
    dryRun: true,
    llm: { url: "http://127.0.0.1:1", key: "", cwd: roots.project },
    complete: async () => dryReplies.shift() ?? '{"name":"done","arguments":{}}',
    log: () => {},
  });
  assert.equal(dry.saved, false);
  assert.equal(store.getDesign(roots, created.id)?.pages[0].canvas_json, beforeDryRun);

  const groupSeed = buildFeatureCardsDocument();
  const projected = JSON.parse(projectToFabricJSON(groupSeed)) as {
    objects: Array<Record<string, unknown> & { _id?: string }>;
  };
  const byId = new Map(projected.objects.map((o) => [String(o._id ?? ""), o]));
  const inst = groupSeed.nodes.find((n) => n.id === "feature.chat")!;
  const kids = groupSeed.nodes
    .filter((n) => n.parentId === "feature.chat")
    .map((n) => byId.get(n.id))
    .filter((o): o is Record<string, unknown> & { _id?: string } => !!o);
  const groupedPage = JSON.stringify({
    ...projected,
    objects: [
      ...projected.objects.filter((o) => o._id === "canvas.bg" || o._id === "canvas.photo"),
      {
        type: "Group",
        originX: "left",
        originY: "top",
        left: inst.bounds.x,
        top: inst.bounds.y,
        _id: "group.feature.chat",
        _isElementGroup: true,
        objects: kids.map((kid) => ({
          ...kid,
          left: Number(kid.left ?? 0) - inst.bounds.x,
          top: Number(kid.top ?? 0) - inst.bounds.y,
        })),
      },
      ...projected.objects.filter((o) => {
        const id = String(o._id ?? "");
        return id && id !== "canvas.bg" && id !== "canvas.photo" && !kids.some((k) => k._id === id);
      }),
    ],
  });
  const grouped = store.createDesign(roots, {
    name: "CLI Grouped Cards",
    width: groupSeed.canvas.width,
    height: groupSeed.canvas.height,
    canvas_json: groupedPage,
  });
  const styleReplies = [
    '{"tool_calls":[{"name":"design_update","arguments":{"where":"role=title","set":{"fill":"#EF4444"}}},{"name":"done","arguments":{}}]}',
  ];
  const styled = await runCliPrompt({
    cwd,
    query: grouped.id,
    prompt: "Make all card titles red",
    page: 1,
    model: "mock",
    maxRounds: 4,
    llm: { url: "http://127.0.0.1:1", key: "", cwd: roots.project },
    complete: async () => styleReplies.shift() ?? '{"name":"done","arguments":{}}',
    log: () => {},
  });
  assert.equal(styled.saved, true);
  const styledPage = store.getDesign(roots, grouped.id)?.pages[0].canvas_json ?? "";
  assert.equal(fabricJsonHasGroups(styledPage), true, "CLI title fill must not flatten Fabric groups");
  const styledCanvas = JSON.parse(styledPage) as {
    objects: Array<{ type?: string; _id?: string; objects?: Array<{ _id?: string; fill?: string; left?: number }> }>;
  };
  const chatGroup = styledCanvas.objects.find((o) => o._id === "group.feature.chat");
  const title = chatGroup?.objects?.find((o) => o._id === "feature.chat.title");
  assert.equal(title?.fill, "#EF4444");
  assert.equal(title?.left, 108);

  console.log("test:cli-prompt PASS");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
