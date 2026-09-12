import assert from "node:assert/strict";
import * as fabric from "fabric";

import { applyImageCornerRadius } from "../../src/client/lib/image-radius.ts";

const img = new fabric.FabricImage(null, {
  width: 1672,
  height: 941,
  originX: "left",
  originY: "top",
  left: 330,
  top: 590,
});
applyImageCornerRadius(img, 24);

const clip = img.clipPath as fabric.Rect;
assert.ok(clip, "rounded images must have a clip path");
assert.equal(clip.left, 0, "clip stays at object center — not +50% for left/top origin");
assert.equal(clip.top, 0, "clip stays at object center — not +50% for left/top origin");
assert.equal(clip.originX, "center");
assert.equal(clip.originY, "center");
assert.equal(clip.width, 1672);
assert.equal(clip.height, 941);

console.log("test:image-radius PASS");
