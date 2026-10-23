import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  buildingModel,
  disposeGroup,
  setBuildingProgress,
} from "../src/game/art";
import { VillageScene } from "../src/game/scene";
import { MapGrid } from "../src/game/map-grid";
import { PlannedPaths } from "../src/game/planned-paths";
import { ResourcePulses } from "../src/game/resource-pulses";
import { BUILDINGS } from "../src/simulation/catalog";
import { createWorld } from "../src/simulation/engine";
import { dimensions } from "../src/simulation/grid";
import { deserialize, serialize } from "../src/simulation/save";

const roofed = ["hall", "house", "store", "workshop", "tea", "shrine"] as const;
const roofless = ["farm", "road", "bridge"] as const;
function roofs(model: THREE.Object3D) {
  const parts: THREE.Object3D[] = [];
  model.traverse((part) => {
    if (part.name === "roof") parts.push(part);
  });
  return parts;
}
function visibleMeshes(model: THREE.Object3D) {
  const parts: THREE.Mesh[] = [];
  model.traverseVisible((part) => {
    if (part instanceof THREE.Mesh) parts.push(part);
  });
  return parts;
}
// Exercise real scene synchronization/loading without a DOM or GPU renderer.
function sceneFixture() {
  const entities = new THREE.Group(),
    markers = new THREE.Group(),
    ghost = new THREE.Group();
  const scene: VillageScene = Object.assign(
    Object.create(VillageScene.prototype),
    {
      entities,
      markers,
      ghost,
      terrain: new THREE.Group(),
      paths: new THREE.Group(),
      grid: new MapGrid(),
      plannedPaths: new PlannedPaths(),
      resourcePulses: new ResourcePulses(),
      gatherPoses: new Map(),
      gatherRigs: new Map(),
      models: new Map(),
      previousPositions: new Map(),
      walkPoses: new Map(),
      selected: new Set(),
      selectedObject: null,
      pathSignature: "",
      temp: new THREE.Object3D(),
      home: vi.fn(),
    },
  );
  return { scene, entities, markers, ghost };
}

describe("construction roofs", () => {
  it("accounts for every building type in the catalog", () => {
    expect([...roofed, ...roofless].sort()).toEqual(
      Object.keys(BUILDINGS).sort(),
    );
  });

  it.each(roofed)("hides only the complete roof assemblies of %s", (kind) => {
    const model = buildingModel(kind);
    const assemblies = roofs(model);
    expect(assemblies).toHaveLength(kind === "hall" ? 2 : 1);
    const roofMeshes = assemblies.flatMap(visibleMeshes);
    // Each assembly owns the hip surface, box ridge and every tube tile line.
    for (const assembly of assemblies) {
      expect(assembly.children[0]).toBeInstanceOf(THREE.Mesh);
      expect(assembly.children[1]).toBeInstanceOf(THREE.Mesh);
      expect(assembly.children.slice(2).length).toBeGreaterThan(0);
      for (const tile of assembly.children.slice(2))
        expect((tile as THREE.Mesh).geometry).toBeInstanceOf(
          THREE.TubeGeometry,
        );
    }
    const complete = visibleMeshes(model);
    const structure = complete.filter((part) => !roofMeshes.includes(part));
    expect(structure.length).toBeGreaterThan(0);
    for (const rotation of [0, 1, 2, 3]) {
      model.rotation.y = (rotation * Math.PI) / 2;
      for (const progress of [0, 0.25, 0.5, 0.999, 1, 0.3, 1]) {
        setBuildingProgress(model, progress);
        expect(visibleMeshes(model)).toEqual(
          progress < 1 ? structure : complete,
        );
        expect(model.scale.toArray()).toEqual([1, 0.15 + progress * 0.85, 1]);
        expect(model.rotation.y).toBe((rotation * Math.PI) / 2);
      }
    }
    disposeGroup(model);
  });

  it.each(roofless)("keeps all %s parts visible", (kind) => {
    const model = buildingModel(kind);
    const complete = visibleMeshes(model);
    expect(roofs(model)).toEqual([]);
    for (const progress of [0, 0.5, 1]) {
      setBuildingProgress(model, progress);
      expect(visibleMeshes(model)).toEqual(complete);
    }
    disposeGroup(model);
  });

  it("loads partial and completed saves immediately, and resets on rebuild/removal", () => {
    const { scene, entities } = sceneFixture();
    const w = createWorld(42);
    w.nodes = [];
    w.buildings.forEach((b, i) => (b.progress = i % 2 ? 0.4 : 1));
    for (const [index, kind] of roofed.entries())
      for (const rotation of [0, 1, 2, 3])
        w.buildings.push({
          id: w.nextId++,
          kind,
          rotation,
          x: 2 + rotation * 8,
          z: 2 + index * 5,
          progress: w.buildings.length % 2 ? 0.4 : 1,
        });
    const partialSave = serialize(w);
    const check = () => {
      for (const b of w.buildings) {
        const model = entities.children.find((o) => o.userData.id === b.id)!;
        expect(model.scale.y).toBeCloseTo(0.15 + b.progress * 0.85);
        for (const roof of roofs(model))
          expect(roof.visible).toBe(b.progress >= 1);
        expect(model.rotation.y).toBe((b.rotation * Math.PI) / 2);
        const [a, c] = dimensions(b);
        expect(model.position.toArray()).toEqual([b.x + a / 2, 0, b.z + c / 2]);
      }
    };
    scene.setWorld(deserialize(partialSave));
    check();
    w.buildings.forEach((b) => (b.progress = 1));
    scene.sync(w);
    check();
    scene.setWorld(deserialize(serialize(w)));
    check();
    const removed = entities.children.find(
      (o) => o.userData.id === w.buildings[0].id,
    )!;
    scene.sync({ ...w, buildings: [] });
    expect(removed.parent).toBeNull();
    w.buildings.forEach((b) => (b.progress = 0.2));
    scene.sync(w);
    check();
    expect(entities.children).not.toContain(removed);
    scene.setWorld(deserialize(partialSave));
    w.buildings.forEach((b, i) => (b.progress = i % 2 ? 0.4 : 1));
    check();
  });

  it("keeps previews, other instances and selection footprints independent", () => {
    const { scene, entities, ghost, markers } = sceneFixture();
    const w = createWorld(42);
    const house = w.buildings.find((b) => b.kind === "house")!;
    house.progress = 0.3;
    scene.sync(w);
    scene.select([], { type: "building", id: house.id });
    const marker = markers.children[0];
    for (const rotation of [0, 1, 2, 3]) {
      scene.preview("house", { x: 3, z: 4 }, rotation);
      expect(roofs(ghost).every((part) => part.visible)).toBe(true);
      expect(ghost.children[0].rotation.y).toBe((rotation * Math.PI) / 2);
    }
    const preview = buildingModel("house");
    expect(roofs(preview).every((part) => part.visible)).toBe(true);
    const model = entities.children.find((o) => o.userData.id === house.id)!;
    expect(roofs(model).every((part) => !part.visible)).toBe(true);
    house.progress = 1;
    scene.sync(w);
    expect(roofs(model).every((part) => part.visible)).toBe(true);
    expect(markers.children[0]).toBe(marker);
    disposeGroup(preview);
  });

  it("does not pick a hidden roof over another visible building", () => {
    const { scene, entities } = sceneFixture();
    const model = buildingModel("house");
    model.userData = { type: "building", id: 1 };
    setBuildingProgress(model, 0.5);
    const behind = buildingModel("store");
    behind.userData = { type: "building", id: 2 };
    entities.add(model, behind);
    Object.assign(scene, {
      pointerWorld: vi.fn(),
      ray: {
        intersectObjects: () => [
          { object: roofs(model)[0].children[0] },
          { object: behind.children[0] },
        ],
      },
    });
    expect(scene.hit(0, 0)).toEqual({ type: "building", id: 2 });
    setBuildingProgress(model, 1);
    expect(scene.hit(0, 0)).toEqual({ type: "building", id: 1 });
  });
});
