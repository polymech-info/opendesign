import assert from "node:assert/strict";
import { mirrorPose, type MirrorPose } from "../../src/client/lib/mirror.ts";

function tan(deg: number) {
  return Math.tan((deg * Math.PI) / 180);
}

/** Fabric order: skewY, skewX, scale, rotate, then translate. Y-down makes +angle clockwise on screen. */
function posePoint(pose: MirrorPose, lx: number, ly: number) {
  const y1 = tan(pose.skewY) * lx + ly;
  const x2 = lx + tan(pose.skewX) * y1;
  const sx = pose.scaleX * x2;
  const sy = pose.scaleY * y1;
  const rad = (pose.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: pose.x + cos * sx - sin * sy,
    y: pose.y + sin * sx + cos * sy,
  };
}

function reflect(point: { x: number; y: number }, axis: "x" | "y", at: number) {
  if (axis === "x") return { x: 2 * at - point.x, y: point.y };
  return { x: point.x, y: 2 * at - point.y };
}

function assertMirrored(pose: MirrorPose, axis: "x" | "y", at: number) {
  const next = mirrorPose(pose, axis, at);
  for (const local of [
    { x: 8, y: -3 },
    { x: -4, y: 6 },
    { x: 0, y: 0 },
  ]) {
    const mirrored = reflect(posePoint(pose, local.x, local.y), axis, at);
    const got = posePoint(next, local.x, local.y);
    assert.ok(Math.abs(got.x - mirrored.x) < 1e-6, `${axis} x ${got.x} vs ${mirrored.x}`);
    assert.ok(Math.abs(got.y - mirrored.y) < 1e-6, `${axis} y ${got.y} vs ${mirrored.y}`);
  }
}

const pose: MirrorPose = {
  x: 10,
  y: 20,
  angle: 25,
  scaleX: 1.5,
  scaleY: 0.5,
  skewX: 0,
  skewY: 0,
};

assertMirrored(pose, "x", 100);
assertMirrored(pose, "y", 40);
assertMirrored({ ...pose, angle: 0, skewX: 12, skewY: -7 }, "x", 50);
assertMirrored({ ...pose, angle: -15, skewX: 12, skewY: -7 }, "y", 80);

const vertical = mirrorPose(pose, "x", 40);
assert.equal(vertical.x, 70);
assert.equal(vertical.y, 20);
assert.equal(vertical.angle, -25);
assert.equal(vertical.scaleX, -1.5);
assert.equal(vertical.scaleY, 0.5);

const horizontal = mirrorPose(pose, "y", 50);
assert.equal(horizontal.x, 10);
assert.equal(horizontal.y, 80);
assert.equal(horizontal.scaleY, -0.5);
assert.equal(horizontal.scaleX, 1.5);

const kept = mirrorPose(pose, "y", 50, true);
assert.equal(kept.x, 10);
assert.equal(kept.y, 80);
assert.equal(kept.angle, 25);
assert.equal(kept.scaleX, 1.5);
assert.equal(kept.scaleY, 0.5);

console.log("test:mirror PASS");
