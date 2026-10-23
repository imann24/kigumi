import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEntities } from "../src/game/scene-entities";
import { createWorld } from "../src/simulation/engine";
import { deserialize, serialize } from "../src/simulation/save";
import { recordWork } from "../src/simulation/work-activity";

const entities = new SceneEntities();
afterEach(() => entities.reset());
const world = () => {
  const w = createWorld(42);
  w.villagers = w.villagers.slice(0, 1);
  w.nodes = w.nodes.slice(0, 1);
  return w;
};
const mesh = (model: THREE.Object3D) => {
  let result: THREE.Mesh | undefined;
  model.traverse((o) => {
    if (!result && o instanceof THREE.Mesh) result = o;
  });
  return result!;
};

describe("scene entity lifecycle", () => {
  it("reuses live models, updates cargo/construction and leaves simulation state untouched", () => {
    const w = world();
    entities.sync(w);
    const v = w.villagers[0],
      b = w.buildings[0];
    const villager = entities.getModel(`villager:${v.id}`)!;
    const building = entities.getModel(`building:${b.id}`)!;
    v.cargo = { kind: "wood", amount: 4 };
    b.progress = 0.4;
    const before = structuredClone(w);
    entities.sync(w);
    entities.animate(w, 0.5, 0.1);
    expect(entities.getModel(`villager:${v.id}`)).toBe(villager);
    expect(entities.getModel(`building:${b.id}`)).toBe(building);
    expect(villager.getObjectByName("cargo")!.visible).toBe(true);
    expect(building.scale.y).toBeCloseTo(0.49);
    expect(building.getObjectByName("roof")!.visible).toBe(false);
    expect(w).toEqual(before);
    v.cargo = null;
    b.progress = 1;
    entities.sync(w);
    expect(villager.getObjectByName("cargo")!.visible).toBe(false);
    expect(building.getObjectByName("roof")!.visible).toBe(true);
  });

  it("interpolates from the last fixed step and freezes the pose when paused", () => {
    const w = world(),
      v = w.villagers[0];
    v.x = 1;
    v.z = 1;
    entities.sync(w);
    entities.captureMovement(w);
    v.x = 2;
    entities.captureMovement(w);
    v.x = 3;
    entities.animate(w, 0.25, 0.1);
    const model = entities.getModel(`villager:${v.id}`)!;
    expect(model.position.x).toBe(2.25);
    const leg = model.getObjectByName("left-leg")!;
    expect(leg.rotation.x).not.toBe(0);
    const paused = [
      model.position.toArray(),
      model.rotation.toArray(),
      leg.rotation.toArray(),
    ];
    entities.animate(w, 0.25, 0);
    expect([
      model.position.toArray(),
      model.rotation.toArray(),
      leg.rotation.toArray(),
    ]).toEqual(paused);
  });

  it("clears removed villagers' interpolation and pose state before reusing an id", () => {
    const w = world(),
      v = w.villagers[0];
    entities.sync(w);
    entities.captureMovement(w);
    v.x += 1;
    entities.animate(w, 0.5, 0.1);
    const old = entities.getModel(`villager:${v.id}`)!;
    entities.sync({ ...w, villagers: [] });
    expect(old.parent).toBeNull();
    expect(entities.getModel(`villager:${v.id}`)).toBeUndefined();
    v.x = 2;
    v.z = 2;
    entities.sync(w);
    entities.animate(w, 0.25, 0);
    const replacement = entities.getModel(`villager:${v.id}`)!;
    expect(replacement).not.toBe(old);
    expect(replacement.position.toArray()).toEqual([2, 0, 2]);
    expect(replacement.getObjectByName("left-leg")!.rotation.x).toBeCloseTo(0);
  });

  it.each([
    ["chop", "axe"],
    ["mine", "pickaxe"],
    ["pick", null],
    ["tend", null],
    ["craft", "mallet"],
  ] as const)(
    "renders and pauses %s work, then fades stale activity",
    (kind, tool) => {
      const w = world(),
        v = w.villagers[0];
      const target =
        kind === "tend" || kind === "craft"
          ? w.buildings.find((b) => b.kind === "farm")!
          : w.nodes[0];
      v.path = [];
      v.blocked = 0;
      v.task = "Working";
      recordWork(w, v, kind, target);
      const before = structuredClone(w);
      entities.sync(w);
      entities.animate(w, 1, 0.25);
      const model = entities.getModel(`villager:${v.id}`)!;
      const upper = model.getObjectByName("upper-body")!;
      expect(upper.rotation.x).toBeGreaterThan(0);
      for (const name of ["axe", "pickaxe", "mallet"])
        expect(model.getObjectByName(name)!.visible).toBe(name === tool);
      const pose = upper.rotation.toArray();
      entities.animate(w, 1, 0);
      expect(upper.rotation.toArray()).toEqual(pose);
      expect(w).toEqual(before);
      w.tick++;
      entities.animate(w, 1, 1);
      expect(upper.rotation.x).toBeLessThan(0.001);
      for (const name of ["axe", "pickaxe", "mallet"])
        expect(model.getObjectByName(name)!.visible).toBe(false);
    },
  );

  it.each(["depletion", "reset", "expiry"] as const)(
    "restores pulse materials on %s",
    (end) => {
      const w = world(),
        n = w.nodes[0];
      entities.sync(w);
      const model = entities.getModel(`resource:${n.id}`)!;
      const part = mesh(model),
        original = part.material;
      entities.flashResource(n.id, 100);
      const copy = part.material as THREE.Material;
      const dispose = vi.spyOn(copy, "dispose");
      expect(copy).not.toBe(original);
      entities.updatePulses(220);
      if (end === "depletion") {
        n.amount = 0;
        entities.sync(w);
        expect(model.parent).toBeNull();
        expect(entities.getModel(`resource:${n.id}`)).toBeUndefined();
      } else if (end === "reset") entities.reset();
      else entities.updatePulses(750);
      expect(part.material).toBe(original);
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

  it("rebuilds a loaded world with reused ids without carrying visual state across saves", () => {
    const w = world(),
      v = w.villagers[0];
    entities.sync(w);
    entities.captureMovement(w);
    v.x += 2;
    entities.animate(w, 0.5, 0.25);
    const old = entities.children.slice();
    const loaded = deserialize(serialize(w));
    loaded.villagers[0].x = 1;
    loaded.villagers[0].z = 1;
    entities.reset();
    expect(entities.children).toEqual([]);
    expect(old.every((o) => o.parent === null)).toBe(true);
    entities.sync(loaded);
    entities.animate(loaded, 0, 0);
    expect(entities.getModel(`villager:${v.id}`)!.position.toArray()).toEqual([
      1, 0, 1,
    ]);
    expect(entities.children.some((o) => old.includes(o))).toBe(false);
  });
});
