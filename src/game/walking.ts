import type { Point } from "../simulation/types";

export function interpolatePosition(
  previous: Point,
  current: Point,
  alpha: number,
): Point {
  const t = Math.max(0, Math.min(1, alpha));
  return {
    x: previous.x + (current.x - previous.x) * t,
    z: previous.z + (current.z - previous.z) * t,
  };
}

export interface WalkPose {
  phase: number;
  weight: number;
  heading: number;
}

/** Visual-only gait: one stride per 0.85 tiles, independent of frame rate and game speed. */
export function advanceWalk(
  pose: WalkPose,
  dx: number,
  dz: number,
  seconds: number,
): void {
  if (seconds <= 0) return;
  const distance = Math.hypot(dx, dz);
  const moving = distance > 0.000001;
  pose.weight += ((moving ? 1 : 0) - pose.weight) * -Math.expm1(-12 * seconds);
  if (!moving) return;
  pose.phase = (pose.phase + (distance * Math.PI * 2) / 0.85) % (Math.PI * 2);
  const desired = Math.atan2(dx, dz);
  const turn = Math.atan2(
    Math.sin(desired - pose.heading),
    Math.cos(desired - pose.heading),
  );
  pose.heading += turn * -Math.expm1(-14 * seconds);
}
