import { describe, expect, it } from "vitest";
import { contextualCursor } from "../src/game/contextual-actions";
import {
  approachPath,
  approachTargets,
  createWorld,
} from "../src/simulation/engine";
import {
  cell,
  dimensions,
  farmWorkSpots,
  findPath,
  hasPath,
  invalidateNavigation,
  perimeter,
} from "../src/simulation/grid";
import type { Building, Point } from "../src/simulation/types";

function fixture() {
  const w = createWorld(42);
  w.terrain.fill(0);
  w.buildings = [];
  w.nodes = [];
  w.roads = [];
  w.bridges = [];
  w.villagers.forEach((v, i) =>
    Object.assign(v, { x: 2.5 + i, z: 3.5, order: { type: "idle" }, path: [] }),
  );
  invalidateNavigation(w);
  return w;
}

describe("cursor connectivity agrees with command routing", () => {
  it("matches A* across barriers, bridges, blocked starts, and farm entry/exit", () => {
    const w = fixture();
    const farm: Building = {
      id: w.nextId++,
      kind: "farm",
      x: 5,
      z: 5,
      rotation: 1,
      progress: 1,
    };
    const unfinished: Building = {
      ...farm,
      id: w.nextId++,
      x: 10,
      progress: 0.5,
    };
    w.buildings.push(farm, unfinished, {
      ...farm,
      id: w.nextId++,
      kind: "house",
      x: 14,
    });
    for (let z = 0; z < w.size; z++) w.terrain[cell(w, 20, z)] = 1;
    w.nodes.push({
      id: w.nextId++,
      kind: "wood",
      x: 6,
      z: 6,
      amount: 10,
      variant: 0,
    });
    const starts: Point[] = [
      { x: 2.5, z: 2.5 },
      { x: 6.5, z: 7.5 },
      { x: 11.5, z: 6.5 },
      { x: 14.5, z: 6.5 },
      { x: 20.5, z: 20.5 },
      { x: 30.5, z: 20.5 },
    ];
    const targets: Point[][] = [
      [],
      [{ x: 2, z: 2 }],
      [{ x: 30, z: 20 }],
      [{ x: 6, z: 6 }],
      [{ x: -1, z: 0 }],
      [
        { x: 2, z: 2 },
        { x: 30, z: 20 },
      ],
    ];
    for (const bridge of [false, true]) {
      w.bridges = bridge ? [cell(w, 20, 20)] : [];
      invalidateNavigation(w);
      for (const farmId of [undefined, farm.id, unfinished.id])
        for (const from of starts)
          for (const goals of [...targets, farmWorkSpots(w, farm)])
            expect(hasPath(w, from, goals, farmId)).toBe(
              findPath(w, from, goals, farmId) !== null,
            );
    }
    // Completion changes route access even though the footprint stays blocked to ordinary routes.
    unfinished.progress = 1;
    for (const from of starts) {
      const goals = farmWorkSpots(w, unfinished);
      expect(hasPath(w, from, goals, unfinished.id)).toBe(
        findPath(w, from, goals, unfinished.id) !== null,
      );
    }
  });

  it("matches approach execution with free, shared, and reserved work spots", () => {
    const w = fixture();
    const farm: Building = {
      id: w.nextId++,
      kind: "farm",
      x: 5,
      z: 5,
      rotation: 0,
      progress: 1,
    };
    w.buildings.push(farm);
    invalidateNavigation(w);
    for (const farmId of [undefined, farm.id]) {
      const goals = farmId
        ? farmWorkSpots(w, farm)
        : perimeter(w, farm, ...dimensions(farm));
      for (let occupied = 0; occupied <= 9; occupied++) {
        for (const [i, v] of w.villagers.entries()) {
          const goal = goals[i % goals.length];
          Object.assign(
            v,
            i < occupied
              ? { x: goal.x + 0.5, z: goal.z + 0.5 }
              : { x: 2.5, z: 3.5 },
          );
          v.path = i % 2 ? [{ x: goal.x + 0.5, z: goal.z + 0.5 }] : [];
        }
        const targetsFor = approachTargets(w, goals, farmId);
        for (const v of w.villagers)
          expect(hasPath(w, v, targetsFor(v), farmId)).toBe(
            approachPath(w, v, goals, farmId) !== null,
          );
      }
    }
  });

  it("reuses terrain connectivity across a 200-worker group and tick-only changes", () => {
    const w = fixture(),
      base = w.villagers[0];
    w.villagers = Array.from({ length: 200 }, (_, i) => ({
      ...structuredClone(base),
      id: w.nextId++,
      x: 5.5 + (i % 10),
      z: 5.5 + Math.floor(i / 10),
    }));
    const n = {
      id: w.nextId++,
      kind: "wood" as const,
      x: 30,
      z: 20,
      amount: 100,
      variant: 0,
    };
    w.nodes.push(n);
    for (let z = 0; z < w.size; z++) w.terrain[cell(w, 20, z)] = 1;
    invalidateNavigation(w);
    let reads = 0;
    Object.defineProperty(w, "size", {
      get: () => {
        reads++;
        return 40;
      },
    });
    const hit = { type: "resource" as const, id: n.id },
      ids = w.villagers.map((v) => v.id);
    expect(contextualCursor(w, ids, hit, null)).toBeNull();
    const coldReads = reads;
    reads = 0;
    w.tick++;
    expect(contextualCursor(w, ids, hit, null)).toBeNull();
    // Structural work bound, not a machine-dependent timing assertion: no repeat flood.
    expect(reads).toBeLessThan(coldReads / 2);
    // Position and selection changes are live, without invalidating terrain.
    Object.assign(w.villagers[0], { x: 29.5, z: 20.5 });
    expect(contextualCursor(w, ids, hit, null)).toBe("wood");
    expect(contextualCursor(w, ids.slice(1), hit, null)).toBeNull();
    expect(contextualCursor(w, [], hit, null)).toBeNull();
    // Opening/closing a real crossing invalidates both the navigation mask and connectivity.
    w.bridges.push(cell(w, 20, 20));
    invalidateNavigation(w);
    expect(contextualCursor(w, ids.slice(1), hit, null)).toBe("wood");
    w.bridges = [];
    invalidateNavigation(w);
    expect(contextualCursor(w, ids.slice(1), hit, null)).toBeNull();
    n.amount = 0;
    invalidateNavigation(w);
    expect(contextualCursor(w, ids, hit, null)).toBeNull();
    const replacement = structuredClone(w);
    replacement.nodes[0].amount = 100;
    expect(contextualCursor(replacement, ids, hit, null)).toBe("wood");
  });

  it("refreshes occupied/reserved paddy spots and command capacity without a tick", () => {
    const w = fixture();
    const farm: Building = {
      id: w.nextId++,
      kind: "farm",
      x: 5,
      z: 5,
      rotation: 0,
      progress: 1,
    };
    w.buildings.push(farm);
    invalidateNavigation(w);
    const spots = farmWorkSpots(w, farm),
      hit = { type: "building" as const, id: farm.id },
      ids = [w.villagers[0].id];
    expect(contextualCursor(w, ids, hit, null)).toBe("farm");
    spots.forEach((p, i) => {
      w.villagers[i + 1].path = [{ x: p.x + 0.5, z: p.z + 0.5 }];
    });
    expect(contextualCursor(w, ids, hit, null)).toBeNull();
    w.villagers[1].path = [];
    expect(contextualCursor(w, ids, hit, null)).toBe("farm");
    Object.assign(w.villagers[1], { x: spots[0].x + 0.5, z: spots[0].z + 0.5 });
    expect(contextualCursor(w, ids, hit, null)).toBeNull();
    w.villagers.slice(1).forEach((v) => {
      v.x = 2.5;
      v.z = 3.5;
      v.path = [];
    });
    w.villagers.slice(1, 4).forEach((v) => {
      v.order = { type: "work", target: farm.id };
    });
    expect(contextualCursor(w, ids, hit, null)).toBeNull();
    w.villagers[1].order = { type: "idle" };
    expect(contextualCursor(w, ids, hit, null)).toBe("farm");
    farm.progress = 0.5;
    expect(contextualCursor(w, ids, hit, null)).toBe("build");
  });
});
