// Browser-only fixture: exercises the real scene without app test hooks.
import * as THREE from "three";
import { VillageScene } from "../../src/game/scene";
import { createWorld } from "../../src/simulation/engine";
import { recordWork } from "../../src/simulation/work-activity";

export const scene = new VillageScene(document.querySelector("canvas"));
let world;
export function setup({
  positions = [
    [19, 17],
    [19.7, 17],
    [20.4, 17],
    [24, 20],
  ],
  rotation = 0,
  progress = 1,
  selected = false,
  zoom = 3.5,
  orbit = 0,
  work = null,
  buildings = true,
} = {}) {
  world = createWorld(42);
  world.nodes = [];
  world.roads = [];
  world.bridges = [];
  world.buildings = buildings ? world.buildings.slice(0, 1) : [];
  if (buildings)
    Object.assign(world.buildings[0], { x: 18, z: 18, rotation, progress });
  const template = world.villagers[0];
  world.villagers = positions.map(([x, z], i) => ({
    ...structuredClone(template),
    id: 1000 + i,
    x,
    z,
    path: [],
    cargo: null,
  }));
  scene.setWorld(world);
  scene.preview(null);
  scene.petals.visible = false;
  scene.controls.enableDamping = false;
  scene.controls.target.set(20, 0, 19);
  scene.camera.position.set(
    20 + Math.sin(orbit) * 17,
    12,
    19 + Math.cos(orbit) * 17,
  );
  scene.camera.zoom = zoom;
  scene.camera.updateProjectionMatrix();
  scene.controls.update();
  if (selected) scene.select(world.villagers.map((v) => v.id));
  if (work) {
    for (const v of world.villagers) {
      v.task = "Working";
      v.blocked = 0;
      recordWork(world, v, work, world.buildings[0]);
    }
  }
  scene.frame(100, 1, work ? 0.25 : 0);
}
function pixels() {
  const canvas = document.createElement("canvas");
  canvas.width = scene.canvas.width;
  canvas.height = scene.canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(scene.canvas, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}
export function compare() {
  scene.renderer.render(scene.scene, scene.camera);
  const before = pixels();
  scene.occlusion.render(scene.renderer, scene.scene, scene.camera);
  const after = pixels();
  let changed = 0;
  const bounds = [Infinity, Infinity, -1, -1];
  for (let i = 0; i < after.length; i += 4) {
    if (
      Math.max(
        ...[0, 1, 2].map((c) => Math.abs(before[i + c] - after[i + c])),
      ) > 3
    ) {
      changed++;
      const x = (i / 4) % scene.canvas.width,
        y = Math.floor(i / 4 / scene.canvas.width);
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  return { changed, bounds, memory: { ...scene.renderer.info.memory } };
}
export function project(x, y, z) {
  const p = new THREE.Vector3(x, y, z).project(scene.camera);
  return [
    ((p.x + 1) * scene.canvas.width) / 2,
    ((1 - p.y) * scene.canvas.height) / 2,
  ];
}
export function blocker(kind) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(7, 8, 1),
    new THREE.MeshBasicMaterial({ color: "#719269" }),
  );
  mesh.position.set(20, 4, 23);
  mesh.name = kind;
  // As with real terrain/resources, this is an ordinary layer-0 scene object.
  scene.terrain.add(mesh);
}
export function pose() {
  return scene.entities.getModel("villager:1000").getObjectByName("upper-body")
    .rotation.x;
}
export function advance() {
  scene.frame(200, 1, 0.25);
}
export function plain() {
  scene.renderer.render(scene.scene, scene.camera);
}
export function dispose() {
  scene.dispose();
}
export function benchmark(count) {
  setup({
    positions: Array.from({ length: count }, (_, i) => [
      10 + (i % 20) * 0.6,
      13 + Math.floor(i / 20) * 0.6,
    ]),
  });
  scene.renderer.info.autoReset = false;
  scene.renderer.info.reset();
  const start = performance.now();
  scene.frame(300, 1, 0);
  const submissionMs = performance.now() - start;
  const calls = scene.renderer.info.render.calls;
  scene.renderer.info.autoReset = true;
  return {
    count,
    calls,
    submissionMs,
    memory: { ...scene.renderer.info.memory },
  };
}
