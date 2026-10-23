import { describe, expect, it } from "vitest";
import {
  contextualCursor,
  contextualOrder,
} from "../src/game/contextual-actions";
import {
  applyCommand,
  createWorld,
  orderError,
  placementError,
  step,
} from "../src/simulation/engine";
import {
  cell,
  farmWorkSpots,
  invalidateNavigation,
  perimeter,
  dimensions,
} from "../src/simulation/grid";
import type { Building, Order } from "../src/simulation/types";

function clearing() {
  const w = createWorld();
  w.terrain.fill(0);
  w.nodes = [
    { id: w.nextId++, kind: "wood", x: 5, z: 5, amount: 100, variant: 0 },
  ];
  w.roads = [];
  w.bridges = [];
  w.buildings = [w.buildings[0]];
  w.stock = { wood: 10000, food: 10000, stone: 10000, insight: 10000 };
  w.villagers.forEach((v) => {
    v.order = { type: "idle" };
    v.auto = false;
  });
  invalidateNavigation(w);
  return w;
}

describe("contextual actions share picking and command eligibility", () => {
  it.each(["wood", "stone", "food"] as const)(
    "advertises and dispatches %s gathering without mutating the preview",
    (kind) => {
      const w = clearing();
      w.nodes[0].kind = kind;
      const hit = { type: "resource", id: w.nodes[0].id } as const;
      const ids = [w.villagers[0].id];
      const before = structuredClone(w);
      expect(contextualCursor(w, ids, hit, null)).toBe(kind);
      expect(w).toEqual(before);
      const order = contextualOrder(w, hit, { x: 30, z: 30 })!;
      expect(order).toEqual({ type: "gather", target: hit.id });
      expect(applyCommand(w, { type: "order", ids, order }).ok).toBe(true);
      expect(w.villagers[0].order).toEqual(order);
      w.nodes[0].amount = 0;
      expect(contextualCursor(w, ids, hit, null)).toBeNull();
      w.nodes = [];
      expect(contextualCursor(w, ids, hit, null)).toBeNull();
    },
  );

  it("requires a live selection and reachable approach, including mixed groups", () => {
    const w = clearing();
    const hit = { type: "resource", id: w.nodes[0].id } as const;
    expect(contextualCursor(w, [], hit, null)).toBeNull();
    expect(contextualCursor(w, [-1], hit, null)).toBeNull();
    Object.assign(w.villagers[0], { x: 1.5, z: 1.5 });
    for (let z = 0; z < w.size; z++) w.terrain[cell(w, 3, z)] = 1;
    invalidateNavigation(w);
    expect(contextualCursor(w, [w.villagers[0].id], hit, null)).toBeNull();
    expect(
      contextualCursor(
        w,
        w.villagers.slice(0, 2).map((v) => v.id),
        hit,
        null,
      ),
    ).toBe("wood");
  });

  it.each(["house", "farm", "workshop"] as const)(
    "updates construction and completed %s semantics",
    (kind) => {
      const w = clearing();
      const b: Building = {
        id: w.nextId++,
        kind,
        x: 5,
        z: 9,
        rotation: 1,
        progress: 0.5,
      };
      w.buildings.push(b);
      invalidateNavigation(w);
      const hit = { type: "building", id: b.id } as const;
      const ids = [w.villagers[0].id];
      expect(contextualOrder(w, hit, null)).toEqual({
        type: "build",
        target: b.id,
      });
      expect(contextualCursor(w, ids, hit, null)).toBe("build");
      b.progress = 1;
      expect(contextualCursor(w, ids, hit, null)).toBe(
        kind === "house" ? null : kind === "farm" ? "farm" : "craft",
      );
      if (kind !== "house") {
        const order = contextualOrder(w, hit, null)!;
        expect(applyCommand(w, { type: "order", ids, order }).ok).toBe(true);
        // An existing worker can be reassigned; the whole group must fit.
        expect(contextualCursor(w, ids, hit, null)).not.toBeNull();
        const tooMany = w.villagers
          .slice(0, kind === "farm" ? 4 : 3)
          .map((v) => v.id);
        expect(contextualCursor(w, tooMany, hit, null)).toBeNull();
        expect(
          applyCommand(w, { type: "order", ids: tooMany, order }).message,
        ).toBe(orderError(w, tooMany, order));
        const occupants = w.villagers.slice(1, kind === "farm" ? 4 : 3);
        for (const v of occupants) v.order = { type: "work", target: b.id };
        expect(contextualCursor(w, ids, hit, null)).toBeNull();
      }
      w.buildings.pop();
      expect(contextualCursor(w, ids, hit, null)).toBeNull();
    },
  );

  it.each(["inside", "approaching"] as const)(
    "uses the real paddy route for a farmer %s the footprint",
    (position) => {
      const w = clearing();
      const farm: Building = {
        id: w.nextId++,
        kind: "farm",
        x: 5,
        z: 9,
        rotation: 0,
        progress: 1,
      };
      w.buildings.push(farm);
      const worker = w.villagers[0];
      Object.assign(
        worker,
        position === "inside" ? { x: 6.5, z: 10.5 } : { x: 4.5, z: 10.5 },
      );
      if (position === "inside") {
        // No perimeter is reachable, but the current interior work spot is valid.
        for (const p of perimeter(w, farm, ...dimensions(farm)))
          w.terrain[cell(w, p.x, p.z)] = 1;
      }
      invalidateNavigation(w);
      const hit = { type: "building", id: farm.id } as const;
      const ids = [worker.id];
      expect(contextualCursor(w, ids, hit, null)).toBe("farm");
      const order = contextualOrder(w, hit, null)!;
      expect(applyCommand(w, { type: "order", ids, order }).ok).toBe(true);
      step(w);
      const endpoint = worker.path.at(-1) ?? worker;
      expect(farmWorkSpots(w, farm)).toContainEqual({
        x: Math.floor(endpoint.x),
        z: Math.floor(endpoint.z),
      });
      expect(contextualCursor(w, ids, hit, null)).toBe("farm");
      for (let i = 0; i < 32; i++) step(w);
      expect(worker.cargo?.kind).toBe("food");
      expect(worker.cargo!.amount).toBeGreaterThan(0);
      expect(contextualCursor(w, ids, hit, null)).toBe("farm");
    },
  );

  it("rejects a paddy when only its diagonal perimeter corners are reachable", () => {
    const w = clearing();
    const farm: Building = {
      id: w.nextId++,
      kind: "farm",
      x: 5,
      z: 9,
      rotation: 0,
      progress: 1,
    };
    w.buildings.push(farm);
    const [width, depth] = dimensions(farm);
    for (const p of perimeter(w, farm, width, depth)) {
      const corner =
        (p.x === farm.x - 1 || p.x === farm.x + width) &&
        (p.z === farm.z - 1 || p.z === farm.z + depth);
      if (!corner) w.terrain[cell(w, p.x, p.z)] = 1;
    }
    const worker = w.villagers[0];
    Object.assign(worker, { x: farm.x - 0.5, z: farm.z - 0.5 });
    invalidateNavigation(w);
    expect(perimeter(w, farm, width, depth)).toHaveLength(4);
    expect(perimeter(w, farm, width, depth)).toContainEqual({
      x: Math.floor(worker.x),
      z: Math.floor(worker.z),
    });
    const hit = { type: "building", id: farm.id } as const;
    expect(contextualCursor(w, [worker.id], hit, null)).toBeNull();
    applyCommand(w, {
      type: "order",
      ids: [worker.id],
      order: contextualOrder(w, hit, null)!,
    });
    step(w);
    expect(worker.task).toBe("Route blocked");
    expect(worker.cargo).toBeNull();
  });

  it.each(["blocked", "occupied", "reserved"] as const)(
    "does not advertise paddy work when interior spots are %s",
    (reason) => {
      const w = clearing();
      const farm: Building = {
        id: w.nextId++,
        kind: "farm",
        x: 5,
        z: 9,
        rotation: 0,
        progress: 1,
      };
      w.buildings.push(farm);
      invalidateNavigation(w);
      const spots = farmWorkSpots(w, farm);
      for (const [i, p] of spots.entries()) {
        if (reason === "blocked")
          w.nodes.push({
            id: w.nextId++,
            kind: "stone",
            ...p,
            amount: 100,
            variant: 0,
          });
        else if (reason === "occupied")
          Object.assign(w.villagers[i + 1], { x: p.x + 0.5, z: p.z + 0.5 });
        else w.villagers[i + 1].path = [{ x: p.x + 0.5, z: p.z + 0.5 }];
      }
      invalidateNavigation(w);
      expect(perimeter(w, farm, ...dimensions(farm)).length).toBeGreaterThan(0);
      expect(
        contextualCursor(
          w,
          [w.villagers[0].id],
          { type: "building", id: farm.id },
          null,
        ),
      ).toBeNull();
    },
  );

  it("leaves movement and non-action buildings on the normal cursor", () => {
    const w = clearing();
    const ids = [w.villagers[0].id];
    const p = { x: 1.5, z: 1.5 };
    for (const hit of [null, { type: "villager", id: ids[0] } as const]) {
      expect(contextualOrder(w, hit, p)).toEqual({ type: "move", target: p });
      expect(contextualCursor(w, ids, hit, p)).toBeNull();
    }
    expect(
      contextualOrder(w, { type: "building", id: w.buildings[0].id }, p),
    ).toBeUndefined();
    expect(contextualOrder(w, null, null)).toBeUndefined();
  });

  it("uses actual placement checks, with automatic builders and path modes", () => {
    const w = clearing();
    const p = { x: 1, z: 10 };
    for (const kind of ["house", "road", "bridge", "workshop"] as const)
      for (const rotation of [0, 1, 2, 3])
        expect(contextualCursor(w, [], null, p, kind, rotation)).toBe(
          placementError(w, kind, p.x, p.z, rotation) ? null : "build",
        );
    expect(contextualCursor(w, [], null, p, "house")).toBe("build");
    expect(contextualCursor(w, [], null, null, "house")).toBeNull();
    expect(contextualCursor(w, [], null, { x: -1, z: -1 }, "house")).toBeNull();
    w.stock.wood = 0;
    expect(contextualCursor(w, [], null, p, "house")).toBeNull();
  });

  it.each<Order>([
    { type: "gather", target: -1 },
    { type: "build", target: -1 },
    { type: "work", target: -1 },
    { type: "move", target: { x: -1, z: -1 } },
  ])("shares rejection messages for $type", (order) => {
    const w = clearing(),
      ids = [w.villagers[0].id];
    const before = structuredClone(w);
    expect(applyCommand(w, { type: "order", ids, order }).message).toBe(
      orderError(w, ids, order),
    );
    expect(w).toEqual(before);
  });
});
