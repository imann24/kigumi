import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { berryBushModel, disposeGroup } from "../src/game/art";
import { ResourcePulses } from "../src/game/resource-pulses";

const parts = (model: THREE.Group) =>
  model.children as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >[];

describe("wild berry art", () => {
  it("keeps fruit exposed across the camera's orbit and elevation range", () => {
    const model = berryBushModel();
    // Inspect visible surfaces independently of the intentionally unchanged picking shape.
    for (const mesh of parts(model))
      mesh.raycast = THREE.Mesh.prototype.raycast;
    model.updateMatrixWorld(true);
    const camera = new THREE.OrthographicCamera(
      -0.65,
      0.65,
      0.65,
      -0.65,
      0.1,
      10,
    );
    const ray = new THREE.Raycaster();
    for (const polar of [0.3, 0.81, Math.PI * 0.42]) {
      for (let direction = 0; direction < 8; direction++) {
        const azimuth = (direction * Math.PI) / 4;
        camera.position.setFromSphericalCoords(4, polar, azimuth);
        camera.position.y += 0.4;
        camera.lookAt(0, 0.4, 0);
        camera.updateMatrixWorld(true);
        let visible = 0,
          fruit = 0;
        for (let x = 0; x < 32; x++) {
          for (let y = 0; y < 32; y++) {
            ray.setFromCamera(
              new THREE.Vector2((x + 0.5) / 16 - 1, (y + 0.5) / 16 - 1),
              camera,
            );
            const first = ray.intersectObject(model)[0];
            if (!first) continue;
            visible++;
            if (first.object.name === "berries") fruit++;
          }
        }
        expect(visible).toBeGreaterThan(100);
        expect(
          fruit / visible,
          `polar=${polar}, direction=${direction}`,
        ).toBeGreaterThan(0.12);
      }
    }
    disposeGroup(model);
  });

  it("keeps the original foliage picking shape and a small rendering budget", () => {
    const model = berryBushModel(),
      meshes = parts(model);
    const foliage = meshes[0];
    expect(foliage.position.toArray()).toEqual([0, 0.35, 0]);
    expect(foliage.scale.toArray()).toEqual([0.49, 0.47, 0.48]);
    expect(meshes.length).toBeLessThanOrEqual(3);
    const triangles = meshes.reduce(
      (n, mesh) =>
        n +
        (mesh.geometry.index?.count ??
          mesh.geometry.getAttribute("position").count) /
          3,
      0,
    );
    expect(triangles).toBeLessThanOrEqual(500);
    model.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 3, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(ray.intersectObject(model)).toEqual(ray.intersectObject(foliage));
    for (const fruit of meshes.slice(1)) {
      const hits: THREE.Intersection[] = [];
      const realRaycast = vi.spyOn(THREE.Mesh.prototype, "raycast");
      fruit.raycast(ray, hits);
      expect(hits).toEqual([]);
      expect(realRaycast).not.toHaveBeenCalled();
      realRaycast.mockRestore();
    }
    disposeGroup(model);
  });

  it("flashes fruit with the whole bush, isolates neighbors, and disposes owned art", () => {
    const target = berryBushModel(),
      neighbor = berryBushModel();
    const meshes = parts(target),
      adjacent = parts(neighbor);
    const originals = meshes.map((mesh) => mesh.material);
    const neighborColors = adjacent.map((mesh) => mesh.material.color.clone());
    const owned = meshes
      .slice(1)
      .flatMap((mesh) => [mesh.geometry, mesh.material]);
    const disposed = owned.map((asset) => vi.spyOn(asset, "dispose"));
    const shared = [
      vi.spyOn(meshes[0].geometry, "dispose"),
      vi.spyOn(meshes[0].material, "dispose"),
    ];
    const pulses = new ResourcePulses();
    pulses.start(target, 0);
    pulses.update(120);
    meshes.forEach((mesh, i) => {
      expect(mesh.material).not.toBe(originals[i]);
      expect(mesh.material.color.equals(originals[i].color)).toBe(false);
      expect(adjacent[i].material.color.equals(neighborColors[i])).toBe(true);
    });
    const pulseDisposed = meshes.map((mesh) =>
      vi.spyOn(mesh.material, "dispose"),
    );
    // Scene removal restores pulse materials before disposeGroup runs.
    pulses.remove(target);
    meshes.forEach((mesh, i) => expect(mesh.material).toBe(originals[i]));
    pulseDisposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    disposeGroup(target);
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    shared.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    adjacent.slice(1).forEach((mesh, i) => {
      expect(mesh.material).not.toBe(originals[i + 1]);
      expect(mesh.geometry).not.toBe(meshes[i + 1].geometry);
    });
    disposeGroup(neighbor);
    vi.restoreAllMocks();
  });
});
