import assert from "node:assert/strict";
import * as fabric from "fabric";

import { applyObjectStyle, captureObjectStyle } from "../../src/client/lib/object-style.ts";
import { applyStylePreset } from "../../src/client/lib/style-presets.ts";

const shadow = new fabric.Shadow({
  color: "rgba(15, 23, 42, 0.4)",
  blur: 18,
  offsetX: 4,
  offsetY: 10,
  affectStroke: false,
  nonScaling: true,
});

const source = new fabric.Rect({
  width: 120,
  height: 80,
  fill: "#f8fafc",
  stroke: "#e2e8f0",
  strokeWidth: 2,
  shadow,
});
applyStylePreset(source, "glass");

const copied = captureObjectStyle(source);
assert.ok(copied.shadow, "glass source still copies the drop shadow");
assert.equal(copied.shadow?.blur, 18);
assert.equal(copied.shadow?.offsetX, 4);
assert.equal(copied.shadow?.offsetY, 10);
assert.equal(copied.shadow?.nonScaling, true);
assert.equal(copied.stylePreset, "glass");

const target = new fabric.Rect({
  width: 120,
  height: 80,
  fill: "#111827",
  shadow: new fabric.Shadow({ color: "#ff0000", blur: 2, offsetX: 1, offsetY: 1 }),
});
applyStylePreset(target, "glass");
applyObjectStyle(target, copied);

const live = target.shadow as fabric.Shadow | null;
assert.ok(live, "pasted style must keep the source shadow on a glass target");
assert.equal(live.blur, 18);
assert.equal(live.offsetX, 4);
assert.equal(live.offsetY, 10);
assert.equal(live.nonScaling, true);
assert.equal(target.fill, "#f8fafc");

const plain = new fabric.Rect({ width: 80, height: 40, fill: "#fff" });
applyObjectStyle(plain, { ...copied, stylePreset: "none", glassOptions: copied.glassOptions });
const plainShadow = plain.shadow as fabric.Shadow | null;
assert.ok(plainShadow, "shadow still pastes when the preset is none");
assert.equal(plainShadow.blur, 18);

const cleared = captureObjectStyle(new fabric.Rect({ width: 40, height: 40, fill: "#fff" }));
assert.equal(cleared.shadow, null);
applyObjectStyle(plain, cleared);
assert.equal(plain.shadow, null, "pasting a style without shadow clears the target shadow");

console.log("test:object-style PASS");
