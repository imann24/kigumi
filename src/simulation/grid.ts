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
  return w.buildings.find((b) => contains(b, x, z));
}
function contains(b: Building, x: number, z: number) {
  const [width, depth] = dimensions(b);
  return x >= b.x && z >= b.z && x < b.x + width && z < b.z + depth;
}

/** Access is local to a route: enter the assigned, finished paddy, or leave
 * the paddy already underfoot (including after reassignment/state changes).
 * Never erase terrain, resources, or overlapping solid buildings. */
export function routeWalkable(w: World, from: Point, farmId?: number) {
  const farms = w.buildings.filter(
    (b) =>
      b.kind === "farm" &&
      ((b.id === farmId && b.progress >= 1) ||
        contains(b, Math.floor(from.x), Math.floor(from.z))),
  );
  return (x: number, z: number) => {
    if (walkable(w, x, z)) return true;
    if (!inside(w, x, z) || !farms.some((b) => contains(b, x, z))) return false;
    if (w.terrain[cell(w, x, z)] === 1 && !w.bridges.includes(cell(w, x, z)))
      return false;
    return (
      !w.nodes.some((n) => n.amount > 0 && n.x === x && n.z === z) &&
      !w.buildings.some((b) => contains(b, x, z) && !farms.includes(b))
    );
  };
}

export function farmWorkSpots(w: World, farm: Building): Point[] {
  if (farm.kind !== "farm" || farm.progress < 1) return [];
  const allowed = routeWalkable(w, { x: -1, z: -1 }, farm.id);
  const [width, depth] = dimensions(farm);
  const result: Point[] = [];
  for (let x = farm.x; x < farm.x + width; x++)
    for (let z = farm.z; z < farm.z + depth; z++)
      if (allowed(x, z)) result.push({ x, z });
  return result;
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
  farmId?: number,
): Point[] | null {
  const sx = Math.floor(from.x),
    sz = Math.floor(from.z),
    start = cell(w, sx, sz);
  const allowed = routeWalkable(w, from, farmId);
  const valid = goals.filter((p) => allowed(p.x, p.z));
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
      if (!allowed(nx, nz)) continue;
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
