import assert from "node:assert/strict";

import {
  formatDesignLength,
  formatRulerLabel,
  rulerMajorStep,
  rulerMinorStep,
  rulerSnapStops,
  rulerTicks,
  snapDesignLength,
  snapToStops,
} from "../../src/client/lib/canvas-rulers.ts";
import {
  attachConstructionLines,
  readConstructionLines,
} from "../../src/client/lib/construction-lines.ts";

assert.equal(rulerMajorStep(1), 100);
assert.equal(rulerMajorStep(2), 50);
assert.equal(rulerMajorStep(0.5), 200);
assert.equal(rulerMajorStep(0), 100);

assert.equal(rulerMinorStep(100), 20);
assert.equal(rulerMinorStep(50), 10);
assert.equal(rulerMinorStep(2), 1);

const atFit = rulerTicks(1920, 1);
assert.equal(atFit[0]?.at, 0);
assert.equal(atFit[0]?.label, "0");
assert.ok(atFit.every((t) => t.at <= 1920));
assert.equal(atFit.filter((t) => t.major).every((t) => t.label != null), true);
assert.equal(atFit.filter((t) => !t.major).every((t) => t.label == null), true);
assert.equal(atFit.filter((t) => t.label === "100").length, 1);

const zoomed = rulerTicks(100, 2);
assert.equal(zoomed.find((t) => t.at === 50)?.major, true);
assert.equal(zoomed.find((t) => t.at === 10)?.major, false);

assert.equal(formatDesignLength(96, "in", 1000), "1");
assert.equal(formatDesignLength(96, "mm", 1000), "25.4");
assert.equal(formatDesignLength(96, "cm", 1000), "2.54");
assert.equal(formatDesignLength(560, "%", 1120), "50");
const inches = rulerTicks(192, 1, "in");
const percentStops = rulerSnapStops(1000, 1, [], "%");
assert.ok(percentStops.includes(500));
assert.equal(percentStops.includes(470), false);
assert.equal(snapDesignLength(470, 1000, 1, [], "%"), 500);
assert.equal(snapDesignLength(200, 1000, 1, [], "%"), 200);
assert.equal(rulerTicks(1000, 1, "%").find((t) => t.half)?.label, "50");

assert.equal(inches.find((t) => t.label === "1")?.at, 96);
assert.equal(inches.find((t) => t.label === "2")?.at, 192);

assert.equal(formatRulerLabel(0), "0");
assert.equal(formatRulerLabel(100), "100");
assert.equal(rulerTicks(0, 1).length, 0);
assert.equal(rulerTicks(100, 0).length, 0);

const stops = rulerSnapStops(200, 1, [40, 80]);
for (const at of [0, 10, 20, 40, 60, 80, 100, 200]) {
  assert.ok(stops.includes(at), `missing stop ${at}`);
}
assert.equal(snapToStops(12, stops, 1), 10);
assert.equal(snapToStops(19, stops, 1, 8), 20);
assert.equal(snapToStops(70, stops, 1, 8), 70);
assert.equal(snapToStops(64, stops, 1, 8), 60);
assert.equal(rulerSnapStops(0, 1, []).length, 0);

const stored = attachConstructionLines('{"objects":[]}', [
  { id: "a", axis: "v", at: 120 },
  { id: "b", axis: "h", at: 40 },
]);
assert.deepEqual(readConstructionLines(stored), [
  { id: "a", axis: "v", at: 120 },
  { id: "b", axis: "h", at: 40 },
]);
assert.equal(JSON.parse(stored).objects.length, 0);
assert.equal(JSON.parse(stored)._constructionLines.length, 2);
assert.equal(readConstructionLines(attachConstructionLines(stored, [])).length, 0);
assert.deepEqual(readConstructionLines('{"_constructionLines":[{"axis":"x","at":1},{"id":"c","axis":"h","at":8}]}'), [
  { id: "c", axis: "h", at: 8 },
]);
assert.deepEqual(readConstructionLines("{}"), []);
assert.deepEqual(readConstructionLines("not-json"), []);
