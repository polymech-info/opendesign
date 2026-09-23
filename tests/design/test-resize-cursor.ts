import assert from "node:assert/strict";
import * as fabric from "fabric";

import {
  applyResizeCursors,
  resizeCursorForHandle,
  resizeCursorStyleHandler,
} from "../../src/client/lib/resize-cursor.ts";

const rect = new fabric.Rect({
  left: 100,
  top: 80,
  width: 200,
  height: 120,
  originX: "left",
  originY: "top",
});
rect.setCoords();

assert.equal(resizeCursorForHandle(rect, "tl"), "nwse-resize");
assert.equal(resizeCursorForHandle(rect, "br"), "nwse-resize");
assert.equal(resizeCursorForHandle(rect, "tr"), "nesw-resize");
assert.equal(resizeCursorForHandle(rect, "bl"), "nesw-resize");
assert.equal(resizeCursorForHandle(rect, "ml"), "ew-resize");
assert.equal(resizeCursorForHandle(rect, "mr"), "ew-resize");
assert.equal(resizeCursorForHandle(rect, "mt"), "ns-resize");
assert.equal(resizeCursorForHandle(rect, "mb"), "ns-resize");

rect.set({ lockScalingX: true, lockScalingY: true });
assert.equal(resizeCursorForHandle(rect, "tl"), "nwse-resize", "locks must not replace the diagonal cursor");

rect.set({ lockScalingX: false, lockScalingY: false, angle: 90, originX: "center", originY: "center" });
rect.setCoords();
assert.equal(resizeCursorForHandle(rect, "tl"), "nesw-resize", "90deg rotates tl onto the other diagonal");
assert.equal(resizeCursorForHandle(rect, "br"), "nesw-resize");
assert.equal(resizeCursorForHandle(rect, "tr"), "nwse-resize");
assert.equal(resizeCursorForHandle(rect, "bl"), "nwse-resize");

applyResizeCursors(rect);
assert.equal(rect.controls.tl.cursorStyleHandler, resizeCursorStyleHandler);
assert.equal(rect.controls.ml.cursorStyleHandler, resizeCursorStyleHandler);

console.log("test-resize-cursor: ok");
