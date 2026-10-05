import assert from "node:assert/strict";

import {
  canvasOrientation,
  matchCanvasSize,
  orientedCanvasSize,
} from "../../src/client/lib/canvas-size.ts";

assert.equal(canvasOrientation(794, 1123), "portrait");
assert.equal(canvasOrientation(1123, 794), "landscape");
assert.equal(canvasOrientation(1080, 1080), "square");

assert.deepEqual(orientedCanvasSize(794, 1123, "landscape"), { width: 1123, height: 794 });
assert.deepEqual(orientedCanvasSize(1123, 794, "portrait"), { width: 794, height: 1123 });

assert.equal(matchCanvasSize(794, 1123)?.label, "A4 Portrait");
assert.equal(matchCanvasSize(1123, 794)?.label, "A4 Landscape");
assert.equal(matchCanvasSize(559, 397)?.label, "A6 Landscape");

console.log("test-canvas-size: ok");
