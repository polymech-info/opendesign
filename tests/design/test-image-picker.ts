import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bumpRecentUrls } from "../../src/client/lib/recent-uploads.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import { listUploads, putUpload } from "../../src/server/uploads.ts";

assert.deepEqual(bumpRecentUrls(["a", "b", "c"], "b"), ["b", "a", "c"]);
assert.deepEqual(bumpRecentUrls(["a"], "z", 2), ["z", "a"]);
assert.equal(bumpRecentUrls(["a", "b"], "c", 2).length, 2);
assert.equal(bumpRecentUrls(["a", "b"], "c", 2)[0], "c");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-uploads-"));
try {
  const roots = resolveRoots(cwd);
  ensureLayouts(roots);
  const older = putUpload(roots, "images", "old.png", new Uint8Array([0x89, 0x50]), "image/png");
  const newer = putUpload(roots, "images", "new.png", new Uint8Array([0x89, 0x50]), "image/png");
  const oldFile = path.join(roots.project, older.key);
  const newFile = path.join(roots.project, newer.key);
  const past = new Date("2024-01-01T00:00:00Z");
  const now = new Date("2026-09-14T00:00:00Z");
  fs.utimesSync(oldFile, past, past);
  fs.utimesSync(newFile, now, now);

  const items = listUploads(roots, "images");
  assert.equal(items.length, 2);
  assert.equal(items[0]?.filename, "new.png");
  assert.equal(items[1]?.filename, "old.png");
  assert.ok((items[0]?.mtime ?? 0) >= (items[1]?.mtime ?? 0));
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
