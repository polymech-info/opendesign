import assert from "node:assert/strict";

import { parseDesignLength } from "../../src/client/lib/canvas-rulers.ts";
import {
  convertPatternDistance,
  patternOffsets,
  patternRefDir,
  patternSteps,
  type PatternAxis,
} from "../../src/client/lib/rect-pattern.ts";

function axis(partial: Partial<PatternAxis> & Pick<PatternAxis, "quantity" | "distancePx">): PatternAxis {
  return {
    distribution: "spacing",
    direction: "one",
    ...partial,
  };
}

assert.deepEqual(patternSteps(axis({ quantity: 1, distancePx: 10 })), [0]);
assert.deepEqual(patternSteps(axis({ quantity: 3, distancePx: 10 })), [0, 10, 20]);
assert.deepEqual(
  patternSteps(axis({ quantity: 3, distancePx: 20, distribution: "extent" })),
  [0, 10, 20]
);
assert.deepEqual(
  patternSteps(axis({ quantity: 3, distancePx: -10 })),
  [0, -10, -20]
);
assert.deepEqual(
  patternSteps(axis({ quantity: 5, distancePx: 10, direction: "symmetric" })),
  [-20, -10, 0, 10, 20]
);
assert.deepEqual(
  patternSteps(axis({ quantity: 5, distancePx: 40, distribution: "extent", direction: "symmetric" })),
  [-20, -10, 0, 10, 20]
);
assert.deepEqual(
  patternSteps(axis({ quantity: 4, distancePx: 10, direction: "symmetric" })),
  [-10, 0, 10, 20]
);

const grid = patternOffsets(
  axis({ quantity: 2, distancePx: 30 }),
  axis({ quantity: 2, distancePx: 12 })
);
assert.deepEqual(grid, [
  { dx: 0, dy: 12 },
  { dx: 30, dy: 0 },
  { dx: 30, dy: 12 },
]);
assert.equal(
  patternOffsets(axis({ quantity: 3, distancePx: 0 }), null).length,
  0
);

assert.equal(convertPatternDistance(10, "spacing", "extent", 3), 20);
assert.equal(convertPatternDistance(20, "extent", "spacing", 3), 10);

assert.equal(patternRefDir({ kind: "line", id: "a", axis: "v" }), "x");
assert.equal(patternRefDir({ kind: "line", id: "a", axis: "h" }), "y");
assert.equal(patternRefDir({ kind: "edge", edge: "left" }), "x");
assert.equal(patternRefDir({ kind: "edge", edge: "bottom" }), "y");

assert.equal(parseDesignLength("10", "px", 1000), 10);
assert.equal(parseDesignLength("1", "in", 1000), 96);
assert.equal(parseDesignLength("50", "%", 200), 100);
assert.equal(parseDesignLength("2.54", "cm", 1000), 96);
assert.equal(parseDesignLength("", "px", 100), null);
assert.equal(parseDesignLength("-", "mm", 100), null);
assert.equal(parseDesignLength(".", "px", 100), null);

console.log("test:rect-pattern PASS");
