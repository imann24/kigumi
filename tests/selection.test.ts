import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  disposeGroup,
  selectionFootprint,
  selectionRing,
  villagerSelectionRing,
} from "../src/game/art";
import { BUILDINGS } from "../src/simulation/catalog";

describe("selection ground markings", () => {
  it.each([
    ["villager", () => villagerSelectionRing()],
    ["tree", () => selectionRing(0.85)],
    ["resource", () => selectionRing(0.7)],
    ["building", () => selectionFootprint(4, 4)],
  ] as const)("lets foreground geometry occlude the %s marker", (_, create) => {
    const marker = create();
    marker.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshBasicMaterial;
      expect(material.depthTest).toBe(true);
      // The second line layer and neighboring rings must not mask each other.
      expect(material.depthWrite).toBe(false);
    });
    marker.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(ray.intersectObject(marker, true)).toHaveLength(0);
    disposeGroup(marker);
  });

  it("keeps every building outline outside its footprint in either rotation", () => {
    for (const { size } of Object.values(BUILDINGS)) {
      for (const [width, depth] of [size, [...size].reverse()]) {
        const marker = selectionFootprint(width, depth);
        marker.updateMatrixWorld(true);
        marker.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const positions = object.geometry.getAttribute("position");
          for (let i = 0; i < positions.count; i++) {
            const p = new THREE.Vector3()
              .fromBufferAttribute(positions, i)
              .applyMatrix4(object.matrixWorld);
            expect(Math.abs(p.y)).toBeLessThan(0.00001);
            expect(Math.abs(p.x) > width / 2 || Math.abs(p.z) > depth / 2).toBe(
              true,
            );
          }
        });
        disposeGroup(marker);
      }
    }
  });
});
