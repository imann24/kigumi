import { describe, expect, it } from "vitest";
import { productionMarkup } from "../src/game/production";
import {
  BUILDINGS,
  TECHS,
  type BuildingKind,
  type TechId,
} from "../src/simulation/catalog";
import { applyCommand, createWorld, step } from "../src/simulation/engine";
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
  w.stock = { wood: 1000, food: 1000, stone: 1000, insight: 1000 };
  return w;
}
function view(w: World, paused = false) {
  return Object.values(
    productionMarkup(
      w,
      w.buildings.find((b) => b.kind === "hall")!.id,
      paused,
    )!,
  ).join("");
}
function advance(w: World, ticks: number) {
  for (let i = 0; i < ticks; i++) step(w);
}

describe("selected hall production and research", () => {
  it("shows truthful empty states and requirements without mutating the world", () => {
    const w = village();
    const before = structuredClone(w);
    expect(view(w)).toContain("No villager on the way");
    expect(view(w)).toContain("No research in progress");
    expect(view(w)).toContain("No waiting villagers");
    expect(view(w)).not.toContain('role="progressbar"');
    expect(w).toEqual(before);
    w.stock.food = 0;
    expect(view(w)).toContain("Requires 35 food");
    w.config.maxPopulation = w.villagers.length;
    expect(view(w)).toContain("Housing or population limit reached");
  });

  it.each(
    Object.keys(BUILDINGS).filter((kind) => kind !== "hall") as BuildingKind[],
  )(
    "does not imply that %s has a queue, even during global research",
    (kind) => {
      const w = village();
      w.research = { id: "joinery", progress: 0.5 };
      const b = { ...w.buildings[0], id: w.nextId++, kind };
      w.buildings.push(b);
      expect(productionMarkup(w, b.id, false)).toBeNull();
      w.buildings.pop();
      expect(productionMarkup(w, b.id, false)).toBeNull();
    },
  );

  it("tracks an added welcome through progress, completion and the next welcome", () => {
    const w = village();
    expect(applyCommand(w, { type: "recruit" }).ok).toBe(true);
    expect(view(w)).toContain("Villager ×1");
    expect(view(w)).toContain('aria-valuenow="0"');

    advance(w, 24);
    expect(view(w)).toContain('aria-valuenow="50"');
    advance(w, 24);
    expect(w.villagers).toHaveLength(11);
    expect(view(w)).toContain("No villager on the way");
    expect(applyCommand(w, { type: "recruit" }).ok).toBe(true);
    expect(view(w)).toContain('aria-valuenow="0"');
  });

  it("shows simultaneous research and welcome as independent activities", () => {
    const w = village();
    applyCommand(w, { type: "recruit" });
    applyCommand(w, { type: "research", id: "joinery" });
    expect(applyCommand(w, { type: "research", id: "agriculture" }).ok).toBe(
      false,
    );
    advance(w, 24);
    const html = view(w);
    expect(html).toContain('aria-label="Active villager welcome"');
    expect(html).toContain('aria-label="Active village research"');
    expect(html).toContain('aria-label="Villager ×1 progress"');
    expect(html).toContain('aria-label="Timber joinery progress"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuenow="20"');
    advance(w, 24);
    expect(view(w)).toContain("No villager on the way");
    expect(view(w)).toContain("Timber joinery");
    advance(w, 74);
    expect(w.techs).toContain("joinery");
    expect(view(w)).toContain("No research in progress");
  });

  it.each(Object.keys(TECHS) as TechId[])(
    "names %s and labels its progress accessibly",
    (id) => {
      const w = village();
      w.research = { id, progress: 0.375 };
      expect(view(w)).toContain(TECHS[id].name);
      expect(view(w)).toContain('aria-valuenow="37"');
      expect(view(w)).toContain('aria-valuetext="37% · Researching"');
    },
  );

  it("marks both activities paused without changing progress and resumes the status", () => {
    const w = village();
    w.recruit = 6;
    w.research = { id: "agriculture", progress: 0.5 };
    const before = structuredClone(w);
    expect(view(w, true)).toContain("Paused · Welcoming");
    expect(view(w, true)).toContain("Paused · Researching");
    expect(view(w, true).match(/aria-valuenow="50"/g)).toHaveLength(2);
    expect(view(w)).not.toContain("Paused");
    expect(w).toEqual(before);
  });

  it("retains both progress indicators through save/load and completes normally", () => {
    const w = village();
    applyCommand(w, { type: "recruit" });
    applyCommand(w, { type: "research", id: "community" });
    advance(w, 20);
    const restored = deserialize(serialize(w));
    expect(view(restored)).toBe(view(w));
    advance(restored, 122);
    expect(restored.villagers).toHaveLength(11);
    expect(restored.techs).toContain("community");
    expect(view(restored)).toContain("No research in progress");
    expect(view(restored)).toContain("No villager on the way");
  });

  it("clamps a completed welcome while capacity blocks arrival, then clears when room opens", () => {
    const w = village();
    applyCommand(w, { type: "recruit" });
    applyCommand(w, { type: "config", maxPopulation: 10 });
    advance(w, 60);
    expect(w.recruit).toBe(12);
    expect(view(w)).toContain('aria-valuenow="100"');
    expect(view(w)).toContain(
      "Waiting for housing or a higher population limit",
    );
    expect(view(w, true)).toContain("Paused · Waiting for housing");
    const restored = deserialize(serialize(w));
    expect(view(restored)).toBe(view(w));
    applyCommand(w, { type: "config", maxPopulation: 20 });
    step(w);
    expect(view(w)).toContain("No villager on the way");
  });

  it("reflects the engine's blocked hall perimeter and recovers after access returns", () => {
    const w = village();
    const hall = w.buildings.find((b) => b.kind === "hall")!;
    const spots = perimeter(w, hall, ...dimensions(hall));
    applyCommand(w, { type: "recruit" });
    for (const p of spots) w.terrain[cell(w, p.x, p.z)] = 1;
    invalidateNavigation(w);
    advance(w, 50);
    expect(view(w)).toContain("Waiting for an open space beside the hall");
    expect(view(w)).toContain('aria-valuenow="100"');
    w.terrain[cell(w, spots[0].x, spots[0].z)] = 0;
    invalidateNavigation(w);
    step(w);
    expect(view(w)).toContain("No villager on the way");
  });
});
