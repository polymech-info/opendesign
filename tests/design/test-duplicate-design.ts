import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import * as store from "../../src/server/store.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-dup-"));

try {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const created = store.createDesign(roots, { name: "Poster", width: 1920, height: 1080 });
  store.addPage(roots, created.id, { title: "Page 2", canvas_json: '{"objects":[]}' });
  const src = store.getDesign(roots, created.id);
  assert.equal(src?.pages.length, 2);

  const copy = store.duplicateDesign(roots, created.id);
  assert.ok(copy);
  assert.notEqual(copy.id, created.id);
  assert.equal(copy.name, "Poster (copy)");
  assert.equal(copy.width, 1920);
  assert.equal(copy.height, 1080);
  assert.equal(copy.pages.length, 2);
  assert.equal(copy.pages[1]?.title, "Page 2");
  assert.notEqual(copy.pages[0]?.id, src?.pages[0]?.id);
  assert.equal(copy.pages[0]?.design_id, copy.id);
  assert.equal(store.listDesigns(roots).length, 2);
  assert.equal(store.duplicateDesign(roots, "missing"), null);

  console.log("test:duplicate-design PASS");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
