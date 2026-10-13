import assert from "node:assert/strict";

import { publishConstructionSnap } from "../../src/client/lib/construction-lines.ts";
import {
  canvasBoundarySnaps,
  canvasBoundarySnapsY,
  chooseDirectedSnap,
  SNAP_TOLERANCE,
  snapPointToBoxes,
  snapResizeDelta,
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

const clipRight = snapResizeDelta(nearRight, "right", page, [], SNAP_TOLERANCE, 1);
assert.ok(clipRight && Math.abs(clipRight.delta - 3) < 1e-6, "clip right snaps to canvas");
const clipLeftPinned = snapResizeDelta(nearRight, "left", page, [], SNAP_TOLERANCE, 1);
assert.equal(clipLeftPinned, null, "pinned clip edge does not snap to the far canvas side");

const neighbor = { left: 1718, top: 180, right: 1900, bottom: 420, cx: 1809, cy: 300 };
const clipToObject = snapResizeDelta(nearRight, "left", page, [neighbor], SNAP_TOLERANCE, -1);
assert.ok(clipToObject && Math.abs(clipToObject.at - 1718) < 1e-6, "clip left snaps to a neighbor left edge");

const nearTop = { left: 80, top: 3, right: 280, bottom: 200, cx: 180, cy: 101.5 };
const clipTop = snapResizeDelta(nearTop, "top", page, [], SNAP_TOLERANCE, -1);
assert.ok(clipTop && clipTop.kind === "min" && Math.abs(clipTop.delta + 3) < 1e-6, "clip top snaps to canvas");

const neighborBox = { left: 200, top: 80, right: 280, bottom: 160, cx: 240, cy: 120 };
const edgeHit = snapPointToBoxes({ x: 203, y: 101 }, [neighborBox], page, SNAP_TOLERANCE);
assert.ok(
  edgeHit && Math.abs(edgeHit.point.x - 200) < 1e-6 && Math.abs(edgeHit.point.y - 101) < 1e-6,
  "point snaps along a neighbor vertical edge"
);

publishConstructionSnap([{ id: "v", axis: "v", at: 200 }]);
const nearLine = { left: 40, top: 10, right: 196, bottom: 80, cx: 118, cy: 45 };
const edgeToLine = snapResizeDelta(nearLine, "right", page, [], SNAP_TOLERANCE, 1, true);
assert.ok(edgeToLine && edgeToLine.kind === "max" && Math.abs(edgeToLine.at - 200) < 1e-6, "scale edge snaps to a vertical construction line");
assert.ok(edgeToLine && Math.abs(edgeToLine.delta - 4) < 1e-6);

publishConstructionSnap([{ id: "mid", axis: "v", at: 118 }]);
assert.equal(
  snapResizeDelta(nearLine, "right", page, [], SNAP_TOLERANCE, 1, true),
  null,
  "dragging the right edge does not snap the center onto a construction line"
);
const centerSnap = snapResizeDelta(nearLine, "right", page, [], SNAP_TOLERANCE, 0, false);
assert.ok(centerSnap && centerSnap.kind === "mid", "move/crop can still snap a center to a construction line");

publishConstructionSnap([{ id: "h", axis: "h", at: 40 }]);
const nearH = { left: 10, top: 36, right: 80, bottom: 120, cx: 45, cy: 78 };
const topToLine = snapResizeDelta(nearH, "top", page, [], SNAP_TOLERANCE, -1, true);
assert.ok(topToLine && topToLine.kind === "min" && Math.abs(topToLine.at - 40) < 1e-6, "scale edge snaps to a horizontal construction line");
publishConstructionSnap([]);

console.log("test:snap-guides PASS");
