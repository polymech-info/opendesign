import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { nextProjectPngName, writeDocsAssetScreenshot } from "../../src/server/project-png.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opend-docs-shot-"));
assert.equal(nextProjectPngName(dir, "screenshot"), "screenshot_1.png");
fs.writeFileSync(path.join(dir, "screenshot_1.png"), "x");
fs.writeFileSync(path.join(dir, "screenshot_3.png"), "x");
assert.equal(nextProjectPngName(dir, "screenshot"), "screenshot_4.png");

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-cwd-"));
const written = writeDocsAssetScreenshot({ cwd, project: cwd, global: cwd }, png);
assert.equal(written.filename, "screenshot_1.png");
assert.equal(written.relative, "docs/assets/screenshot_1.png");
assert.ok(fs.existsSync(path.join(cwd, "docs", "assets", "screenshot_1.png")));

const second = writeDocsAssetScreenshot({ cwd, project: cwd, global: cwd }, png);
assert.equal(second.filename, "screenshot_2.png");

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(cwd, { recursive: true, force: true });
console.log("test:docs-screenshot PASS");
