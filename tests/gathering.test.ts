import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createWorld,
  step,
  STEP,
} from "../src/simulation/engine";
import { invalidateNavigation } from "../src/simulation/grid";
import { deserialize, serialize } from "../src/simulation/save";
import {
  recordWork,
  workingActivity,
  type WorkKind,
} from "../src/simulation/work-activity";
import {
  advanceGather,
  applyGatherPose,
  createGatherPose,
  gatheringRig,
} from "../src/game/gathering";
import { disposeGroup, villagerModel } from "../src/game/art";

function fixture(kind: WorkKind = "chop") {
  const w = createWorld(42);
  const v = w.villagers[0];
  w.villagers = [v];
  w.nodes = [];
  w.buildings = [];
  w.roads = [];
  w.terrain.fill(0);
  v.x = 4.5;
  v.z = 5.5;
  v.auto = false;
  if (kind === "tend" || kind === "craft") {
    w.buildings.push({
      id: w.nextId++,
      kind: kind === "tend" ? "farm" : "workshop",
      x: 5,
      z: 5,
      rotation: 0,
      progress: 1,
    });
    applyCommand(w, {
      type: "order",
      ids: [v.id],
      order: { type: "work", target: w.buildings[0].id },
    });
  } else {
    w.nodes.push({
      id: w.nextId++,
      kind: kind === "chop" ? "wood" : kind === "mine" ? "stone" : "food",
      x: 5,
      z: 5,
      amount: 100,
      variant: 0,
    });
    applyCommand(w, {
      type: "order",
      ids: [v.id],
      order: { type: "gather", target: w.nodes[0].id },
    });
  }
  invalidateNavigation(w);
  return { w, v };
}

describe("actual work evidence", () => {
  it.each<WorkKind>(["chop", "mine", "pick", "tend", "craft"])(
    "records %s only on successful work ticks",
    (kind) => {
      const { w, v } = fixture(kind);
      expect(workingActivity(w, v)).toBeNull();
      step(w);
      expect(workingActivity(w, v)?.kind).toBe(kind);
      v.x = 1.5;
      v.z = 1.5;
      step(w);
      expect(v.path.length).toBeGreaterThan(0);
      expect(workingActivity(w, v)).toBeNull();
      // A stale human-readable task label is not evidence of work, even at arrival.
      while (v.path.length) {
        step(w);
        expect(workingActivity(w, v)).toBeNull();
      }
      step(w);
      expect(workingActivity(w, v)?.kind).toBe(kind);
    },
  );
  it("does not animate blocked travel or delivery, including no route to storage", () => {
    const { w, v } = fixture();
    v.x = 1.5;
    v.z = 1.5;
    w.terrain.fill(1);
    invalidateNavigation(w);
    step(w);
    expect(v.task).toBe("Route blocked");
    expect(workingActivity(w, v)).toBeNull();
    w.terrain.fill(0);
    invalidateNavigation(w);
    v.x = 4.5;
    v.z = 5.5;
    v.blocked = 0;
    step(w);
    expect(workingActivity(w, v)?.kind).toBe("chop");
    v.cargo = { kind: "wood", amount: 8 };
    step(w);
    expect(v.task).toBe("No route to storage");
    expect(workingActivity(w, v)).toBeNull();
    w.buildings.push({
      id: w.nextId++,
      kind: "store",
      x: 1,
      z: 1,
      rotation: 0,
      progress: 1,
    });
    invalidateNavigation(w);
    v.blocked = 0;
    step(w);
    expect(v.task).toBe("Hauling wood");
    expect(workingActivity(w, v)).toBeNull();
  });
  it("invalidates immediately on reassignment, depletion or target removal", () => {
    for (const change of [
      "idle",
      "move",
      "build",
      "deplete",
      "remove",
    ] as const) {
      const { w, v } = fixture();
      step(w);
      if (change === "idle" || change === "move") {
        applyCommand(w, {
          type: "order",
          ids: [v.id],
          order:
            change === "idle"
              ? { type: "idle" }
              : { type: "move", target: { x: 2, z: 2 } },
        });
      } else if (change === "build") {
        w.buildings.push({
          id: w.nextId++,
          kind: "house",
          x: 1,
          z: 1,
          rotation: 0,
          progress: 0.2,
        });
        applyCommand(w, {
          type: "order",
          ids: [v.id],
          order: { type: "build", target: w.buildings[0].id },
        });
      } else if (change === "deplete") w.nodes[0].amount = 0;
      else w.nodes = [];
      expect(workingActivity(w, v)).toBeNull();
    }
    const { w, v } = fixture("tend");
    step(w);
    w.buildings = [];
    expect(workingActivity(w, v)).toBeNull();
  });
  it("handles cargo mismatch and keeps harvesting/insight rates unchanged", () => {
    for (const kind of ["chop", "mine", "pick", "tend", "craft"] as const) {
      const { w, v } = fixture(kind);
      const insight = w.stock.insight;
      for (let i = 0; i < 8; i++) step(w);
      if (kind === "craft")
        expect(w.stock.insight - insight).toBeCloseTo(
          8 * STEP * (0.12 + 0.065),
        );
      else expect(v.cargo?.amount).toBe(kind === "tend" ? 1 : 2);
      if (kind !== "craft") {
        v.cargo = { kind: "insight", amount: 1 };
        step(w);
        expect(workingActivity(w, v)).toBeNull();
      }
    }
  });
  it("does not persist visual state and resumes after the first successful loaded tick", () => {
    const { w, v } = fixture();
    step(w);
    w.buildings.push({
      id: w.nextId++,
      kind: "hall",
      x: 15,
      z: 15,
      rotation: 0,
      progress: 1,
    });
    const saved = serialize(w);
    expect(saved).not.toContain('"activities"');
    const loaded = deserialize(saved);
    expect(workingActivity(loaded, loaded.villagers[0])).toBeNull();
    step(loaded);
    step(w);
    expect(workingActivity(loaded, loaded.villagers[0])?.kind).toBe("chop");
    expect(loaded).toEqual(w);
    expect(workingActivity(w, v)?.kind).toBe("chop");
  });
});

describe("gathering poses", () => {
  it("freezes on pause, settles without another swing, then changes tool", () => {
    const { w, v } = fixture();
    step(w);
    const pose = createGatherPose(v.id),
      walk = { phase: 0, weight: 0, heading: 0 };
    const activity = workingActivity(w, v)!;
    for (let i = 0; i < 60; i++) advanceGather(pose, activity, walk, v, 1 / 60);
    const frozen = { ...pose },
      heading = walk.heading;
    advanceGather(pose, activity, walk, v, 0);
    expect(pose).toEqual(frozen);
    expect(walk.heading).toBe(heading);
    advanceGather(pose, null, walk, v, 1 / 60);
    expect(pose.phase).toBe(frozen.phase);
    expect(pose.weight).toBeLessThan(frozen.weight);
    expect(pose.weight).toBeGreaterThan(0.5);
    const next = { ...activity, kind: "mine" as const };
    advanceGather(pose, next, walk, v, 1 / 60);
    expect(pose.kind).toBe("chop");
    for (let i = 0; i < 60; i++) advanceGather(pose, next, walk, v, 1 / 60);
    expect(pose.kind).toBe("mine");
    expect(pose.weight).toBeGreaterThan(0.99);
  });
  it("uses simulation time at varied speeds and frame rates, facing the target", () => {
    const { w, v } = fixture("mine");
    step(w);
    const run = (fps: number, speed: number) => {
      const pose = createGatherPose(1),
        walk = { phase: 0, weight: 0, heading: -Math.PI };
      for (let i = 0; i < (fps / speed) * 4; i++)
        advanceGather(pose, workingActivity(w, v), walk, v, speed / fps);
      return { pose, walk };
    };
    const reference = run(60, 1);
    for (const [fps, speed] of [
      [30, 1],
      [144, 1],
      [60, 2],
      [60, 4],
    ]) {
      const actual = run(fps, speed);
      expect(actual.pose.phase).toBeCloseTo(reference.pose.phase, 9);
      expect(actual.pose.weight).toBeCloseTo(reference.pose.weight, 9);
      expect(actual.walk.heading).toBeCloseTo(reference.walk.heading, 9);
      expect(Math.sin(actual.walk.heading)).toBeCloseTo(1);
    }
  });
  it("accepts successful interior paddy work and keeps a finite heading at its center", () => {
    const { w, v } = fixture("tend");
    v.x = 6.5;
    v.z = 6.5;
    recordWork(w, v, "tend", w.buildings[0]);
    const pose = createGatherPose(1),
      walk = { phase: 0, weight: 0, heading: 0.75 };
    advanceGather(pose, workingActivity(w, v), walk, v, 1 / 60);
    expect(pose.kind).toBe("tend");
    expect(walk.heading).toBe(0.75);
  });
  it("keeps tools and pivots independent, and does not change shared materials or geometry", () => {
    const a = villagerModel(1),
      b = villagerModel(1);
    const rig = gatheringRig(a),
      other = gatheringRig(b);
    const shared = a.getObjectByName("cargo")!;
    const before = shared.toJSON();
    for (const kind of ["chop", "mine", "pick", "tend", "craft"] as const) {
      applyGatherPose(rig, { kind, phase: 1, weight: 1, target: 1 });
      expect(rig.axe.visible).toBe(kind === "chop");
      expect(rig.pickaxe.visible).toBe(kind === "mine");
      expect(rig.mallet.visible).toBe(kind === "craft");
      expect(other.upper.rotation.x).toBe(0);
      expect(other.axe.visible).toBe(false);
    }
    expect(shared.toJSON()).toEqual(before);
    applyGatherPose(rig, { kind: null, phase: 1, weight: 0, target: -1 });
    expect(rig.upper.rotation.x).toBe(0);
    expect(rig.upper.position.y).toBe(0.235);
    expect(rig.mallet.visible).toBe(false);
    disposeGroup(a);
    expect(other.upper.rotation.x).toBe(0);
    disposeGroup(b);
  });
});
