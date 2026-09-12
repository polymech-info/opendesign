import assert from "node:assert/strict";
import * as fabric from "fabric";

import { panImageCrop, readImageCrop, resetImageCrop, setImageCropZoom, zoomImageCrop } from "../../src/client/lib/image-crop.ts";

const img = new fabric.FabricImage(null, {
  width: 1000,
  height: 500,
  scaleX: 0.4,
  scaleY: 0.4,
  cropX: 0,
  cropY: 0,
  originX: "left",
  originY: "top",
  left: 100,
  top: 80,
});

const frameW = (img.width || 0) * (img.scaleX || 1);
const frameH = (img.height || 0) * (img.scaleY || 1);

zoomImageCrop(img, 2, "br", {
  cropX: img.cropX || 0,
  cropY: img.cropY || 0,
  width: img.width || 1,
  height: img.height || 1,
});

assert.ok((img.width || 0) < 1000, "corner zoom-in shrinks the source window");
assert.ok((img.cropX || 0) >= 0);
assert.equal(Math.round((img.width || 0) * Math.abs(img.scaleX || 1)), Math.round(frameW));
assert.equal(Math.round((img.height || 0) * Math.abs(img.scaleY || 1)), Math.round(frameH));

const before = { x: img.cropX || 0, y: img.cropY || 0 };
panImageCrop(img, -40, -20);
assert.ok((img.cropX || 0) !== before.x || (img.cropY || 0) !== before.y, "shift-pan moves crop origin");
assert.equal(Math.round((img.width || 0) * Math.abs(img.scaleX || 1)), Math.round(frameW));

setImageCropZoom(img, 3);
assert.ok(readImageCrop(img).zoom > 2);
resetImageCrop(img);
assert.equal(Math.round(readImageCrop(img).zoom), 1);
assert.equal(Math.round((img.width || 0) * Math.abs(img.scaleX || 1)), Math.round(frameW));

console.log("test:image-crop PASS");
