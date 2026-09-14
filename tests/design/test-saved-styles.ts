import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as fabric from "fabric";

import {
  applyObjectStyle,
  captureObjectStyle,
  hydrateCopiedStyle,
  serializeCopiedStyle,
  styleSwatchCss,
} from "../../src/client/lib/object-style.ts";
import { applyStylePreset, readStylePreset } from "../../src/client/lib/style-presets.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import * as store from "../../src/server/store.ts";

const source = new fabric.Rect({
  width: 120,
  height: 80,
  fill: "#38bdf8",
  stroke: "#0f172a",
  strokeWidth: 2,
  opacity: 0.85,
});
applyStylePreset(source, "border");
const copied = captureObjectStyle(source);
copied.borderOptions = { kind: "line", width: 3, opacity: 0.6, color: "#f97316" };

const raw = serializeCopiedStyle(copied);
assert.equal(raw.fill, "#38bdf8");
assert.equal(raw.stylePreset, "border");
assert.equal(styleSwatchCss(copied).includes("linear-gradient"), true);

const hydrated = hydrateCopiedStyle(raw);
assert.ok(hydrated);
assert.equal(hydrated.fill, "#38bdf8");
assert.equal(hydrated.opacity, 0.85);
assert.equal(hydrated.stylePreset, "border");
assert.equal(hydrated.borderOptions.kind, "line");
assert.equal(hydrated.borderOptions.width, 3);
assert.equal(hydrated.glassOptions.opacity, 1);

const target = new fabric.Rect({ width: 40, height: 20, fill: "#fff" });
applyObjectStyle(target, hydrated);
assert.equal(readStylePreset(target), "border");
assert.equal(captureObjectStyle(target).borderOptions.color, "#f97316");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-styles-"));
try {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const created = store.createStyle(roots, {
    name: "Sky card",
    swatch: styleSwatchCss(copied),
    style: raw as Record<string, unknown>,
  });
  assert.match(created.id, /^s_/);
  assert.equal(created.name, "Sky card");
  assert.equal(created.source, "project");
  const file = path.join(roots.project, "styles", `${created.id}.json`);
  assert.ok(fs.existsSync(file), "style is stored under .OpenDesign/styles");

  const listed = store.listStyles(roots);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, created.id);

  const renamed = store.updateStyle(roots, created.id, { name: "Hero" });
  assert.equal(renamed?.name, "Hero");
  assert.equal(store.listStyles(roots)[0]?.name, "Hero");

  assert.equal(store.deleteStyle(roots, created.id), true);
  assert.equal(store.listStyles(roots).length, 0);
  assert.equal(fs.existsSync(file), false);
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
