import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { designDslMarkdown, exportDslMarkdown, queryDesignDsl } from "../../src/cli-dsl.ts";
import { buildFeatureCardsDocument, projectToFabricJSON } from "../../src/design/index.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import { loadProjectGuides } from "../../src/server/project-guides.ts";
import * as store from "../../src/server/store.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-cli-dsl-"));

try {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const guides = loadProjectGuides(cwd);
  assert.match(String(guides.styleGuide), /1920/);
  assert.match(String(guides.skill), /Store Chat/);
  assert.ok(fs.existsSync(path.join(roots.project, "style_guide.md")));
  assert.ok(fs.existsSync(path.join(roots.project, "SKILL.md")));
  const doc = buildFeatureCardsDocument();
  const design = store.createDesign(roots, {
    name: "DSL CLI Fixture",
    width: doc.canvas.width,
    height: doc.canvas.height,
    canvas_json: projectToFabricJSON(doc),
  });

  const out = exportDslMarkdown({
    cwd,
    query: design.id,
    page: 1,
    out: "exports/fixture.md",
  });
  assert.equal(out, path.join(cwd, "exports", "fixture.md"));
  const markdown = fs.readFileSync(out, "utf8");
  assert.match(markdown, /^# DSL CLI Fixture — Page 1/m);
  assert.match(markdown, /````opendesign/);
  assert.match(markdown, /use feature-group as=feature\.chat/);
  assert.ok(markdown.endsWith("````\n"));

  const result = queryDesignDsl({
    cwd,
    designQuery: design.id,
    page: 1,
    query: "type=txt role=title",
    fields: ["id", "text", "x"],
    limit: 2,
  });
  assert.equal(result.count, 2);
  assert.deepEqual(Object.keys(result.items[0] ?? {}), ["id", "text", "x"]);
  assert.ok(result.items.every((item) => String(item.id).endsWith(".title")));

  assert.match(designDslMarkdown("Demo", 2, "canvas main 10 10\n"), /^# Demo — Page 2/);

  const page = store.getDesign(roots, design.id)?.pages[0];
  assert.ok(page);
  store.updatePage(roots, page.id, { canvas_json: projectToFabricJSON(doc) }, "cli");
  const rev = store.getDesignRevision(roots, design.id);
  assert.equal(rev?.updated_by, "cli");
  assert.ok(rev?.updated_at);

  console.log("test:cli-dsl PASS");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
