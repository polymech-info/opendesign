import assert from "node:assert/strict";
import * as fabric from "fabric";

import { applyImageCropTransfer, captureImageCropTransfer, clipImageCrop, panImageCrop, readImageCrop, resetImageCrop, resetImageFrame, setImageCropZoom, zoomImageCrop } from "../../src/client/lib/image-crop.ts";
import { captureObjectFrame } from "../../src/client/lib/object-frame.ts";

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

const clipStart = {
  cropX: img.cropX || 0,
  cropY: img.cropY || 0,
  width: img.width || 1,
  height: img.height || 1,
  scaleX: img.scaleX || 1,
  scaleY: img.scaleY || 1,
};
const right = (img.left || 0) + (img.width || 0) * Math.abs(img.scaleX || 1);
clipImageCrop(img, "ml", 40, 0, clipStart);
assert.equal(img.scaleX, clipStart.scaleX, "mid-handle clip must not stretch");
assert.equal(img.scaleY, clipStart.scaleY, "mid-handle clip must not stretch");
assert.ok((img.width || 0) < clipStart.width, "dragging the left handle inward clips source width");
assert.equal(
  Math.round((img.left || 0) + (img.width || 0) * Math.abs(img.scaleX || 1)),
  Math.round(right),
  "clipping from the left keeps the right edge pinned"
);

(img as { _sourceW?: number; _sourceH?: number })._sourceW = 1000;
(img as { _sourceW?: number; _sourceH?: number })._sourceH = 500;
img.set({ angle: 12, flipX: true, left: 40, top: 20 });
resetImageFrame(img, 1920, 1080);
assert.equal(img.cropX, 0, "reset drops crop X");
assert.equal(img.cropY, 0, "reset drops crop Y");
assert.equal(img.width, 1000, "reset restores full source width");
assert.equal(img.height, 500, "reset restores full source height");
assert.equal(img.angle, 0);
assert.equal(img.flipX, false);
const resetScale = Math.min((1920 * 0.6) / 1000, (1080 * 0.6) / 500, 1);
assert.ok(Math.abs((img.scaleX || 0) - resetScale) < 1e-6);
assert.ok(Math.abs((img.scaleY || 0) - resetScale) < 1e-6);
assert.equal(Math.round(img.left || 0), Math.round(1920 / 2 - (1000 * resetScale) / 2));
assert.equal(Math.round(img.top || 0), Math.round(1080 / 2 - (500 * resetScale) / 2));

const prev = new fabric.FabricImage(null, {
  width: 400,
  height: 300,
  cropX: 100,
  cropY: 50,
  scaleX: 2,
  scaleY: 2,
  originX: "left",
  originY: "top",
  left: 80,
  top: 40,
});
(prev as { _sourceW?: number; _sourceH?: number })._sourceW = 1000;
(prev as { _sourceW?: number; _sourceH?: number })._sourceH = 600;
const next = new fabric.FabricImage(null, { width: 2000, height: 1000 });
(next as { _sourceW?: number; _sourceH?: number })._sourceW = 2000;
(next as { _sourceW?: number; _sourceH?: number })._sourceH = 1000;
const transfer = captureImageCropTransfer(prev);
assert.ok(Math.abs(transfer.zoomX - 2.5) < 1e-6);
assert.ok(Math.abs(transfer.zoomY - 2) < 1e-6);
assert.ok(Math.abs(transfer.originX - 0.1) < 1e-6);
const frame = captureObjectFrame(prev);
applyImageCropTransfer(next, transfer, frame);
assert.equal(Math.round(next.width || 0), 800);
assert.equal(Math.round(next.height || 0), 500);
assert.equal(next.scaleX, next.scaleY, "replace must not stretch");
assert.ok((next.width || 0) * Math.abs(next.scaleX || 0) <= frame.width + 0.5);
assert.ok((next.height || 0) * Math.abs(next.scaleY || 0) <= frame.height + 0.5);
assert.ok(Math.abs(transfer.zoomX - 2000 / (next.width || 1)) < 1e-6, "zoom X kept");
assert.ok(Math.abs(transfer.zoomY - 1000 / (next.height || 1)) < 1e-6, "zoom Y kept");

console.log("test:image-crop PASS");
