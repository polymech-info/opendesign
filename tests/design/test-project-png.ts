import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { nextProjectPngName, pngBytesFromDataUrl, pngFileSlug } from "../../src/server/project-png.ts";

assert.equal(pngFileSlug("Store Chat"), "store-chat");
assert.equal(pngFileSlug("  "), "design");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opend-png-"));
try {
  assert.equal(nextProjectPngName(dir, "Store Chat"), "store-chat_1.png");
  fs.writeFileSync(path.join(dir, "store-chat_1.png"), "");
  fs.writeFileSync(path.join(dir, "store-chat_3.png"), "");
  assert.equal(nextProjectPngName(dir, "Store Chat"), "store-chat_4.png");
  assert.equal(pngBytesFromDataUrl("not-a-png"), null);
  console.log("test:project-png PASS");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
