import { describe, expect, it } from "vitest";
import {
  advanceWalk,
  interpolatePosition,
  type WalkPose,
} from "../src/game/walking";

describe("rendered walking", () => {
  it("moves evenly across tick boundaries instead of easing toward every new tick", () => {
    const positions: number[] = [];
    for (let tick = 0; tick < 4; tick++) {
      for (let frame = 0; frame < 15; frame++) {
        positions.push(
          interpolatePosition(
            { x: tick * 0.3125, z: 0 },
            { x: (tick + 1) * 0.3125, z: 0 },
            frame / 15,
          ).x,
        );
      }
    }
    for (let i = 1; i < positions.length; i++)
      expect(positions[i] - positions[i - 1]).toBeCloseTo(1.25 / 60, 10);
  });
  it("keeps heading and gait consistent at 30, 60, and 144 fps", () => {
    const run = (fps: number) => {
      const pose: WalkPose = { phase: 0, weight: 0, heading: 0 };
      for (let i = 0; i < fps; i++) advanceWalk(pose, 1.25 / fps, 0, 1 / fps);
      return pose;
    };
    const reference = run(60);
    for (const fps of [30, 144]) {
      const actual = run(fps);
      expect(actual.phase).toBeCloseTo(reference.phase, 10);
      expect(actual.weight).toBeCloseTo(reference.weight, 10);
      expect(actual.heading).toBeCloseTo(reference.heading, 10);
    }
  });
  it("freezes the pose when paused and smoothly settles after stopping", () => {
    const pose: WalkPose = { phase: 1.2, weight: 1, heading: 0.4 };
    advanceWalk(pose, 0, 0, 0);
    expect(pose).toEqual({ phase: 1.2, weight: 1, heading: 0.4 });
    advanceWalk(pose, 0, 0, 1 / 60);
    expect(pose.weight).toBeGreaterThan(0.5);
    expect(pose.weight).toBeLessThan(1);
    for (let i = 0; i < 60; i++) advanceWalk(pose, 0, 0, 1 / 60);
    expect(pose.weight).toBeLessThan(0.00001);
    expect(pose.phase).toBe(1.2);
  });
  it("turns across the angle boundary by the shortest route", () => {
    const pose: WalkPose = { phase: 0, weight: 1, heading: Math.PI - 0.1 };
    advanceWalk(
      pose,
      Math.sin(-Math.PI + 0.1) * 0.02,
      Math.cos(-Math.PI + 0.1) * 0.02,
      1 / 60,
    );
    expect(pose.heading).toBeGreaterThan(Math.PI - 0.1);
    expect(pose.heading).toBeLessThan(Math.PI + 0.1);
  });
});

import { createWorld, step, STEP } from "../src/simulation/engine";
import { invalidateNavigation } from "../src/simulation/grid";

it("preserves walking speed when a tick crosses a tile center", () => {
  const w = createWorld();
  w.nodes = [];
  w.roads = [];
  invalidateNavigation(w);
  for (const v of w.villagers) {
    v.order = { type: "idle" };
    v.auto = false;
  }
  const v = w.villagers[0];
  v.x = 4.5;
  v.z = 4.5;
  v.path = Array.from({ length: 6 }, (_, i) => ({ x: 5.5 + i, z: 4.5 }));
  v.order = { type: "move", target: { x: 10.5, z: 4.5 } };
  for (let i = 0; i < 12; i++) {
    const before = v.x;
    step(w);
    expect(v.x - before).toBeCloseTo(1.25 * STEP, 10);
  }
});
