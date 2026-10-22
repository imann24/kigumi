import { BUILDINGS, TECHS } from "./catalog";
import { dimensions, inside } from "./grid";
import type { World } from "./types";
const AUTO = "kigumi.autosave.v1",
  MANUAL = "kigumi.manual.v1";
export function serialize(w: World) {
  return JSON.stringify({
    format: "kigumi",
    version: 1,
    savedAt: new Date().toISOString(),
    world: w,
  });
}
/** Validate imported/local data before it can reach geometry, loops, or the simulation. */
export function deserialize(raw: string): World {
  if (raw.length > 8_000_000) throw new Error("This save is too large.");
  const data = JSON.parse(raw);
  const w = data?.world as World;
  const bad = () => {
    throw new Error("This file is not a valid Kigumi v1 save.");
  };
  const finite = (n: unknown, min = 0, max = 1e9): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const integer = (n: unknown, min = 0, max = 1e9) =>
    finite(n, min, max) && Number.isInteger(n);
  if (
    data?.format !== "kigumi" ||
    data.version !== 1 ||
    !w ||
    w.version !== 1 ||
    !integer(w.size, 20, 80) ||
    !integer(w.tick) ||
    !integer(w.seed, 0, 4294967295) ||
    !integer(w.rng, 0, 4294967295) ||
    !integer(w.nextId, 1)
  )
    bad();
  if (
    !Array.isArray(w.terrain) ||
    w.terrain.length !== w.size * w.size ||
    w.terrain.some((n) => n !== 0 && n !== 1)
  )
    bad();
  for (const key of ["wood", "food", "stone", "insight"] as const)
    if (!finite(w.stock?.[key])) bad();
  if (
    !w.config ||
    !integer(w.config.maxPopulation, 10, 500) ||
    !finite(w.config.foodConsumption, 0, 1) ||
    w.scenario?.id !== "freeform" ||
    typeof w.scenario.flags !== "object"
  )
    bad();
  for (const a of [
    w.buildings,
    w.nodes,
    w.villagers,
    w.roads,
    w.bridges,
    w.techs,
    w.log,
  ])
    if (!Array.isArray(a)) bad();
  if (
    w.villagers.length < 1 ||
    w.villagers.length > 500 ||
    w.buildings.length > 1000 ||
    w.nodes.length > 6400 ||
    w.log.length > 100 ||
    w.roads.length > w.size * w.size ||
    w.bridges.length > w.size * w.size ||
    w.techs.length > 5
  )
    bad();
  const ids = new Set<number>();
  for (const entity of [...w.buildings, ...w.nodes, ...w.villagers]) {
    if (
      !entity ||
      !integer(entity.id, 1) ||
      entity.id >= w.nextId ||
      ids.has(entity.id) ||
      !finite(entity.x, 0, w.size - 0.001) ||
      !finite(entity.z, 0, w.size - 0.001)
    )
      bad();
    ids.add(entity.id);
  }
  for (const b of w.buildings) {
    if (
      !Object.hasOwn(BUILDINGS, b.kind) ||
      b.kind === "road" ||
      b.kind === "bridge" ||
      !integer(b.rotation, 0, 1) ||
      !finite(b.progress, 0, 1) ||
      !integer(b.x) ||
      !integer(b.z)
    )
      bad();
    const [a, c] = dimensions(b);
    if (!inside(w, b.x + a - 1, b.z + c - 1)) bad();
  }
  if (
    w.buildings.filter((b) => b.kind === "hall" && b.progress === 1).length < 1
  )
    bad();
  for (const n of w.nodes)
    if (
      !["wood", "food", "stone"].includes(n.kind) ||
      !finite(n.amount) ||
      !finite(n.variant, 0, 1) ||
      !integer(n.x) ||
      !integer(n.z)
    )
      bad();
  for (const v of w.villagers) {
    if (
      typeof v.name !== "string" ||
      v.name.length > 80 ||
      typeof v.auto !== "boolean" ||
      !finite(v.morale, 0, 100) ||
      !finite(v.action) ||
      !finite(v.blocked) ||
      typeof v.task !== "string" ||
      v.task.length > 150 ||
      !v.order
    )
      bad();
    if (
      !["auto", "idle", "move", "gather", "build", "work"].includes(
        v.order.type,
      )
    )
      bad();
    if (
      v.order.type === "move" &&
      (!finite(v.order.target?.x, 0, w.size - 0.001) ||
        !finite(v.order.target?.z, 0, w.size - 0.001))
    )
      bad();
    if (
      ["gather", "build", "work"].includes(v.order.type) &&
      !integer((v.order as { target: number }).target, 1)
    )
      bad();
    if (
      v.cargo &&
      (!["wood", "food", "stone", "insight"].includes(v.cargo.kind) ||
        !finite(v.cargo.amount, 0, 100))
    )
      bad();
    if (
      !Array.isArray(v.path) ||
      v.path.length > w.size * w.size ||
      v.path.some(
        (p) =>
          !p ||
          !finite(p.x, 0, w.size - 0.001) ||
          !finite(p.z, 0, w.size - 0.001),
      )
    )
      bad();
  }
  for (const i of [...w.roads, ...w.bridges])
    if (!integer(i, 0, w.size * w.size - 1)) bad();
  for (const t of w.techs) if (!Object.hasOwn(TECHS, t)) bad();
  if (
    w.research &&
    (!Object.hasOwn(TECHS, w.research.id) || !finite(w.research.progress, 0, 1))
  )
    bad();
  if (w.recruit !== null && !finite(w.recruit)) bad();
  if (
    !w.relationships ||
    typeof w.relationships !== "object" ||
    Array.isArray(w.relationships) ||
    Object.keys(w.relationships).length > 125000
  )
    bad();
  for (const [key, r] of Object.entries(w.relationships))
    if (
      !r ||
      key !== [r.a, r.b].sort((a, b) => a - b).join(":") ||
      !ids.has(r.a) ||
      !ids.has(r.b) ||
      !finite(r.affinity, -100, 100) ||
      !finite(r.trust, 0, 100) ||
      !integer(r.encounters) ||
      !integer(r.lastTick)
    )
      bad();
  for (const l of w.log)
    if (
      !l ||
      !integer(l.tick) ||
      typeof l.text !== "string" ||
      l.text.length > 500
    )
      bad();
  return w;
}
export function saveLocal(w: World, manual = false) {
  localStorage.setItem(manual ? MANUAL : AUTO, serialize(w));
}
export function loadLocal(manual = false): World | null {
  const raw = localStorage.getItem(manual ? MANUAL : AUTO);
  return raw ? deserialize(raw) : null;
}
