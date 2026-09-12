import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildFeatureCardsDocument, designNeedsThumbnail, projectToFabricJSON } from "../../src/design/index.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import * as store from "../../src/server/store.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-versions-"));

try {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const doc = buildFeatureCardsDocument();
  const created = store.createDesign(roots, {
    name: "Version Fixture",
    width: doc.canvas.width,
    height: doc.canvas.height,
    canvas_json: projectToFabricJSON(doc),
  });

  const auto1 = store.snapshotDesignVersion(roots, created.id, { kind: "auto" });
  assert.equal(auto1?.created, true);
  assert.equal(auto1?.version.rev, 1);
  assert.equal(auto1?.version.kind, "auto");
  assert.ok(fs.existsSync(path.join(roots.project, "designs", `${created.id}_1.json`)));

  const autoSame = store.snapshotDesignVersion(roots, created.id, { kind: "auto" });
  assert.equal(autoSame?.created, false);
  assert.equal(store.listVersions(roots, created.id).length, 1);

  store.updateDesign(roots, created.id, { name: "Renamed" });
  const auto2 = store.snapshotDesignVersion(roots, created.id, { kind: "auto" });
  assert.equal(auto2?.created, true);
  assert.equal(auto2?.version.rev, 2);

  const manual = store.snapshotDesignVersion(roots, created.id, {
    kind: "manual",
    title: "Red titles",
    description: "Make all card titles red",
  });
  assert.equal(manual?.created, true);
  assert.equal(manual?.version.rev, 3);
  assert.equal(manual?.version.title, "Red titles");
  assert.equal(manual?.version.description, "Make all card titles red");

  const designs = store.listDesigns(roots);
  assert.equal(designs.length, 1);
  assert.equal(designs[0]?.id, created.id);
  assert.equal(store.getDesign(roots, `${created.id}_1`), null);

  const page = store.getDesign(roots, created.id)?.pages[0];
  assert.ok(page);
  assert.equal(store.getPage(roots, page.id)?.design.id, created.id);

  assert.equal(store.removeDesignVersion(roots, created.id, 2), true);
  assert.deepEqual(
    store.listVersions(roots, created.id).map((row) => row.rev),
    [3, 1],
  );

  const restored = store.restoreVersion(roots, created.id, 1);
  assert.equal(restored?.name, "Version Fixture");
  assert.equal(store.getDesign(roots, created.id)?.name, "Version Fixture");

  const liveName = store.getDesign(roots, created.id)?.name;
  const written = store.writeVersion(roots, created.id, 1, {
    canvas_json: '{"version":"6.0.0","objects":[],"_probe":true}',
  });
  assert.ok(written);
  assert.match(written.canvas_json, /_probe/);
  assert.equal(store.getDesign(roots, created.id)?.name, liveName);
  assert.equal(store.getDesign(roots, created.id)?.canvas_json.includes("_probe"), false);
  assert.ok(store.readVersion(roots, created.id, 1)?.canvas_json.includes("_probe"));

  assert.equal(designNeedsThumbnail(created), true);
  const beforeThumb = store.getDesign(roots, created.id)!;
  const stamped = store.setDesignThumbnail(roots, created.id, "/api/uploads/file/uploads/thumbs/x.jpg");
  assert.equal(stamped?.thumbnail_url, "/api/uploads/file/uploads/thumbs/x.jpg");
  assert.equal(stamped?.thumbnail_at, beforeThumb.updated_at);
  assert.equal(stamped?.updated_at, beforeThumb.updated_at);
  assert.equal(designNeedsThumbnail(stamped!), false);
  store.updateDesign(roots, created.id, { name: "After thumb" });
  const afterEdit = store.getDesign(roots, created.id)!;
  assert.equal(designNeedsThumbnail(afterEdit), true);
  assert.notEqual(afterEdit.updated_at, afterEdit.thumbnail_at);

  store.deleteDesign(roots, created.id);
  assert.equal(fs.existsSync(path.join(roots.project, "designs", `${created.id}.json`)), false);
  assert.equal(fs.existsSync(path.join(roots.project, "designs", `${created.id}_1.json`)), false);
  assert.equal(fs.existsSync(path.join(roots.project, "designs", `${created.id}_3.json`)), false);
  assert.equal(store.listDesigns(roots).length, 0);

  console.log("test:design-versions PASS");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
