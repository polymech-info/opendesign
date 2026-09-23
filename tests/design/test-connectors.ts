import assert from "node:assert/strict";

import {
  buildBalloonPath,
  buildConnectorPath,
  buildHeadPath,
  sanitizeConnector,
  shorten,
} from "../../src/client/lib/connectors.ts";
import { snapPointToBoxes, SNAP_TOLERANCE } from "../../src/client/lib/snap-guides.ts";

const start = { x: 0, y: 0 };
const end = { x: 100, y: 0 };
const line = sanitizeConnector({ kind: "line", start, end, startHead: "none", endHead: "none" });
const linePath = buildConnectorPath(line, 3);
assert.match(linePath, /^M /);
assert.ok(linePath.includes("L "));
assert.ok(!linePath.includes(" Z"));

const arrow = sanitizeConnector({ kind: "arrow", start, end, endHead: "arrow" });
const arrowPath = buildConnectorPath(arrow, 3);
assert.ok(arrowPath.includes("Z"), "arrow head is a closed path");
const shortened = shorten(start, end, 20);
assert.ok(shortened.x < 100 && shortened.x > 70);

const elbow = sanitizeConnector({
  kind: "elbow",
  start: { x: 0, y: 0 },
  end: { x: 80, y: 60 },
  mid: { x: 80, y: 0 },
  endHead: "triangle",
});
const elbowPath = buildConnectorPath(elbow, 3);
assert.ok(elbowPath.includes("L 80 0"), "elbow keeps the waypoint");
assert.match(
  elbowPath,
  /L 80 0 L [\d.]+ [\d.]+ L 80 0 L 0 0/,
  "elbow retraces so fill cannot form a triangle"
);

const curve = sanitizeConnector({
  kind: "curve",
  start,
  end,
  mid: { x: 50, y: -40 },
  endHead: "none",
});
assert.ok(buildConnectorPath(curve, 3).includes("Q 50 -40"));

const head = buildHeadPath({ x: 10, y: 0 }, { x: 0, y: 0 }, "diamond", 12);
assert.ok(head.includes("Z"));

const box = { left: 100, top: 40, right: 180, bottom: 120, cx: 140, cy: 80 };
const page = { left: 0, top: 0, right: 400, bottom: 300, cx: 200, cy: 150 };
const corner = snapPointToBoxes({ x: 102, y: 42 }, [box], page, SNAP_TOLERANCE);
assert.ok(corner);
assert.equal(corner.point.x, 100);
assert.equal(corner.point.y, 40);

const along = snapPointToBoxes({ x: 128, y: 37 }, [box], page, SNAP_TOLERANCE);
assert.ok(along);
assert.equal(along.point.y, 40);
assert.ok(along.point.x > 100 && along.point.x < 180);
assert.ok(Math.abs(along.point.x - 128) < 1e-6, "edge snap keeps the along-edge coordinate");

const speech = buildBalloonPath({
  kind: "speech",
  x: 10,
  y: 10,
  w: 120,
  h: 70,
  tail: { x: 30, y: 120 },
});
assert.ok(speech.includes("Z"));
assert.ok(speech.includes("120"));

const thought = buildBalloonPath({
  kind: "thought",
  x: 0,
  y: 0,
  w: 100,
  h: 60,
  tail: { x: 20, y: 90 },
});
assert.ok(thought.includes("A "), "thought balloon uses ellipse arcs");

console.log("test-connectors: ok");
