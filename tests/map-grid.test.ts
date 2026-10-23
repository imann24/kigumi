import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { MapGrid } from "../src/game/map-grid";
import { PlannedPaths } from "../src/game/planned-paths";
import { SceneEntities } from "../src/game/scene-entities";
import { VillageScene } from "../src/game/scene";
import { createWorld, placementError } from "../src/simulation/engine";
import { deserialize, serialize } from "../src/simulation/save";

function fixture() {
  const grid = new MapGrid(),
    ghost = new THREE.Group();
  const scene: VillageScene = Object.assign(
    Object.create(VillageScene.prototype),
    {
      grid,
      ghost,
      entities: new SceneEntities(),
      paths: new THREE.Group(),
      markers: new THREE.Group(),
      terrain: new THREE.Group(),
      plannedPaths: new PlannedPaths(),
      cursor: { clear: vi.fn() },
      selected: new Set(),
      temp: new THREE.Object3D(),
      home: vi.fn(),
    },
  );
  return { scene, grid, ghost };
}

describe("map grid", () => {
  it.each([20, 40, 80])(
    "draws unit boundaries through all four edges of a %i-tile map",
    (size) => {
      const grid = new MapGrid();
      grid.setSize(size);
      const points = grid.geometry.getAttribute("position");
      expect(points.count).toBe((size + 1) * 4);
      for (let i = 0; i <= size; i++) {
        const vertices = Array.from({ length: 4 }, (_, j) =>
          new THREE.Vector3().fromBufferAttribute(points, 4 * i + j).toArray(),
        );
        expect(vertices).toEqual([
          [0, 0, i],
          [size, 0, i],
          [i, 0, 0],
          [i, 0, size],
        ]);
      }
      grid.geometry.dispose();
      grid.material.dispose();
    },
  );

  it("stays above land and water, depth-tests entities, and does not mask markers or intercept picks", () => {
    const grid = new MapGrid();
    grid.setSize(40);
    expect(grid.position.y).toBeGreaterThan(0.015); // Land surface.
    expect(grid.position.y).toBeGreaterThan(-0.1); // Water surface.
    expect(grid.position.y).toBeLessThan(0.08); // Road surface.
    expect(grid.material.depthTest).toBe(true);
    expect(grid.material.depthWrite).toBe(false);
    expect(grid.material.toneMapped).toBe(false);
    expect(grid.renderOrder).toBeLessThan(10); // Selection markers.
    grid.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(10, 5, 10),
      new THREE.Vector3(0, -1, 0),
    );
    expect(ray.intersectObject(grid)).toEqual([]);
  });

  it("honors repeated explicit toggles through valid/invalid previews, rotation, pointer absence and cancellation", () => {
    const { scene, grid, ghost } = fixture();
    const w = createWorld();
    scene.setWorld(w);
    const before = structuredClone(w);
    const error = placementError(w, "house", 0, 0, 0);
    expect(grid.visible).toBe(false);
    for (const enabled of [true, false, true, false]) {
      scene.showGrid(enabled);
      for (const valid of [true, false]) {
        scene.preview("house", { x: 3, z: 4 }, 1, valid);
        expect(grid.visible).toBe(enabled);
        expect(ghost.visible).toBe(true);
        const footprint = ghost.children[1] as THREE.Mesh<
          THREE.BoxGeometry,
          THREE.MeshBasicMaterial
        >;
        expect(footprint.material.color.getHexString()).toBe(
          valid ? "6b9577" : "b75d49",
        );
      }
      scene.preview("road", { x: 2, z: 2 }, 0, false); // Path erasing.
      expect(grid.visible).toBe(enabled);
      scene.preview("house");
      expect(ghost.visible).toBe(false);
      expect(grid.visible).toBe(enabled);
      scene.preview(null);
      expect(grid.visible).toBe(enabled);
    }
    expect(w).toEqual(before);
    expect(placementError(w, "house", 0, 0, 0)).toBe(error);
  });

  it("keeps visibility across scene/save replacement and disposes resized geometry without accumulating grids", () => {
    const { scene, grid } = fixture();
    const w = createWorld();
    scene.setWorld(w);
    const original = grid.geometry;
    const dispose = vi.spyOn(original, "dispose");
    scene.showGrid(true);
    scene.setWorld(deserialize(serialize(w)));
    expect(grid.visible).toBe(true);
    expect(grid.geometry).toBe(original);
    expect(dispose).not.toHaveBeenCalled();
    w.size = 60;
    w.terrain = Array(60 * 60).fill(0);
    scene.setWorld(deserialize(serialize(w)));
    expect(dispose).toHaveBeenCalledOnce();
    expect(grid.geometry.getAttribute("position").count).toBe(61 * 4);
    expect(grid.visible).toBe(true);
    scene.showGrid(false);
    scene.setWorld(createWorld());
    expect(grid.visible).toBe(false);
    expect(grid.geometry.getAttribute("position").count).toBe(41 * 4);
  });
});
