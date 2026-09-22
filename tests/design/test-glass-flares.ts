import assert from "node:assert/strict";
import * as fabric from "fabric";

import {
  applyStylePreset,
  glassFlareLayout,
  glassSheenAngle,
  newGlassFlareSeed,
  readGlassOptions,
  resolveGlassFlareSeed,
} from "../../src/client/lib/style-presets.ts";

const a = glassFlareLayout(42, 400, 220, 1);
const again = glassFlareLayout(42, 400, 220, 1);
assert.deepEqual(a, again, "same seed keeps spark locations");
assert.equal(a.length, 2);
assert.notEqual(a[0].edge, a[1].edge, "sparks sit on different edges");

const b = glassFlareLayout(99, 400, 220, 1);
assert.notDeepEqual(
  a.map((s) => [s.x, s.y]),
  b.map((s) => [s.x, s.y]),
  "a different seed moves the sparks",
);

for (const spot of a) {
  assert.ok(Math.abs(spot.x) <= 200 + 1e-6);
  assert.ok(Math.abs(spot.y) <= 110 + 1e-6);
}

const ang = glassSheenAngle(42);
assert.ok(Math.abs(ang) <= 0.5);
assert.notEqual(ang, glassSheenAngle(99));

const first = new fabric.Rect({ width: 120, height: 80, fill: "#fff" });
(first as { _id?: string })._id = "card.one";
applyStylePreset(first, "glass");
const seed = readGlassOptions(first).flareSeed;
assert.ok(typeof seed === "number" && seed > 0, "applying glass stores a seed");
assert.equal(resolveGlassFlareSeed(first), seed);

applyStylePreset(first, "glass");
assert.equal(readGlassOptions(first).flareSeed, seed, "re-applying glass does not jump sparks");

const next = newGlassFlareSeed();
assert.notEqual(next, 0);

const legacy = new fabric.Rect({ width: 80, height: 40, fill: "#fff" });
(legacy as { _id?: string })._id = "card.legacy";
assert.equal(resolveGlassFlareSeed(legacy), resolveGlassFlareSeed(legacy), "id hash is stable");

console.log("test:glass-flares PASS");
