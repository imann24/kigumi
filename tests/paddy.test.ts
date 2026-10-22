import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlannedPaths, plannedRoute } from "../src/game/planned-paths";
import { paddyHeight } from "../src/game/surfaces";
import { BUILDINGS } from "../src/simulation/catalog";
import {
  applyCommand,
  createWorld,
  placementError,
  step,
} from "../src/simulation/engine";
import {
  buildingAt,
  cell,
  dimensions,
  farmWorkSpots,
  findPath,
  invalidateNavigation,
  routeWalkable,
  walkable,
} from "../src/simulation/grid";
import { deserialize, serialize } from "../src/simulation/save";
import type { Order, World } from "../src/simulation/types";

function fixture(rotation = 0) {
  const w = createWorld(42);
  w.terrain.fill(0);
  w.nodes = [];
  w.roads = [];
  w.bridges = [];
  w.config.foodConsumption = 0;
  const farm = w.buildings.find((b) => b.kind === "farm")!;
  farm.rotation = rotation;
  w.buildings = [w.buildings[0], farm];
  for (const v of w.villagers) {
    v.auto = false;
    v.order = { type: "idle" };
    v.path = [];
  }
  const v = w.villagers[0];
  v.x = 20.5;
  v.z = 20.5;
  invalidateNavigation(w);
  return { w, farm, v };
}
function ticks(w: World, count: number) {
  for (let i = 0; i < count; i++) step(w);
}
function order(w: World, ids: number[], order: Order) {
  expect(applyCommand(w, { type: "order", ids, order }).ok).toBe(true);
}
function until(w: World, check: () => boolean, max = 400) {
  for (let i = 0; i < max && !check(); i++) step(w);
  expect(check()).toBe(true);
}

describe("rice-paddy access", () => {
  it.each([0, 1, 2, 3])(
    "routes three farmers into distinct tiles and hauls renewable food (rotation %i)",
    (rotation) => {
      const { w, farm } = fixture(rotation);
      const party = w.villagers.slice(0, 3);
      expect(
        applyCommand(w, {
          type: "order",
          ids: w.villagers.slice(0, 4).map((v) => v.id),
          order: { type: "work", target: farm.id },
        }).ok,
      ).toBe(false);
      order(
        w,
        party.map((v) => v.id),
        { type: "work", target: farm.id },
      );
      step(w);
      expect(
        new Set(party.map((v) => JSON.stringify(v.path.at(-1)))).size,
      ).toBe(3);
      for (const v of party) {
        expect(buildingAt(w, v.path.at(-1)!.x, v.path.at(-1)!.z)?.id).toBe(
          farm.id,
        );
        const allowed = routeWalkable(w, v, farm.id);
        expect(
          v.path.every((p) => allowed(Math.floor(p.x), Math.floor(p.z))),
        ).toBe(true);
      }
      until(w, () => party.every((v) => v.cargo?.kind === "food"));
      expect(
        new Set(party.map((v) => `${Math.floor(v.x)},${Math.floor(v.z)}`)).size,
      ).toBe(3);
      expect(party.every((v) => buildingAt(w, v.x, v.z)?.id === farm.id)).toBe(
        true,
      );
      expect(party.every((v) => v.path.length === 0)).toBe(true);
      const food = w.stock.food;
      ticks(w, 400);
      expect(w.stock.food).toBeGreaterThan(food);
      expect(farm.progress).toBe(1); // Renewable paddies do not exhaust like resource nodes.
    },
  );

  it("does not grant public shortcuts, unfinished-paddy access or access to solid buildings", () => {
    const { w, farm, v } = fixture();
    const goal = { x: farm.x + 1, z: farm.z + 1 };
    expect(walkable(w, goal.x, goal.z)).toBe(false);
    expect(findPath(w, v, [goal])).toBeNull();
    expect(
      applyCommand(w, {
        type: "order",
        ids: [v.id],
        order: { type: "move", target: goal },
      }).ok,
    ).toBe(false);
    expect(findPath(w, v, [goal], farm.id)).not.toBeNull();
    const hall = w.buildings[0];
    expect(findPath(w, v, [{ x: hall.x, z: hall.z }], hall.id)).toBeNull();
    farm.progress = 0.5;
    expect(farmWorkSpots(w, farm)).toEqual([]);
    expect(findPath(w, v, [goal], farm.id)).toBeNull();
    farm.progress = 1;
    expect(findPath(w, v, [goal], farm.id)).not.toBeNull();
  });

  it("uses rotated dimensions and rejects water, resources, overlaps and out-of-map spots", () => {
    const { w, farm, v } = fixture(1);
    const original = BUILDINGS.farm.size;
    try {
      BUILDINGS.farm.size = [2, 3]; // Exercise a rectangular footprint as well as today's square paddy.
      expect(dimensions(farm)).toEqual([3, 2]);
      expect(farmWorkSpots(w, farm)).toHaveLength(6);
      w.terrain[cell(w, farm.x, farm.z)] = 1;
      w.nodes.push({
        id: w.nextId++,
        x: farm.x + 1,
        z: farm.z,
        kind: "stone",
        amount: 1,
        variant: 0,
      });
      w.buildings.push({
        id: w.nextId++,
        kind: "store",
        x: farm.x + 2,
        z: farm.z,
        rotation: 0,
        progress: 1,
      });
      invalidateNavigation(w);
      const spots = farmWorkSpots(w, farm);
      expect(spots).toEqual([
        { x: farm.x, z: farm.z + 1 },
        { x: farm.x + 1, z: farm.z + 1 },
      ]);
      const allowed = routeWalkable(w, v, farm.id);
      expect(allowed(farm.x, farm.z)).toBe(false);
      expect(allowed(farm.x + 1, farm.z)).toBe(false);
      expect(allowed(farm.x + 2, farm.z)).toBe(false);
      farm.x = w.size - 1;
      farm.z = w.size - 1;
      invalidateNavigation(w);
      expect(farmWorkSpots(w, farm)).toEqual([
        { x: w.size - 1, z: w.size - 1 },
      ]);
    } finally {
      BUILDINGS.farm.size = original;
    }
  });

  it("waits for occupied/reserved work spots without stacking or harvesting from outside", () => {
    const { w, farm, v } = fixture();
    const spots = farmWorkSpots(w, farm);
    for (const [i, other] of w.villagers.slice(1).entries()) {
      other.x = spots[i].x + 0.5;
      other.z = spots[i].z + 0.5;
    }
    // One worker is still en route to the last spot, which must also be reserved.
    const last = w.villagers.at(-1)!;
    last.path = [{ x: last.x, z: last.z }];
    last.x = 25.5;
    order(w, [v.id], { type: "work", target: farm.id });
    step(w);
    expect(v.task).toBe("Route blocked");
    expect(v.path).toEqual([]);
    expect(v.cargo).toBeNull();
    last.path = [];
    last.x = 26.5;
    until(w, () => !!v.cargo);
    expect(buildingAt(w, v.x, v.z)?.id).toBe(farm.id);
  });

  it("does not teleport across a sealed perimeter and retries when access opens", () => {
    const { w, farm, v } = fixture();
    for (let x = farm.x - 1; x <= farm.x + 3; x++)
      for (let z = farm.z - 1; z <= farm.z + 3; z++)
        if (x < farm.x || x >= farm.x + 3 || z < farm.z || z >= farm.z + 3)
          w.terrain[cell(w, x, z)] = 1;
    invalidateNavigation(w);
    const start = { x: v.x, z: v.z };
    order(w, [v.id], { type: "work", target: farm.id });
    ticks(w, 40);
    expect({ x: v.x, z: v.z }).toEqual(start);
    expect(v.cargo).toBeNull();
    w.terrain[cell(w, farm.x - 1, farm.z + 1)] = 0;
    invalidateNavigation(w);
    until(w, () => !!v.cargo);
  });

  it("leaves the center on a direct move with cargo, preserving obstacle detours and placement access", () => {
    const { w, farm, v } = fixture();
    // Start at the deepest work spot, as can happen in a saved village.
    v.x = farm.x + 1.5;
    v.z = farm.z + 1.5;
    v.cargo = { kind: "food", amount: 3 };
    expect(placementError(w, "house", 5, 5, 0)).toBeNull();
    w.nodes.push({
      id: w.nextId++,
      x: farm.x - 1,
      z: farm.z + 1,
      kind: "stone",
      amount: 50,
      variant: 0,
    });
    invalidateNavigation(w);
    order(w, [v.id], { type: "move", target: { x: 20, z: 20 } });
    step(w);
    const path = structuredClone(v.path);
    expect(path.some((p) => Math.floor(p.z) !== 20)).toBe(true);
    expect(
      path.some((p) => Math.floor(p.x) === 21 && Math.floor(p.z) === 20),
    ).toBe(false);
    let previous = { x: v.x, z: v.z };
    for (let i = 0; i < 50; i++) {
      step(w);
      expect(
        Math.hypot(v.x - previous.x, v.z - previous.z),
      ).toBeLessThanOrEqual(1.25 * 0.25 + 1e-8);
      previous = { x: v.x, z: v.z };
    }
    expect(v.order.type).toBe("idle");
    expect({ x: v.x, z: v.z }).toEqual({ x: 20.5, z: 20.5 });
    expect(v.cargo).toEqual({ kind: "food", amount: 3 });
  });

  it.each(["approach", "working", "hauling"])(
    "round-trips and resumes %s without new save fields",
    (phase) => {
      const { w, farm, v } = fixture();
      order(w, [v.id], { type: "work", target: farm.id });
      step(w);
      if (phase === "working") until(w, () => !!v.cargo);
      if (phase === "hauling") until(w, () => v.task === "Hauling food");
      const restored = deserialize(serialize(w));
      expect(restored).toEqual(w);
      ticks(w, 200);
      ticks(restored, 200);
      expect(restored).toEqual(w);
    },
  );

  it.each(["approach", "working", "hauling"])(
    "handles paddy demolition while %s and preserves cargo",
    (phase) => {
      const { w, farm, v } = fixture();
      order(w, [v.id], { type: "work", target: farm.id });
      step(w);
      if (phase === "working") until(w, () => !!v.cargo);
      if (phase === "hauling") until(w, () => v.task === "Hauling food");
      const cargo = structuredClone(v.cargo);
      expect(applyCommand(w, { type: "demolish", id: farm.id }).ok).toBe(true);
      expect(v.path).toEqual([]);
      expect(v.order.type).toBe("idle");
      expect(v.cargo).toEqual(cargo);
      order(w, [v.id], { type: "move", target: { x: 20, z: 20 } });
      until(w, () => v.order.type === "idle");
      expect(v.x).toBe(20.5);
    },
  );

  it("invalidates a blocked approach and can exit a paddy whose completion changed", () => {
    const { w, farm, v } = fixture();
    order(w, [v.id], { type: "work", target: farm.id });
    step(w);
    const next = v.path[0];
    w.nodes.push({
      id: w.nextId++,
      x: Math.floor(next.x),
      z: Math.floor(next.z),
      kind: "stone",
      amount: 50,
      variant: 0,
    });
    invalidateNavigation(w);
    step(w);
    expect(v.path).toEqual([]);
    expect(v.x).toBe(20.5);
    until(w, () => !!v.cargo);
    v.x = farm.x + 1.5;
    v.z = farm.z + 1.5;
    farm.progress = 0.5;
    step(w);
    expect(v.order.type).toBe("idle");
    order(w, [v.id], { type: "move", target: { x: 20, z: 20 } });
    until(w, () => v.order.type === "idle");
    expect(v.x).toBe(20.5);
  });

  it("reassigns from rice to an exhaustible resource, delivers both loads and stands by", () => {
    const { w, farm, v } = fixture();
    order(w, [v.id], { type: "work", target: farm.id });
    until(w, () => !!v.cargo);
    const food = w.stock.food;
    const wood = w.stock.wood;
    const node = {
      id: w.nextId++,
      kind: "wood" as const,
      x: 20,
      z: 16,
      amount: 2,
      variant: 0,
    };
    w.nodes.push(node);
    invalidateNavigation(w);
    order(w, [v.id], { type: "gather", target: node.id });
    until(w, () => v.order.type === "idle");
    expect(node.amount).toBe(0);
    expect(v.cargo).toBeNull();
    expect(w.stock.food).toBeGreaterThan(food);
    expect(w.stock.wood).toBe(wood + 2);
    expect(walkable(w, node.x, node.z)).toBe(true);
  });

  it("selects reachable paddy interiors for automatic work", () => {
    const { w, farm, v } = fixture();
    w.stock.food = 20;
    v.auto = true;
    order(w, [v.id], { type: "auto" });
    until(w, () => !!v.cargo);
    expect(v.order).toEqual({ type: "work", target: farm.id });
    expect(buildingAt(w, v.x, v.z)?.id).toBe(farm.id);
  });

  it("shows the actual interior route and raises its endpoint above the paddy surface", () => {
    const { w, farm, v } = fixture();
    order(w, [v.id], { type: "work", target: farm.id });
    step(w);
    expect(plannedRoute(v)).toEqual([v, ...v.path]);
    const end = v.path.at(-1)!;
    expect(buildingAt(w, end.x, end.z)?.id).toBe(farm.id);
    expect(paddyHeight(w, end)).toBe(0.15);
    const overlay = new PlannedPaths();
    overlay.update(w, new Set([v.id]));
    const mesh = overlay.children[0] as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    expect(mesh.count).toBeGreaterThan(4);
    for (let i = 0; i < 4; i++) {
      mesh.getMatrixAt(i, matrix);
      const p = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(p.y).toBeCloseTo(0.175);
    }
    order(w, [v.id], { type: "idle" });
    overlay.update(w, new Set([v.id]));
    expect(mesh.count).toBe(0);
    overlay.dispose();
  });
});
