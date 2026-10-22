import { BUILDINGS } from "./catalog";
import type { Building, Point, World } from "./types";
export const cell = (w: World, x: number, z: number) => z * w.size + x;
export function dimensions(
  b: Pick<Building, "kind" | "rotation">,
): [number, number] {
  const [a, c] = BUILDINGS[b.kind].size;
  return b.rotation % 2 ? [c, a] : [a, c];
}
export function inside(w: World, x: number, z: number) {
  return x >= 0 && z >= 0 && x < w.size && z < w.size;
}
export function buildingAt(w: World, x: number, z: number) {
  return w.buildings.find((b) => {
    const [a, c] = dimensions(b);
    return x >= b.x && z >= b.z && x < b.x + a && z < b.z + c;
  });
}
const navigation = new WeakMap<World, Uint8Array>();
export function invalidateNavigation(w: World) {
  navigation.delete(w);
}
export function walkable(w: World, x: number, z: number) {
  if (!inside(w, x, z)) return false;
  let mask = navigation.get(w);
  if (!mask) {
    mask = new Uint8Array(w.size * w.size);
    const bridges = new Set(w.bridges);
    for (let i = 0; i < mask.length; i++)
      if (w.terrain[i] === 1 && !bridges.has(i)) mask[i] = 1;
    for (const b of w.buildings) {
      const [a, c] = dimensions(b);
      for (let dx = 0; dx < a; dx++)
        for (let dz = 0; dz < c; dz++) mask[cell(w, b.x + dx, b.z + dz)] = 1;
    }
    for (const n of w.nodes) if (n.amount > 0) mask[cell(w, n.x, n.z)] = 1;
    navigation.set(w, mask);
  }
  return mask[cell(w, x, z)] === 0;
}
export function perimeter(w: World, p: Point, width = 1, depth = 1): Point[] {
  const result: Point[] = [];
  for (let x = p.x - 1; x <= p.x + width; x++)
    for (let z = p.z - 1; z <= p.z + depth; z++) {
      if (x >= p.x && x < p.x + width && z >= p.z && z < p.z + depth) continue;
      if (walkable(w, x, z)) result.push({ x, z });
    }
  return result;
}
export const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
/** A* with the same road weights as movement. No diagonal corner cutting. */
export function findPath(
  w: World,
  from: Point,
  goals: Point[],
): Point[] | null {
  const sx = Math.floor(from.x),
    sz = Math.floor(from.z),
    start = cell(w, sx, sz);
  const valid = goals.filter((p) => walkable(w, p.x, p.z));
  if (!valid.length) return null;
  const targets = new Set(valid.map((p) => cell(w, p.x, p.z)));
  if (targets.has(start)) return [];
  const heuristic = (x: number, z: number) =>
    Math.min(...valid.map((p) => Math.abs(x - p.x) + Math.abs(z - p.z))) / 1.45;
  const open = new Set([start]),
    came = new Map<number, number>(),
    g = new Map([[start, 0]]),
    f = new Map([[start, heuristic(sx, sz)]]);
  const roads = new Set(w.roads);
  while (open.size) {
    let current = -1,
      best = Infinity;
    for (const i of open) {
      if (f.get(i)! < best) {
        best = f.get(i)!;
        current = i;
      }
    }
    if (targets.has(current)) {
      const path: Point[] = [];
      while (current !== start) {
        path.unshift({
          x: (current % w.size) + 0.5,
          z: Math.floor(current / w.size) + 0.5,
        });
        current = came.get(current)!;
      }
      return path;
    }
    open.delete(current);
    const x = current % w.size,
      z = Math.floor(current / w.size);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        nz = z + dz;
      if (!walkable(w, nx, nz)) continue;
      const next = cell(w, nx, nz),
        score = g.get(current)! + (roads.has(next) ? 1 / 1.45 : 1);
      if (score < (g.get(next) ?? Infinity)) {
        came.set(next, current);
        g.set(next, score);
        f.set(next, score + heuristic(nx, nz));
        open.add(next);
      }
    }
  }
  return null;
}
