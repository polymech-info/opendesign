export const MIRROR_EVENT = "opend-mirror";

export type MirrorPose = {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
};

/** Reflect a pose across a vertical line (`x`) or a horizontal line (`y`). */
export function mirrorPose(
  pose: MirrorPose,
  axis: "x" | "y",
  at: number,
  preserveOrientation = false
): MirrorPose {
  const moved =
    axis === "x" ? { ...pose, x: 2 * at - pose.x } : { ...pose, y: 2 * at - pose.y };
  if (preserveOrientation) return moved;
  if (axis === "x") return { ...moved, angle: -pose.angle || 0, scaleX: -pose.scaleX };
  return { ...moved, angle: -pose.angle || 0, scaleY: -pose.scaleY };
}
