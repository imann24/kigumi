import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { plannedRoute, PlannedPaths } from "../src/game/planned-paths";
import { applyCommand, createWorld, step } from "../src/simulation/engine";
import { cell, invalidateNavigation, walkable } from "../src/simulation/grid";
import type { Point, World } from "../src/simulation/types";

function fixture() {
  const w = createWorld(42);
  w.buildings = [];
  w.nodes = [];
  w.roads = [];
  w.bridges = [];
  w.terrain.fill(0);
  for (const v of w.villagers) {
    v.auto = false;
    v.order = { type: "idle" };
    v.path = [];
  }
  const v = w.villagers[0];
  v.x = 4.5;
  v.z = 4.5;
  invalidateNavigation(w);
  return { w, v, overlay: new PlannedPaths(), selected: new Set([v.id]) };
}

function move(w: World, ids: number[], target: Point) {
  expect(
    applyCommand(w, { type: "order", ids, order: { type: "move", target } }).ok,
  ).toBe(true);
}

function mesh(overlay: PlannedPaths) {
  return overlay.children[0] as THREE.InstancedMesh;
}

function centers(overlay: PlannedPaths) {
  const strokes = mesh(overlay),
    matrix = new THREE.Matrix4();
  return Array.from({ length: strokes.count }, (_, i) => {
    strokes.getMatrixAt(i, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
}

describe("selected planned paths", () => {
  it("uses the engine's obstacle detour, with no straight-line destination fallback", () => {
    const { w, v, overlay, selected } = fixture();
    w.nodes = [
      { id: w.nextId++, x: 6, z: 4, kind: "stone", amount: 30, variant: 0 },
    ];
    invalidateNavigation(w);
    move(w, [v.id], { x: 9, z: 4 });
    expect(plannedRoute(v)).toEqual([]); // Navigation runs on the next tick.
    step(w);
    expect(v.path.some((p) => p.z !== 4.5)).toBe(true);
    const before = JSON.stringify(w);
    const rendered = { x: 4.3, z: 4.5 };
    expect(plannedRoute(v, rendered)).toEqual([rendered, ...v.path]);
    overlay.update(w, selected, () => rendered);
    expect(mesh(overlay).count).toBeGreaterThan(4);
    for (const p of centers(overlay))
      expect(walkable(w, Math.floor(p.x), Math.floor(p.z))).toBe(true);
    expect(JSON.stringify(w)).toBe(before);
    overlay.dispose();
  });

  it("replaces the destination, hides pending navigation, and follows recalculation", () => {
    const { w, v, overlay, selected } = fixture();
    move(w, [v.id], { x: 9, z: 4 });
    step(w);
    overlay.update(w, selected);
    expect(centers(overlay)[0].x).toBeCloseTo(9.6);
    move(w, [v.id], { x: 4, z: 9 });
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(0);
    step(w);
    overlay.update(w, selected);
    expect(centers(overlay)[0].z).toBeCloseTo(9.4);

    // The same invalidation used by placement/removal: show only the replacement plan.
    v.path = [];
    w.nodes = [
      { id: w.nextId++, x: 4, z: 6, kind: "stone", amount: 30, variant: 0 },
    ];
    invalidateNavigation(w);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(0);
    step(w);
    expect(plannedRoute(v).slice(1)).toEqual(v.path);
    expect(v.path.some((p) => p.x !== 4.5)).toBe(true);
    overlay.update(w, selected);
    for (const p of centers(overlay))
      expect(walkable(w, Math.floor(p.x), Math.floor(p.z))).toBe(true);
    overlay.dispose();
  });

  it("consumes the route as movement advances and clears on arrival or stop", () => {
    const { w, v, overlay, selected } = fixture();
    move(w, [v.id], { x: 9, z: 4 });
    step(w);
    overlay.update(w, selected);
    const initialCount = mesh(overlay).count;
    for (let i = 0; i < 8; i++) step(w);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBeLessThan(initialCount);
    expect(Math.min(...centers(overlay).map((p) => p.x))).toBeGreaterThan(
      v.x + 0.6,
    );
    for (let i = 0; i < 30; i++) step(w);
    overlay.update(w, selected);
    expect(v.order.type).toBe("idle");
    expect(mesh(overlay).count).toBe(0);
    move(w, [v.id], { x: 4, z: 4 });
    step(w);
    expect(
      applyCommand(w, { type: "order", ids: [v.id], order: { type: "idle" } })
        .ok,
    ).toBe(true);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(0);
    overlay.dispose();
  });

  it("never draws a route for unreachable destinations", () => {
    const { w, v, overlay, selected } = fixture();
    for (let z = 0; z < w.size; z++) w.terrain[cell(w, 6, z)] = 1;
    invalidateNavigation(w);
    move(w, [v.id], { x: 9, z: 4 });
    step(w);
    expect(v.task).toBe("Route blocked");
    expect(plannedRoute(v)).toEqual([]);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(0);
    overlay.dispose();
  });

  it("follows a hauling leg to storage instead of the order's resource target", () => {
    const { w, v, overlay, selected } = fixture();
    w.buildings = [
      { id: w.nextId++, kind: "hall", x: 9, z: 9, rotation: 0, progress: 1 },
    ];
    const node = {
      id: w.nextId++,
      x: 2,
      z: 2,
      kind: "wood" as const,
      amount: 50,
      variant: 0,
    };
    w.nodes = [node];
    v.order = { type: "gather", target: node.id };
    v.cargo = { kind: "wood", amount: 8 };
    invalidateNavigation(w);
    step(w);
    expect(v.task).toBe("Hauling wood");
    const end = plannedRoute(v).at(-1)!;
    expect(end.x).toBeGreaterThan(7);
    expect(end.z).toBeGreaterThan(7);
    overlay.update(w, selected);
    expect(centers(overlay)[0].x).toBeCloseTo(end.x + 0.1);
    overlay.dispose();
  });

  it("shows every selected route and clears on deselection, removal, or world reset", () => {
    const { w, v, overlay, selected } = fixture();
    const other = w.villagers[1];
    other.x = 4.5;
    other.z = 6.5;
    move(w, [v.id, other.id], { x: 10, z: 5 });
    step(w);
    overlay.update(w, selected);
    const single = mesh(overlay).count;
    selected.add(other.id);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBeGreaterThan(single);
    selected.delete(other.id);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(single);
    overlay.clearRoutes();
    expect(mesh(overlay).count).toBe(0);
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(single);
    overlay.update(w, new Set()); // Also the existing building/resource-selection semantics.
    expect(mesh(overlay).count).toBe(0);
    w.villagers = [];
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBe(0);
    overlay.dispose();
  });

  it("keeps strokes above roads and bridges with depth testing and no extra draw calls", () => {
    const { w, v, overlay, selected } = fixture();
    w.roads = [cell(w, 5, 4)];
    w.terrain[cell(w, 6, 4)] = 1;
    w.bridges = [cell(w, 6, 4)];
    invalidateNavigation(w);
    move(w, [v.id], { x: 9, z: 4 });
    step(w);
    overlay.update(w, selected);
    for (const p of centers(overlay)) {
      if (Math.floor(p.x) === 5) expect(p.y).toBeGreaterThan(0.08);
      if (Math.floor(p.x) === 6) expect(p.y).toBeGreaterThan(0.225);
    }
    expect(overlay.children).toHaveLength(1);
    const material = mesh(overlay).material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(true);
    expect(material.transparent).toBe(false); // Shared routes do not accumulate opacity.
    const geometry = mesh(overlay).geometry;
    overlay.update(w, selected, () => ({ x: v.x + 0.1, z: v.z }));
    expect(mesh(overlay).geometry).toBe(geometry);
    overlay.dispose();
  });

  it("grows the shared instance buffer for large selections and reuses it", () => {
    const { w, overlay } = fixture();
    for (const v of w.villagers) {
      v.x = 1.5;
      v.z = 1.5;
      v.path = Array.from({ length: 35 }, (_, i) => ({ x: 2.5 + i, z: 1.5 }));
    }
    const selected = new Set(w.villagers.map((v) => v.id));
    overlay.update(w, selected);
    expect(mesh(overlay).count).toBeGreaterThan(128);
    const strokes = mesh(overlay);
    overlay.update(w, selected);
    expect(mesh(overlay)).toBe(strokes);
    expect(overlay.children).toHaveLength(1);
    overlay.dispose();
  });
});
