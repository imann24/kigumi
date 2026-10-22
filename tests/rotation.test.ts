import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingKind } from "../src/simulation/catalog";
import {
  applyCommand,
  createWorld,
  placementError,
  STEP,
  step,
} from "../src/simulation/engine";
import {
  buildingAt,
  cell,
  dimensions,
  findPath,
  invalidateNavigation,
  perimeter,
  walkable,
} from "../src/simulation/grid";
import { deserialize, serialize } from "../src/simulation/save";

function clearing() {
  const w = createWorld();
  w.terrain.fill(0);
  w.nodes = [];
  w.roads = [];
  w.bridges = [];
  w.buildings = [w.buildings[0]];
  w.stock = { wood: 10000, food: 10000, stone: 10000, insight: 10000 };
  w.techs = ["joinery", "community"];
  for (const v of w.villagers) {
    v.auto = false;
    v.order = { type: "idle" };
    v.path = [];
  }
  invalidateNavigation(w);
  return w;
}

const kinds = (Object.keys(BUILDINGS) as BuildingKind[]).filter(
  (kind) => BUILDINGS[kind].category !== "paths",
);

describe.each([0, 1, 2, 3])("building direction %i", (rotation) => {
  it.each(kinds)(
    "keeps %s geometry, occupancy, access and saves in agreement",
    (kind) => {
      const w = clearing();
      const [a, c] = BUILDINGS[kind].size;
      const [width, depth] = rotation % 2 ? [c, a] : [a, c];
      expect(placementError(w, kind, 2, 2, rotation)).toBeNull();
      expect(walkable(w, 2, 2)).toBe(true); // Populate the cache before placement.
      expect(
        applyCommand(w, {
          type: "place",
          kind,
          x: 2,
          z: 2,
          rotation,
          villagers: [],
        }).ok,
      ).toBe(true);
      const b = w.buildings.at(-1)!;
      expect(b.rotation).toBe(rotation);
      expect(dimensions(b)).toEqual([width, depth]);
      for (let x = 1; x <= 2 + width; x++)
        for (let z = 1; z <= 2 + depth; z++) {
          const occupied = x >= 2 && x < 2 + width && z >= 2 && z < 2 + depth;
          expect(buildingAt(w, x, z)?.id === b.id).toBe(occupied);
          expect(walkable(w, x, z)).toBe(!occupied);
        }
      // Workers interact with any reachable perimeter tile, not a fixed doorway.
      const entrances = perimeter(w, b, ...dimensions(b));
      expect(entrances).toHaveLength((width + 2) * (depth + 2) - width * depth);
      expect(findPath(w, w.villagers[0], entrances)).not.toBeNull();
      const restored = deserialize(serialize(w));
      expect(restored).toEqual(w);
      expect(dimensions(restored.buildings.at(-1)!)).toEqual([width, depth]);
    },
  );

  it("uses the rotated rectangle at every map edge", () => {
    const w = clearing();
    const [width, depth] = dimensions({ kind: "house", rotation });
    for (const [x, z] of [
      [0, 0],
      [w.size - width, 0],
      [0, w.size - depth],
      [w.size - width, w.size - depth],
    ])
      expect(placementError(w, "house", x, z, rotation)).toBeNull();
    for (const [x, z] of [
      [-1, 0],
      [0, -1],
      [w.size - width + 1, 0],
      [0, w.size - depth + 1],
    ]) {
      const before = structuredClone(w);
      expect(
        applyCommand(w, {
          type: "place",
          kind: "house",
          x,
          z,
          rotation,
          villagers: [],
        }).message,
      ).toContain("island");
      expect(w).toEqual(before);
    }
  });

  it.each(["building", "resource", "villager", "road", "water"])(
    "checks %s collisions in the rotated-only strip",
    (obstacle) => {
      const w = clearing();
      const x = rotation % 2 ? 10 : 12;
      const z = rotation % 2 ? 12 : 10;
      if (obstacle === "building")
        w.buildings.push({
          id: w.nextId++,
          kind: "store",
          x,
          z,
          rotation: 0,
          progress: 1,
        });
      if (obstacle === "resource")
        w.nodes.push({
          id: w.nextId++,
          kind: "wood",
          x,
          z,
          amount: 100,
          variant: 0,
        });
      if (obstacle === "villager")
        Object.assign(w.villagers[0], { x: x + 0.5, z: z + 0.5 });
      if (obstacle === "road") w.roads.push(cell(w, x, z));
      if (obstacle === "water") w.terrain[cell(w, x, z)] = 1;
      invalidateNavigation(w);
      expect(placementError(w, "house", 10, 10, rotation)).not.toBeNull();
      expect(placementError(w, "house", 10, 10, (rotation + 1) % 4)).toBeNull();
      const before = structuredClone(w);
      expect(
        applyCommand(w, {
          type: "place",
          kind: "house",
          x: 10,
          z: 10,
          rotation,
          villagers: [],
        }).ok,
      ).toBe(false);
      expect(w).toEqual(before);
    },
  );

  it("preserves routes to existing buildings", () => {
    const w = clearing();
    w.buildings.push({
      id: w.nextId++,
      kind: "store",
      x: 2,
      z: 2,
      rotation,
      progress: 1,
    });
    for (let z = 1; z <= 4; z++)
      for (let x = 1; x <= 4; x++)
        if (!(x >= 2 && x <= 3 && z >= 2 && z <= 3))
          w.terrain[cell(w, x, z)] = 1;
    w.terrain[cell(w, 4, 3)] = 0;
    invalidateNavigation(w);
    expect(placementError(w, "house", 5, 2, rotation)).toContain("route");
  });

  it("completes construction after saving and loading the rotated site", () => {
    const w = clearing();
    expect(
      applyCommand(w, {
        type: "place",
        kind: "house",
        x: 18,
        z: 12,
        rotation,
        villagers: w.villagers.slice(0, 2).map((v) => v.id),
      }).ok,
    ).toBe(true);
    const restored = deserialize(serialize(w));
    for (let i = 0; i < 70 / STEP; i++) {
      step(w);
      step(restored);
    }
    expect(restored).toEqual(w);
    expect(restored.buildings.at(-1)).toMatchObject({ rotation, progress: 1 });
  });
});

it.each([-1, 4, 1.5, NaN, Infinity])(
  "rejects invalid orientation %s without changing the world",
  (rotation) => {
    const w = clearing();
    const before = structuredClone(w);
    expect(placementError(w, "house", 2, 2, rotation)).not.toBeNull();
    expect(
      applyCommand(w, {
        type: "place",
        kind: "house",
        x: 2,
        z: 2,
        rotation,
        villagers: [],
      }).ok,
    ).toBe(false);
    expect(w).toEqual(before);
    w.buildings[0].rotation = rotation;
    expect(() => deserialize(serialize(w))).toThrow();
  },
);
