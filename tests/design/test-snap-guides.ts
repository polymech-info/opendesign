import assert from "node:assert/strict";

import {
  canvasBoundarySnaps,
  canvasBoundarySnapsY,
  chooseDirectedSnap,
  SNAP_TOLERANCE,
} from "../../src/client/lib/snap-guides.ts";

const page = { left: 0, top: 0, right: 1920, bottom: 1080, cx: 960, cy: 540 };
const nearRight = { left: 1720, top: 200, right: 1917, bottom: 400, cx: 1818.5, cy: 300 };
const xHits = canvasBoundarySnaps(nearRight, page, SNAP_TOLERANCE);
assert.ok(xHits.some((h) => h.kind === "max" && Math.abs(h.delta - 3) < 1e-6));

const nearLeft = { left: 4, top: 100, right: 204, bottom: 300, cx: 104, cy: 200 };
const leftHits = canvasBoundarySnaps(nearLeft, page, SNAP_TOLERANCE);
const left = chooseDirectedSnap(leftHits, -1);
assert.equal(left?.kind, "min");

const both = [
  { delta: 1, at: 0, kind: "min" as const, moverStart: 0, moverEnd: 10, targetStart: 0, targetEnd: 10 },
  { delta: 4, at: 1920, kind: "max" as const, moverStart: 0, moverEnd: 10, targetStart: 0, targetEnd: 10 },
];
assert.equal(chooseDirectedSnap(both, 1)?.kind, "max", "drag right prefers the right canvas edge");
assert.equal(chooseDirectedSnap(both, -1)?.kind, "min", "drag left prefers the left canvas edge");

const nearBottom = { left: 100, top: 880, right: 300, bottom: 1076, cx: 200, cy: 978 };
const yHits = canvasBoundarySnapsY(nearBottom, page, SNAP_TOLERANCE);
assert.equal(chooseDirectedSnap(yHits, 1)?.kind, "max");

console.log("test:snap-guides PASS");
