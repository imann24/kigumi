import * as THREE from "three";
import { cell } from "../simulation/grid";
import type { World } from "../simulation/types";
import { box, material } from "./art";

/** Build a world's ground, water and meadow. The scene owns disposal on replacement. */
export function createTerrain(w: World) {
  const terrain = new THREE.Group();
  const temp = new THREE.Object3D();
  const base = new THREE.Group();
  box(base, "#b3ab8d", 20, -0.9, 20, 40, 1.3, 40);
  box(base, "#8c927e", 20, -1.62, 20, 39.6, 0.15, 39.6);
  terrain.add(base);
  const floor = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.1, 1),
    material("#ffffff"),
    w.size * w.size,
  );
  const waterTiles = w.terrain.filter((n) => n === 1).length;
  const water = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.04, 1),
    new THREE.MeshStandardMaterial({
      color: "#8db8b1",
      roughness: 0.3,
      metalness: 0.15,
    }),
    waterTiles,
  );
  let k = 0;
  for (let z = 0; z < w.size; z++)
    for (let x = 0; x < w.size; x++) {
      const i = cell(w, x, z),
        isWater = w.terrain[i] === 1;
      temp.position.set(x + 0.5, isWater ? -0.23 : -0.035, z + 0.5);
      temp.scale.set(1, 1, 1);
      temp.rotation.set(0, 0, 0);
      temp.updateMatrix();
      floor.setMatrixAt(i, temp.matrix);
      const r = (Math.sin(x * 78.23 + z * 32.43) * 4532) % 1;
      floor.setColorAt(
        i,
        new THREE.Color(
          isWater
            ? "#b9baa0"
            : r > 0.6
              ? "#a5b88a"
              : r < -0.5
                ? "#b1bf94"
                : "#aab98e",
        ),
      );
      if (isWater) {
        temp.position.y = -0.12;
        temp.updateMatrix();
        water.setMatrixAt(k++, temp.matrix);
      }
    }
  floor.receiveShadow = true;
  water.receiveShadow = true;
  terrain.add(floor, water);
  // Small meadow tufts, all in one draw call.
  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.045, 0.18, 3),
    material("#8eaa73"),
    600,
  );
  let count = 0;
  for (let i = 0; i < 1000 && count < 600; i++) {
    const x = (Math.sin(i * 37.8) * 0.5 + 0.5) * 39,
      z = (Math.sin(i * 17.3 + 9) * 0.5 + 0.5) * 39;
    if (w.terrain[cell(w, Math.floor(x), Math.floor(z))]) continue;
    temp.position.set(x, 0.07, z);
    temp.rotation.set(0, i, 0);
    temp.updateMatrix();
    grass.setMatrixAt(count++, temp.matrix);
  }
  grass.count = count;
  terrain.add(grass);
  return terrain;
}
