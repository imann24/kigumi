import { describe, it, expect } from "vitest";
import {
  applyCommand,
  capacity,
  createWorld,
  placementError,
  STEP,
  step,
} from "../src/simulation/engine";
import {
  cell,
  findPath,
  invalidateNavigation,
  perimeter,
  walkable,
} from "../src/simulation/grid";
import { deserialize, serialize } from "../src/simulation/save";
import { LocalSession } from "../src/simulation/session";
import type { World } from "../src/simulation/types";
function run(w: World, seconds: number) {
  for (let i = 0; i < seconds / STEP; i++) step(w);
}
function quiet(w: World) {
  for (const v of w.villagers) {
    v.auto = false;
    v.order = { type: "idle" };
  }
}
function rich(w: World) {
  w.stock = { wood: 10000, food: 10000, stone: 10000, insight: 10000 };
}
describe("village simulation", () => {
  it("replays a seeded world and command stream deterministically", () => {
    const a = new LocalSession(createWorld(42)),
      b = new LocalSession(createWorld(42));
    for (const s of [a, b]) s.dispatch({ type: "research", id: "joinery" });
    for (let i = 0; i < 600; i++) {
      a.advance();
      b.advance();
    }
    expect(a.world).toEqual(b.world);
    expect(a.world.techs).toContain("joinery");
  });
  it("starts with a tunable cap of 200 and housing for 20", () => {
    const w = createWorld();
    expect(w.config.maxPopulation).toBe(200);
    expect(capacity(w)).toBe(20);
    expect(applyCommand(w, { type: "config", maxPopulation: 12 }).ok).toBe(
      true,
    );
    expect(capacity(w)).toBe(12);
    expect(
      applyCommand(w, { type: "config", maxPopulation: Infinity }).ok,
    ).toBe(false);
  });
  it("rejects occupied, water, out-of-bounds and unaffordable placement without spending", () => {
    const w = createWorld(),
      stock = { ...w.stock };
    for (const [x, z] of [
      [16, 17],
      [-1, 5],
      [39, 39],
      [30, 0],
    ])
      expect(
        applyCommand(w, {
          type: "place",
          kind: "house",
          x,
          z,
          rotation: 0,
          villagers: [],
        }).ok,
      ).toBe(false);
    expect(w.stock).toEqual(stock);
    w.stock.wood = 0;
    expect(placementError(w, "house", 18, 12, 0)).toContain("resources");
  });
  it("handles rectangular rotation and completes construction with actual workers", () => {
    const w = createWorld();
    quiet(w);
    expect(
      applyCommand(w, {
        type: "place",
        kind: "house",
        x: 18,
        z: 12,
        rotation: 1,
        villagers: [w.villagers[0].id, w.villagers[1].id],
      }).ok,
    ).toBe(true);
    const b = w.buildings.at(-1)!;
    expect(capacity(w)).toBe(20);
    run(w, 70);
    expect(b.progress).toBe(1);
    expect(capacity(w)).toBe(26);
    expect(w.villagers[0].order.type).toBe("idle");
  });
  it("gathers into cargo before delivering to storage", () => {
    const w = createWorld();
    quiet(w);
    const v = w.villagers[0],
      node = w.nodes.find((n) => n.kind === "wood" && perimeter(w, n).length)!;
    const spot = perimeter(w, node)[0];
    v.x = spot.x + 0.5;
    v.z = spot.z + 0.5;
    const before = w.stock.wood;
    applyCommand(w, {
      type: "order",
      ids: [v.id],
      order: { type: "gather", target: node.id },
    });
    run(w, 3);
    expect(v.cargo?.amount).toBeGreaterThan(0);
    expect(w.stock.wood).toBe(before);
    run(w, 100);
    expect(w.stock.wood).toBeGreaterThan(before);
    expect(node.amount).toBeLessThan(100);
  });
  it("keeps explicit movement under player control when auto-work is enabled", () => {
    const w = createWorld();
    quiet(w);
    const v = w.villagers[0];
    v.auto = true;
    applyCommand(w, {
      type: "order",
      ids: [v.id],
      order: { type: "move", target: { x: 17.5, z: 22.5 } },
    });
    run(w, 20);
    expect(v.order.type).toBe("idle");
    expect(Math.floor(v.x)).toBe(17);
    expect(Math.floor(v.z)).toBe(22);
  });
  it("limits worker assignments and makes paddies produce renewable food", () => {
    const w = createWorld();
    quiet(w);
    const farm = w.buildings.find((b) => b.kind === "farm")!;
    expect(
      applyCommand(w, {
        type: "order",
        ids: w.villagers.slice(0, 4).map((v) => v.id),
        order: { type: "work", target: farm.id },
      }).ok,
    ).toBe(false);
    expect(
      applyCommand(w, {
        type: "order",
        ids: w.villagers.slice(0, 3).map((v) => v.id),
        order: { type: "work", target: farm.id },
      }).ok,
    ).toBe(true);
    const before = w.stock.food;
    run(w, 100);
    expect(w.stock.food).toBeGreaterThan(before);
  });
  it("requires both prerequisite technologies and a completed workshop", () => {
    const w = createWorld();
    quiet(w);
    rich(w);
    expect(applyCommand(w, { type: "research", id: "wheelbarrow" }).ok).toBe(
      false,
    );
    expect(applyCommand(w, { type: "research", id: "joinery" }).ok).toBe(true);
    run(w, 31);
    expect(capacity(w)).toBe(24);
    expect(applyCommand(w, { type: "research", id: "wheelbarrow" }).ok).toBe(
      false,
    );
    expect(
      applyCommand(w, {
        type: "place",
        kind: "workshop",
        x: 18,
        z: 12,
        rotation: 0,
        villagers: [w.villagers[0].id],
      }).ok,
    ).toBe(true);
    expect(applyCommand(w, { type: "research", id: "wheelbarrow" }).ok).toBe(
      false,
    );
    run(w, 90);
    expect(applyCommand(w, { type: "research", id: "wheelbarrow" }).ok).toBe(
      true,
    );
    run(w, 41);
    expect(w.techs).toContain("wheelbarrow");
  });
  it("recruits only within housing and never removes residents when the cap is lowered", () => {
    const w = createWorld();
    quiet(w);
    applyCommand(w, { type: "config", maxPopulation: 10 });
    expect(applyCommand(w, { type: "recruit" }).ok).toBe(false);
    applyCommand(w, { type: "config", maxPopulation: 11 });
    expect(applyCommand(w, { type: "recruit" }).ok).toBe(true);
    expect(applyCommand(w, { type: "recruit" }).ok).toBe(false);
    run(w, 13);
    expect(w.villagers.length).toBe(11);
    applyCommand(w, { type: "config", maxPopulation: 10 });
    run(w, 5);
    expect(w.villagers.length).toBe(11);
  });
  it("has nonlethal food shortages and bounded social metrics", () => {
    const w = createWorld();
    quiet(w);
    w.stock.food = 0;
    run(w, 300);
    expect(w.villagers).toHaveLength(10);
    expect(w.stock.food).toBe(0);
    expect(w.villagers.every((v) => v.morale >= 0 && v.morale <= 100)).toBe(
      true,
    );
    expect(Object.keys(w.relationships).length).toBeGreaterThan(0);
  });
  it("refunds half materials and cancels orders when a building is removed", () => {
    const w = createWorld();
    quiet(w);
    const farm = w.buildings.find((b) => b.kind === "farm")!,
      before = w.stock.wood;
    applyCommand(w, {
      type: "order",
      ids: [w.villagers[0].id],
      order: { type: "work", target: farm.id },
    });
    applyCommand(w, { type: "demolish", id: farm.id });
    expect(w.stock.wood).toBe(before + 15);
    expect(w.villagers[0].order.type).toBe("idle");
    expect(
      applyCommand(w, { type: "demolish", id: w.buildings[0].id }).ok,
    ).toBe(false);
  });
});
describe("grid and travel", () => {
  it("uses bridges to cross otherwise impassable water", () => {
    const w = createWorld();
    const start = { x: 25.5, z: 22.5 },
      end = { x: 34, z: 22 };
    const path = findPath(w, start, [end]);
    expect(path).not.toBeNull();
    expect(
      path!.every((p) => walkable(w, Math.floor(p.x), Math.floor(p.z))),
    ).toBe(true);
    w.bridges = [];
    invalidateNavigation(w);
    expect(findPath(w, start, [end])).toBeNull();
  });
  it("prefers a faster road route when the extra distance is worthwhile", () => {
    const w = createWorld();
    w.nodes = [];
    w.buildings = [];
    w.terrain.fill(0);
    w.roads = [];
    invalidateNavigation(w);
    for (let x = 4; x <= 15; x++) w.roads.push(cell(w, x, 6));
    const path = findPath(w, { x: 4.5, z: 7.5 }, [{ x: 15, z: 7 }])!;
    expect(path.some((p) => Math.floor(p.z) === 6)).toBe(true);
  });
  it("does not allow a building to cut off an existing building", () => {
    const w = createWorld();
    quiet(w);
    w.nodes = [];
    w.buildings = [
      w.buildings[0],
      { id: w.nextId++, kind: "store", x: 2, z: 2, rotation: 0, progress: 1 },
    ];
    w.terrain.fill(0);
    for (let z = 1; z <= 4; z++)
      for (let x = 1; x <= 4; x++)
        if (!(x >= 2 && x <= 3 && z >= 2 && z <= 3))
          w.terrain[cell(w, x, z)] = 1;
    w.terrain[cell(w, 4, 3)] = 0;
    w.bridges = [];
    w.roads = [];
    invalidateNavigation(w);
    expect(placementError(w, "house", 5, 2, 0)).toContain("route");
  });
});
describe("save files", () => {
  it("round-trips a populated village and resumes the same simulation", () => {
    const w = createWorld();
    run(w, 60);
    const restored = deserialize(serialize(w));
    expect(restored).toEqual(w);
    run(w, 30);
    run(restored, 30);
    expect(restored).toEqual(w);
  });
  it("rejects corrupt versions, nonfinite data, unknown content and oversized files", () => {
    const w = createWorld();
    const mutate = (fn: (v: any) => void) => {
      const data = JSON.parse(serialize(w));
      fn(data);
      expect(() => deserialize(JSON.stringify(data))).toThrow();
    };
    mutate((d) => (d.version = 2));
    mutate((d) => (d.world.size = 1e9));
    mutate((d) => (d.world.villagers[0].x = null));
    mutate((d) => (d.world.buildings[0].kind = "wat"));
    mutate((d) => (d.world.techs = ["not-real"]));
    mutate(
      (d) =>
        (d.world.villagers[0].order = {
          type: "move",
          target: { x: -5, z: 7 },
        }),
    );
    expect(() => deserialize("x".repeat(8_000_001))).toThrow();
  });
});

describe("population budget", () => {
  it("simulates 200 villagers without invalid state or runaway social storage", () => {
    const w = createWorld();
    const base = w.villagers[0];
    for (let i = 10; i < 200; i++)
      w.villagers.push({
        ...structuredClone(base),
        id: w.nextId++,
        name: `Neighbor ${i}`,
        x: 16.5 + (i % 4),
        z: 21.5,
        order: { type: "auto" },
        path: [],
      });
    const start = performance.now();
    run(w, 120);
    const elapsed = performance.now() - start;
    expect(w.villagers).toHaveLength(200);
    expect(
      Object.values(w.stock).every((n) => Number.isFinite(n) && n >= 0),
    ).toBe(true);
    expect(
      w.villagers.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z)),
    ).toBe(true);
    expect(Object.keys(w.relationships).length).toBeLessThan(100);
    console.info(
      `200 villagers / 480 simulation ticks: ${elapsed.toFixed(0)}ms (${(elapsed / 480).toFixed(2)}ms/tick)`,
    );
  });
});

describe("rearranging the village", () => {
  it("removes paths and refuses to remove an occupied crossing", () => {
    const w = createWorld();
    quiet(w);
    const road = w.roads[0];
    expect(
      applyCommand(w, {
        type: "removePath",
        x: road % w.size,
        z: Math.floor(road / w.size),
      }).ok,
    ).toBe(true);
    expect(w.roads).not.toContain(road);
    const bridge = w.bridges[0];
    w.villagers[0].x = (bridge % w.size) + 0.5;
    w.villagers[0].z = Math.floor(bridge / w.size) + 0.5;
    expect(
      applyCommand(w, {
        type: "removePath",
        x: bridge % w.size,
        z: Math.floor(bridge / w.size),
      }).ok,
    ).toBe(false);
    expect(w.bridges).toContain(bridge);
  });
});
