import assert from "node:assert/strict";
import * as fabric from "fabric";

import { designSelectionIds } from "../../src/client/lib/design-selection.ts";
import { applyDesignStylesToCanvas, syncDesignNodesToCanvas } from "../../src/client/lib/design-style-sync.ts";
import { applyStylePreset, readStylePreset } from "../../src/client/lib/style-presets.ts";
import { syncObjectStyleInIr } from "../../src/client/lib/design-ir-sync.ts";
import {
  buildFeatureCardsDocument,
  designChatBrief,
  dispatchDesignTool,
  fabricJsonHasGroups,
  findNode,
  getActiveDocument,
  projectToFabricJSON,
  setActiveDocument,
  writeCliCanvasJson,
  type DesignDocument,
} from "../../src/design/index.ts";

const bg = new fabric.Rect({
  left: 0,
  top: 0,
  width: 420,
  height: 220,
  fill: "#ffffff",
});
(bg as fabric.Rect & { _id?: string })._id = "feature.chat.bg";

// A Rect is sufficient here: the regression concerns identity/parent links,
// and avoids requiring a browser text-measurement DOM in this Node test.
const title = new fabric.Rect({
  left: 108,
  top: 24,
  width: 280,
  height: 38,
  fill: "#111827",
});
(title as fabric.Rect & { _id?: string })._id = "feature.chat.title";

const group = new fabric.Group([bg, title], {
  left: 80,
  top: 80,
  originX: "left",
  originY: "top",
});
(group as fabric.Group & { _id?: string })._id = "group_1";

let renderRequests = 0;
const canvas = {
  getObjects: () => [group],
  requestRenderAll: () => {
    renderRequests += 1;
  },
} as unknown as fabric.Canvas;

const doc = buildFeatureCardsDocument();
assert.deepEqual(
  designSelectionIds(group, doc),
  ["feature.chat"],
  "a Fabric wrapper group must resolve to its stable DSL use ID",
);
const brief = designChatBrief(doc, { selectionIds: designSelectionIds(group, doc) });
assert.match(brief, /SELECTION: feature\.chat/);
assert.match(brief, /align\/line up a card means geometry/);
assert.match(brief, /Never broaden it to where=type=txt/);

const moved = dispatchDesignTool(
  "design_update",
  { patches: [{ id: "feature.chat", set: { x: 640, y: 96 } }] },
  doc,
) as { ok?: boolean };
assert.equal(moved.ok, true);

const childrenBefore = group.getObjects().slice();
const bgLocalBefore = { left: bg.left, top: bg.top };
const titleLocalBefore = { left: title.left, top: title.top };
assert.equal(await syncDesignNodesToCanvas(canvas, doc, ["feature.chat"]), true);

assert.equal(group.left, 640);
assert.equal(group.top, 96);
assert.deepEqual(group.getObjects(), childrenBefore, "move must not replace or ungroup children");
assert.equal(bg.group, group);
assert.equal(title.group, group);
assert.deepEqual({ left: bg.left, top: bg.top }, bgLocalBefore, "group move keeps child-local frame");
assert.deepEqual(
  { left: title.left, top: title.top },
  titleLocalBefore,
  "group move keeps child-local text frame",
);

const styled = dispatchDesignTool(
  "design_update",
  { patches: [{ id: "feature.chat.title", set: { fill: "#38bdf8" } }] },
  doc,
) as { ok?: boolean };
assert.equal(styled.ok, true);
assert.equal(await syncDesignNodesToCanvas(canvas, doc, ["feature.chat.title"]), true);

assert.equal(title.fill, "#38bdf8");
assert.equal(title.group, group);
assert.deepEqual(group.getObjects(), childrenBefore, "style edit must preserve the group");

(title as fabric.Rect & { text?: string }).text = "Chat e IA";
const translated = dispatchDesignTool(
  "design_update",
  { patches: [{ id: "feature.chat.title", set: { text: "Chat & AI" } }] },
  doc,
) as { ok?: boolean; changed?: number };
assert.equal(translated.ok, true);
assert.equal(await syncDesignNodesToCanvas(canvas, doc, ["feature.chat.title"]), true);
assert.equal((title as fabric.Rect & { text?: string }).text, "Chat & AI");
assert.equal(title.group, group);
assert.deepEqual({ left: title.left, top: title.top }, titleLocalBefore, "grouped copy edit keeps child-local frame");
assert.equal(findNode(doc, "feature.chat")?.bounds.x, 640);
assert.ok(renderRequests >= 2);

const themed = dispatchDesignTool(
  "design_update",
  {
    patches: [
      {
        id: "feature.chat.bg",
        set: { fill: "#FFFFFFE8", stroke: "#DCE5F0", strokeWidth: 1, glass: true },
      },
    ],
  },
  doc,
) as { ok?: boolean };
assert.equal(themed.ok, true);
applyStylePreset(bg, "glass");
assert.equal(bg.fill, "#ffffff", "enabling glass must not replace the authored fill");
assert.equal(applyDesignStylesToCanvas(canvas, doc, ["feature.chat.bg"]), 1);
assert.equal(bg.fill, "#FFFFFFE8", "save/load style sync writes the IR fill onto the live object");
assert.equal(bg.stroke, "#DCE5F0");
assert.equal(readStylePreset(bg), "glass");

setActiveDocument(doc);
bg.set({ fill: "#F8FAFC" });
syncObjectStyleInIr(bg);
assert.equal(findNode(getActiveDocument()!, "feature.chat.bg")?.props.fill, "#F8FAFC");
assert.equal(bg.fill, "#F8FAFC", "IR sync must not rewrite the live object");
setActiveDocument(null);

function wrapUseInstancesAsGroups(source: DesignDocument): string {
  const flat = JSON.parse(projectToFabricJSON(source)) as {
    objects: Array<Record<string, unknown> & { _id?: string; objects?: unknown[] }>;
  };
  const byId = new Map(flat.objects.map((o) => [String(o._id ?? ""), o]));
  const used = new Set<string>();
  const objects: Array<Record<string, unknown>> = [];
  for (const obj of flat.objects) {
    if (obj._id === "canvas.bg" || obj._id === "canvas.photo") objects.push(obj);
  }
  for (const inst of source.nodes.filter((n) => n.type === "use")) {
    const kids = source.nodes
      .filter((n) => n.parentId === inst.id)
      .map((n) => byId.get(n.id))
      .filter((o): o is Record<string, unknown> & { _id?: string } => !!o);
    if (!kids.length) continue;
    for (const kid of kids) used.add(String(kid._id ?? ""));
    objects.push({
      type: "Group",
      originX: "left",
      originY: "top",
      left: inst.bounds.x,
      top: inst.bounds.y,
      _id: `group.${inst.id}`,
      _isElementGroup: true,
      objects: kids.map((kid) => ({
        ...kid,
        left: Number(kid.left ?? 0) - inst.bounds.x,
        top: Number(kid.top ?? 0) - inst.bounds.y,
      })),
    });
  }
  for (const obj of flat.objects) {
    const id = String(obj._id ?? "");
    if (!id || used.has(id) || id === "canvas.bg" || id === "canvas.photo") continue;
    objects.push(obj);
  }
  return JSON.stringify({ ...flat, objects });
}

const groupedDoc = buildFeatureCardsDocument();
const groupedJson = wrapUseInstancesAsGroups(groupedDoc);
assert.equal(fabricJsonHasGroups(groupedJson), true);

const redTitles = dispatchDesignTool(
  "design_update",
  { where: "role=title", set: { fill: "#EF4444" } },
  groupedDoc,
) as { ok?: boolean; touched?: string[] };
assert.equal(redTitles.ok, true);
assert.ok((redTitles.touched?.length ?? 0) >= 3);

const saved = JSON.parse(writeCliCanvasJson(groupedJson, groupedDoc, { source: "cli-prompt" })) as {
  objects: Array<Record<string, unknown> & { objects?: Array<Record<string, unknown>>; fill?: string; left?: number; top?: number; _id?: string }>;
  _designSource?: string;
};
assert.equal(saved._designSource, "cli-prompt");
const groups = saved.objects.filter((o) => String(o.type).toLowerCase() === "group");
assert.equal(groups.length, groupedDoc.nodes.filter((n) => n.type === "use").length, "CLI style save must keep card groups");

const chatGroup = groups.find((g) => g._id === "group.feature.chat");
assert.ok(chatGroup);
const groupedTitle = (chatGroup.objects ?? []).find((o) => o._id === "feature.chat.title");
assert.ok(groupedTitle);
assert.equal(groupedTitle.fill, "#EF4444");
assert.equal(groupedTitle.left, 108, "grouped title must keep child-local x");
assert.equal(groupedTitle.top, 24, "grouped title must keep child-local y");
assert.equal(
  saved.objects.some((o) => o._id === "feature.chat.title"),
  false,
  "title must stay inside the group, not explode to the canvas root",
);

console.log("test:grouped-edit PASS");
