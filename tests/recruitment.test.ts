import { describe, expect, it } from "vitest";
import { productionMarkup } from "../src/game/production";
import {
  RECRUIT_COST,
  RECRUIT_DURATION,
  RECRUIT_QUEUE_LIMIT,
} from "../src/simulation/catalog";
import {
  applyCommand,
  createWorld,
  recruitCount,
  STEP,
  step,
} from "../src/simulation/engine";
import {
  cell,
  dimensions,
  invalidateNavigation,
  perimeter,
} from "../src/simulation/grid";
import { deserialize, serialize } from "../src/simulation/save";
import type { World } from "../src/simulation/types";

function village() {
  const w = createWorld(42);
  for (const v of w.villagers) {
    v.auto = false;
    v.order = { type: "idle" };
  }
  w.config.foodConsumption = 0;
  w.stock.food = 10000;
  return w;
}
function advance(w: World, seconds: number) {
  for (let t = 0; t < seconds / STEP; t++) step(w);
}
function queue(w: World, count: number) {
  for (let i = 0; i < count; i++)
    expect(applyCommand(w, { type: "recruit" }).ok).toBe(true);
}

describe("paid villager queue", () => {
  it("charges once per order, never restarts active work, and serves each entry for twelve seconds", () => {
    const w = village(),
      food = w.stock.food;
    queue(w, 1);
    advance(w, 6);
    queue(w, 2);
    expect(w.recruit).toBe(6);
    expect(w.recruitQueue).toBe(2);
    expect(w.stock.food).toBe(food - RECRUIT_COST * 3);
    advance(w, 6);
    expect(w.villagers).toHaveLength(11);
    expect(w.recruit).toBe(0);
    expect(w.recruitQueue).toBe(1);
    advance(w, RECRUIT_DURATION - STEP);
    expect(w.villagers).toHaveLength(11);
    step(w);
    expect(w.villagers).toHaveLength(12);
    expect(w.recruit).toBe(0);
    expect(w.recruitQueue).toBe(0);
    advance(w, RECRUIT_DURATION);
    expect(w.villagers).toHaveLength(13);
    expect(w.recruit).toBeNull();
    expect(recruitCount(w)).toBe(0);
    expect(w.stock.food).toBe(food - RECRUIT_COST * 3);
  });

  it("rejects repeated orders once food is exhausted without changing paid orders", () => {
    const w = village();
    w.stock.food = RECRUIT_COST * 2 + 1;
    queue(w, 2);
    const before = structuredClone(w);
    for (let i = 0; i < 10; i++) {
      expect(applyCommand(w, { type: "recruit" })).toEqual({
        ok: false,
        message: `You need ${RECRUIT_COST} food to welcome a villager.`,
      });
      expect(w).toEqual(before);
    }
    advance(w, RECRUIT_DURATION * 2);
    expect(w.villagers).toHaveLength(12);
    expect(w.stock.food).toBe(1);
  });

  it.each(["housing", "population"] as const)(
    "reserves every queued place against the %s limit",
    (limit) => {
      const w = village();
      const available = limit === "housing" ? 10 : 2;
      if (limit === "population") w.config.maxPopulation = 12;
      queue(w, available);
      const before = structuredClone(w);
      expect(applyCommand(w, { type: "recruit" }).message).toContain(
        "reserved",
      );
      expect(w).toEqual(before);
      advance(w, RECRUIT_DURATION);
      // An arrival consumes its reserved place; it does not free another order slot.
      expect(applyCommand(w, { type: "recruit" }).message).toContain(
        "reserved",
      );
      expect(recruitCount(w)).toBe(available - 1);
    },
  );

  it("enforces the queue limit even when housing, population and food allow more", () => {
    const w = village();
    for (let i = 0; i < 4; i++)
      w.buildings.push({
        id: w.nextId++,
        kind: "house",
        progress: 1,
        rotation: 0,
        x: 2 + i * 4,
        z: 2,
      });
    invalidateNavigation(w);
    queue(w, RECRUIT_QUEUE_LIMIT);
    const before = structuredClone(w);
    expect(applyCommand(w, { type: "recruit" }).message).toContain(
      "queue full",
    );
    expect(w).toEqual(before);
    const markup = productionMarkup(w, w.buildings[0].id, false)!;
    expect(markup.queue.match(/<li>/g)).toHaveLength(RECRUIT_QUEUE_LIMIT - 1);
    expect(markup.queue).toContain('start="2"');
    expect(markup.queue).toContain('tabindex="0"');
    expect(markup.welcome).toContain(`20 / ${RECRUIT_QUEUE_LIMIT}`);
    advance(w, RECRUIT_DURATION);
    queue(w, 1);
    expect(recruitCount(w)).toBe(RECRUIT_QUEUE_LIMIT);
  });

  it("preserves all paid entries across lowered caps, demolished housing and restored capacity", () => {
    const w = village();
    queue(w, 3);
    applyCommand(w, { type: "config", maxPopulation: 10 });
    const houses = w.buildings.filter((b) => b.kind === "house");
    for (const house of houses)
      expect(applyCommand(w, { type: "demolish", id: house.id }).ok).toBe(true);
    advance(w, 60);
    expect(w.recruit).toBe(RECRUIT_DURATION);
    expect(w.recruitQueue).toBe(2);
    expect(w.villagers).toHaveLength(10);
    const restored = deserialize(serialize(w));
    expect(recruitCount(restored)).toBe(3);
    restored.buildings.push(...houses);
    invalidateNavigation(restored);
    applyCommand(restored, { type: "config", maxPopulation: 20 });
    step(restored);
    expect(restored.villagers).toHaveLength(11);
    expect(restored.recruit).toBe(0);
    advance(restored, RECRUIT_DURATION * 2);
    expect(restored.villagers).toHaveLength(13);
    expect(recruitCount(restored)).toBe(0);
  });

  it("does not consume waiting entries while the hall's spawn perimeter is blocked", () => {
    const w = village(),
      hall = w.buildings[0];
    const spaces = perimeter(w, hall, ...dimensions(hall));
    queue(w, 3);
    for (const p of spaces) w.terrain[cell(w, p.x, p.z)] = 1;
    invalidateNavigation(w);
    advance(w, 60);
    expect(w.villagers).toHaveLength(10);
    expect(recruitCount(w)).toBe(3);
    expect(w.recruit).toBe(RECRUIT_DURATION);
    w.terrain[cell(w, spaces[0].x, spaces[0].z)] = 0;
    invalidateNavigation(w);
    step(w);
    expect(w.recruitQueue).toBe(1);
    expect(w.recruit).toBe(0);
    advance(w, RECRUIT_DURATION * 2);
    expect(w.villagers).toHaveLength(13);
    expect(recruitCount(w)).toBe(0);
  });

  it("cannot dismantle the hall and lose or refund paid orders", () => {
    const w = village();
    queue(w, 3);
    const before = structuredClone(w);
    expect(
      applyCommand(w, { type: "demolish", id: w.buildings[0].id }).ok,
    ).toBe(false);
    expect(w).toEqual(before);
  });

  it("round-trips active progress, FIFO waiting count and independent research deterministically", () => {
    const w = village();
    w.stock.insight = 100;
    queue(w, 4);
    expect(applyCommand(w, { type: "research", id: "joinery" }).ok).toBe(true);
    advance(w, 5);
    const restored = deserialize(serialize(w));
    expect(restored).toEqual(w);
    for (let i = 0; i < 200; i++) {
      step(w);
      step(restored);
      expect(restored).toEqual(w);
    }
    expect(w.villagers).toHaveLength(14);
    expect(w.techs).toContain("joinery");
    expect(recruitCount(w)).toBe(0);
  });

  it.each([null, 0, 6, 18])(
    "migrates legacy v1 saves with active progress %s without charging again",
    (progress) => {
      const w = village();
      w.recruit = progress;
      const data = JSON.parse(serialize(w));
      delete data.world.recruitQueue;
      const restored = deserialize(JSON.stringify(data));
      expect(restored.recruit).toBe(progress);
      expect(restored.recruitQueue).toBe(0);
      expect(restored.stock).toEqual(w.stock);
      advance(restored, RECRUIT_DURATION);
      expect(restored.villagers).toHaveLength(progress === null ? 10 : 11);
    },
  );

  it.each([-1, 0.5, 20, 10000, null, "2", [], {}])(
    "rejects malformed waiting counts: %j",
    (count) => {
      const w = village();
      queue(w, 1);
      const data = JSON.parse(serialize(w));
      data.world.recruitQueue = count;
      expect(() => deserialize(JSON.stringify(data))).toThrow();
    },
  );

  it("rejects orphaned waiting orders without active production", () => {
    const w = village();
    w.recruitQueue = 1;
    expect(() => deserialize(serialize(w))).toThrow();
  });
});
