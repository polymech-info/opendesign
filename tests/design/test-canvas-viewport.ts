import assert from "node:assert/strict";

import {
  computeFitScale,
  nextScrollToReveal,
  zoomIsAtFit,
} from "../../src/client/lib/canvas-viewport.ts";

assert.equal(computeFitScale(1000, 800, 1000, 800, 0, 0), 1);
assert.ok(Math.abs(computeFitScale(580, 400, 1000, 800, 80, 80) - 0.4) < 1e-9);
assert.ok(Math.abs(computeFitScale(1080, 2000, 1000, 800, 80, 80) - 1) < 1e-9);
assert.ok(computeFitScale(2000, 200, 1000, 800, 80, 80) < 0.2);
assert.equal(computeFitScale(500, 500, 0, 800), 1);

assert.equal(zoomIsAtFit(0.58, 0.58), true);
assert.equal(zoomIsAtFit(0.58, 0.56), true);
assert.equal(zoomIsAtFit(1.2, 0.5), false);

const nudgeLeft = nextScrollToReveal(
  { width: 400, height: 300 },
  { scrollLeft: 100, scrollTop: 0 },
  { left: 0, top: 10, width: 80, height: 80 },
);
assert.equal(nudgeLeft.scrollLeft, 0);
assert.equal(nudgeLeft.scrollTop, 0);

const nudgeRight = nextScrollToReveal(
  { width: 400, height: 300 },
  { scrollLeft: 0, scrollTop: 0 },
  { left: 380, top: 10, width: 80, height: 80 },
);
assert.equal(nudgeRight.scrollLeft, 76);

const tallerKeepsScroll = nextScrollToReveal(
  { width: 400, height: 200 },
  { scrollLeft: 0, scrollTop: 80 },
  { left: 40, top: 0, width: 200, height: 400 },
);
assert.equal(tallerKeepsScroll.scrollTop, 80);

const tallerOffscreen = nextScrollToReveal(
  { width: 400, height: 200 },
  { scrollLeft: 0, scrollTop: 0 },
  { left: 40, top: 500, width: 200, height: 400 },
);
assert.equal(tallerOffscreen.scrollTop, 484);
