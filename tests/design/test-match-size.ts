import assert from "node:assert/strict";
import * as fabric from "fabric";

import { matchObjectsSizeToFirst } from "../../src/client/lib/align-objects.ts";

const first = new fabric.Rect({
  width: 200,
  height: 80,
  scaleX: 1,
  scaleY: 1,
  left: 0,
  top: 0,
  originX: "left",
  originY: "top",
  strokeWidth: 0,
});
const second = new fabric.Rect({
  width: 50,
  height: 50,
  scaleX: 1,
  scaleY: 1,
  left: 300,
  top: 20,
  originX: "left",
  originY: "top",
  strokeWidth: 0,
});

assert.equal(matchObjectsSizeToFirst([first, second], "width"), true);
assert.ok(Math.abs(second.getScaledWidth() - first.getScaledWidth()) < 0.5);
assert.ok(Math.abs(second.getScaledHeight() - second.getScaledWidth()) < 0.5, "square keeps aspect");
assert.equal(Math.round(first.getScaledWidth()), 200);

const tall = new fabric.Rect({
  width: 40,
  height: 120,
  scaleX: 1,
  scaleY: 1,
  left: 10,
  top: 10,
  originX: "left",
  originY: "top",
  strokeWidth: 0,
});
assert.equal(matchObjectsSizeToFirst([first, tall], "height"), true);
assert.ok(Math.abs(tall.getScaledHeight() - first.getScaledHeight()) < 0.5);
assert.ok(Math.abs(tall.getScaledWidth() / tall.getScaledHeight() - 40 / 120) < 0.01);

console.log("test:match-size PASS");
