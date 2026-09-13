import assert from "node:assert/strict";
import * as fabric from "fabric";

import { MAXIMIZE_HANDLE_INSET, maximizeObjectToCanvas } from "../../src/client/lib/maximize-object.ts";

const canvasW = 1920;
const canvasH = 1080;
const fitW = canvasW - MAXIMIZE_HANDLE_INSET * 2;
const fitH = canvasH - MAXIMIZE_HANDLE_INSET * 2;

const img = new fabric.FabricImage(null, {
  width: 400,
  height: 300,
  scaleX: 2,
  scaleY: 0.8,
  cropX: 100,
  cropY: 50,
  originX: "left",
  originY: "top",
  left: 80,
  top: 40,
  angle: 15,
});
(img as { _sourceW?: number; _sourceH?: number })._sourceW = 1000;
(img as { _sourceH?: number; _sourceW?: number })._sourceH = 500;

assert.equal(maximizeObjectToCanvas(img, canvasW, canvasH), true);
assert.equal(img.cropX, 100, "maximize keeps crop origin");
assert.equal(img.cropY, 50, "maximize keeps crop origin");
assert.equal(img.width, 400, "maximize keeps clip width");
assert.equal(img.height, 300, "maximize keeps clip height");
assert.equal(img.angle, 0);
const displayW = 400 * 2;
const displayH = 300 * 0.8;
const factor = Math.min(fitW / displayW, fitH / displayH);
assert.ok(Math.abs((img.scaleX || 0) - 2 * factor) < 1e-6, "inner scaleX ratio kept");
assert.ok(Math.abs((img.scaleY || 0) - 0.8 * factor) < 1e-6, "inner scaleY ratio kept");
assert.ok(Math.abs((img.scaleX || 0) / (img.scaleY || 1) - 2 / 0.8) < 1e-6);
assert.ok(400 * Math.abs(img.scaleX || 0) <= fitW + 0.5);
assert.ok(300 * Math.abs(img.scaleY || 0) <= fitH + 0.5);

const rect = new fabric.Rect({
  width: 200,
  height: 200,
  scaleX: 1,
  scaleY: 1,
  left: 10,
  top: 10,
  originX: "left",
  originY: "top",
});
assert.equal(maximizeObjectToCanvas(rect, canvasW, canvasH), true);
assert.equal(rect.scaleX, rect.scaleY);
const shapeScale = fitH / 200;
assert.ok(Math.abs((rect.scaleX || 0) - shapeScale) < 1e-6);
assert.equal(Math.round((rect.width || 0) * (rect.scaleX || 0)), fitH);
assert.equal(Math.round(rect.top || 0), MAXIMIZE_HANDLE_INSET);
assert.equal(Math.round(rect.left || 0), Math.round((canvasW - fitH) / 2));

console.log("test:maximize-object PASS");
