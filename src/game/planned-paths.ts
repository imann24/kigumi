import * as THREE from "three";
import { cell } from "../simulation/grid";
import type { Point, Villager, World } from "../simulation/types";
import { paddyHeight } from "./surfaces";

/** Only the simulation's remaining waypoints, including its chosen work/haul endpoint. */
export function plannedRoute(v: Villager, rendered: Point = v): Point[] {
  return v.path.length ? [rendered, ...v.path] : [];
}

function stripGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [],
    colors: number[] = [];
  const edges = [-0.5, -0.25, 0.25, 0.5];
  for (let band = 0; band < 3; band++) {
    const color = new THREE.Color(band === 1 ? "#fff0ba" : "#405445");
    const left = edges[band],
      right = edges[band + 1];
    for (const [x, y] of [
      [left, -0.5],
      [right, -0.5],
      [right, 0.5],
      [left, -0.5],
      [right, 0.5],
      [left, 0.5],
    ]) {
      positions.push(x, y, 0);
      colors.push(color.r, color.g, color.b);
    }
  }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Ground-level, depth-tested routes; one draw call for the entire selection. */
export class PlannedPaths extends THREE.Group {
  private geometry = stripGeometry();
  private material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  private capacity = 128;
  private strokes = this.createMesh();
  private strokeMatrix = new THREE.Matrix4();

  constructor() {
    super();
    this.add(this.strokes);
  }

  private createMesh() {
    const mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      this.capacity,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  clearRoutes() {
    this.strokes.count = 0;
  }

  private stroke(a: Point, b: Point, height: number, width = 0.11) {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.00001) return;
    if (this.strokes.count === this.capacity) {
      const previous = this.strokes;
      this.capacity *= 2;
      this.strokes = this.createMesh();
      this.strokes.instanceMatrix.array.set(previous.instanceMatrix.array);
      this.strokes.count = previous.count;
      this.remove(previous);
      previous.dispose();
      this.add(this.strokes);
    }
    this.strokeMatrix.set(
      (-dz / length) * width,
      dx,
      0,
      (a.x + b.x) / 2,
      0,
      0,
      1,
      height,
      (dx / length) * width,
      dz,
      0,
      (a.z + b.z) / 2,
      0,
      0,
      0,
      1,
    );
    this.strokes.setMatrixAt(this.strokes.count++, this.strokeMatrix);
  }

  update(
    world: World,
    selected: ReadonlySet<number>,
    renderedPosition: (v: Villager) => Point = (v) => v,
  ) {
    this.clearRoutes();
    if (!selected.size) return;
    const bridges = new Set(world.bridges),
      roads = new Set(world.roads);
    const heightAt = (p: Point) => {
      if (paddyHeight(world, p)) return paddyHeight(world, p) + 0.025;
      const tile = cell(world, Math.floor(p.x), Math.floor(p.z));
      return bridges.has(tile) ? 0.245 : roads.has(tile) ? 0.105 : 0.04;
    };
    for (const v of world.villagers) {
      if (!selected.has(v.id)) continue;
      const route = plannedRoute(v, renderedPosition(v));
      if (!route.length) continue;
      const lengths = route
        .slice(1)
        .map((p, i) => Math.hypot(p.x - route[i].x, p.z - route[i].z));
      const total = lengths.reduce((sum, length) => sum + length, 0);
      // Keep the villager's feet clear and let the marker disappear on approach.
      if (total <= 0.65) continue;
      const end = route[route.length - 1];
      const diamond = [
        { x: end.x, z: end.z - 0.2 },
        { x: end.x + 0.2, z: end.z },
        { x: end.x, z: end.z + 0.2 },
        { x: end.x - 0.2, z: end.z },
      ];
      for (let i = 0; i < 4; i++)
        this.stroke(diamond[i], diamond[(i + 1) % 4], heightAt(end), 0.09);

      // Anchor dashes at the destination so they stay still as the unit moves.
      let traveled = 0;
      for (let i = route.length - 1; i > 0; i--) {
        const a = route[i],
          b = route[i - 1],
          length = lengths[i - 1];
        if (length < 0.00001) continue;
        let offset = 0;
        while (offset < length) {
          const distance = traveled + offset;
          const phase = distance % 0.48;
          const advance = Math.min(length - offset, 0.48 - phase + 0.000001);
          const start = Math.max(offset, 0.25 - traveled);
          const stop = Math.min(
            offset + 0.3 - phase,
            length,
            total - 0.65 - traveled,
          );
          if (stop > start) {
            const from = {
              x: a.x + ((b.x - a.x) * start) / length,
              z: a.z + ((b.z - a.z) * start) / length,
            };
            const to = {
              x: a.x + ((b.x - a.x) * stop) / length,
              z: a.z + ((b.z - a.z) * stop) / length,
            };
            this.stroke(from, to, Math.max(heightAt(from), heightAt(to)));
          }
          offset += advance;
        }
        traveled += length;
      }
    }
    this.strokes.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.strokes.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.clear();
  }
}
