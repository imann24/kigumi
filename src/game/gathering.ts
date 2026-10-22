import type * as THREE from "three";
import { dimensions } from "../simulation/grid";
import type { Point } from "../simulation/types";
import type { WorkActivity, WorkKind } from "../simulation/work-activity";
import type { WalkPose } from "./walking";

export interface GatherPose {
  kind: WorkKind | null;
  target: number;
  phase: number;
  weight: number;
}
export function createGatherPose(id: number): GatherPose {
  return {
    kind: null,
    target: -1,
    phase: (id * 2.39996) % (Math.PI * 2),
    weight: 0,
  };
}

/** Fade the old pose to rest before swapping activities; freeze fully on pause. */
export function advanceGather(
  pose: GatherPose,
  activity: WorkActivity | null,
  walk: WalkPose,
  position: Point,
  seconds: number,
) {
  if (seconds <= 0) return;
  const same =
    activity?.kind === pose.kind && activity?.target.id === pose.target;
  if (!same && pose.weight < 0.01) {
    pose.kind = activity?.kind ?? null;
    pose.target = activity?.target.id ?? -1;
  }
  const active =
    !!activity &&
    activity.kind === pose.kind &&
    activity.target.id === pose.target;
  pose.weight += ((active ? 1 : 0) - pose.weight) * -Math.expm1(-16 * seconds);
  if (!active) return;
  const cycle = { chop: 1.1, mine: 1.35, pick: 1.5, tend: 2, craft: 0.8 }[
    activity.kind
  ];
  pose.phase = (pose.phase + (seconds * Math.PI * 2) / cycle) % (Math.PI * 2);
  const target = activity.target;
  const [width, depth] = "amount" in target ? [1, 1] : dimensions(target);
  const dx = target.x + width / 2 - position.x;
  const dz = target.z + depth / 2 - position.z;
  // A worker at the paddy center keeps their heading and tends the row ahead.
  if (Math.hypot(dx, dz) > 0.05) {
    const desired = Math.atan2(dx, dz);
    const turn = Math.atan2(
      Math.sin(desired - walk.heading),
      Math.cos(desired - walk.heading),
    );
    walk.heading += turn * -Math.expm1(-10 * seconds);
  }
}

/** Cache pivots once per model; never allocate geometry or mutate shared materials here. */
export function gatheringRig(model: THREE.Group) {
  return {
    upper: model.getObjectByName("upper-body")!,
    left: model.getObjectByName("left-arm")!,
    right: model.getObjectByName("right-arm")!,
    axe: model.getObjectByName("axe")!,
    pickaxe: model.getObjectByName("pickaxe")!,
    mallet: model.getObjectByName("mallet")!,
  };
}
export type GatheringRig = ReturnType<typeof gatheringRig>;

/** Layer work over the existing gait. +Z is forward; arms pivot at the shoulders. */
export function applyGatherPose(rig: GatheringRig, pose: GatherPose) {
  const w = pose.weight;
  const wave = Math.sin(pose.phase);
  // Slow wind-up and a concentrated downstroke give tools a readable impact.
  const strike = Math.pow((1 + wave) / 2, 3);
  let left = 0,
    right = 0,
    lean = 0,
    twist = 0,
    lower = 0;
  switch (pose.kind) {
    case "chop":
      right = -2.2 + 1.25 * strike;
      left = -1.65 + 0.85 * strike;
      lean = 0.12 + 0.16 * strike;
      twist = -0.18 + 0.42 * strike;
      break;
    case "mine":
      right = -2.8 + 2.1 * strike;
      left = -2.35 + 1.65 * strike;
      lean = 0.08 + 0.48 * strike;
      lower = -0.035 * strike;
      break;
    case "pick":
      right = -1.2 - 0.4 * wave;
      left = -1.2 + 0.4 * wave;
      lean = 0.23 + 0.09 * Math.cos(pose.phase * 2);
      twist = 0.13 * wave;
      break;
    case "tend":
      lean = 0.85 + 0.18 * wave;
      lower = -0.055;
      right = -0.38 - 0.28 * Math.sin(pose.phase + 0.6);
      left = -0.38 - 0.28 * Math.sin(pose.phase - 0.6);
      break;
    case "craft":
      right = -1.8 + 0.65 * strike;
      left = -1.05;
      lean = 0.16;
      break;
  }
  rig.upper.rotation.set(lean * w, twist * w, 0);
  rig.upper.position.y = 0.235 + lower * w;
  rig.left.rotation.x = rig.left.rotation.x * (1 - w) + left * w;
  rig.right.rotation.x = rig.right.rotation.x * (1 - w) + right * w;
  for (const [tool, enabled] of [
    [rig.axe, pose.kind === "chop"],
    [rig.pickaxe, pose.kind === "mine"],
    [rig.mallet, pose.kind === "craft"],
  ] as const) {
    tool.visible = enabled && w > 0.01;
    tool.scale.setScalar(w);
  }
}
