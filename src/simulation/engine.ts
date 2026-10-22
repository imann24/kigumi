import {
  BUILDINGS,
  TECHS,
  type BuildingKind,
  type Resource,
  type Stock,
  type TechId,
} from "./catalog";
import {
  buildingAt,
  cell,
  dimensions,
  distance,
  findPath,
  inside,
  invalidateNavigation,
  perimeter,
  walkable,
} from "./grid";
import type {
  Building,
  Command,
  CommandResult,
  Order,
  Point,
  Villager,
  World,
} from "./types";
export const STEP = 0.25;
const names = [
  "Haru",
  "Aki",
  "Ren",
  "Yui",
  "Sora",
  "Nao",
  "Mio",
  "Rin",
  "Kei",
  "Tomo",
  "Saki",
  "Jun",
  "Kaya",
  "Riku",
  "Hana",
  "Yori",
];
export function random(w: World) {
  w.rng = (Math.imul(w.rng, 1664525) + 1013904223) >>> 0;
  return w.rng / 4294967296;
}
export function log(w: World, text: string) {
  w.log.push({ tick: w.tick, text });
  if (w.log.length > 60) w.log.shift();
}
export function capacity(w: World) {
  return Math.min(
    w.config.maxPopulation,
    w.buildings
      .filter((b) => b.progress >= 1)
      .reduce(
        (n, b) =>
          n +
          (BUILDINGS[b.kind].capacity ?? 0) +
          (b.kind === "house" && w.techs.includes("joinery") ? 2 : 0),
        0,
      ),
  );
}
export function canAfford(w: World, cost: Partial<Stock>) {
  return Object.entries(cost).every(([k, v]) => w.stock[k as Resource] >= v);
}
function spend(w: World, cost: Partial<Stock>) {
  for (const [k, v] of Object.entries(cost)) w.stock[k as Resource] -= v;
}
export function addVillager(w: World, p: Point) {
  const i = w.villagers.length;
  w.villagers.push({
    id: w.nextId++,
    name:
      names[i % names.length] +
      (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""),
    x: p.x,
    z: p.z,
    order: { type: "auto" },
    auto: true,
    path: [],
    task: "Finding work",
    cargo: null,
    action: 0,
    morale: 75,
    blocked: 0,
  });
}
export function createWorld(seed = 24601): World {
  const w: World = {
    version: 1,
    seed,
    rng: seed >>> 0,
    tick: 0,
    nextId: 1,
    size: 40,
    terrain: [],
    stock: { wood: 190, food: 160, stone: 95, insight: 30 },
    buildings: [],
    nodes: [],
    villagers: [],
    roads: [],
    bridges: [],
    techs: [],
    research: null,
    recruit: null,
    relationships: {},
    log: [],
    config: { maxPopulation: 200, foodConsumption: 0.012 },
    scenario: { id: "freeform", flags: {} },
  };
  for (let z = 0; z < w.size; z++)
    for (let x = 0; x < w.size; x++) {
      const river = 29 + Math.round(Math.sin(z * 0.19) * 2);
      w.terrain.push(x >= river && x < river + 3 ? 1 : 0);
    }
  const put = (kind: BuildingKind, x: number, z: number, rotation = 0) =>
    w.buildings.push({ id: w.nextId++, kind, x, z, rotation, progress: 1 });
  put("hall", 16, 17);
  put("house", 12, 18);
  put("house", 18, 24);
  put("farm", 22, 19);
  put("store", 13, 24);
  for (let x = 10; x <= 33; x++) {
    const i = cell(w, x, 22);
    if (w.terrain[i]) w.bridges.push(i);
    else w.roads.push(i);
  }
  for (let z = 14; z <= 27; z++)
    if (!buildingAt(w, 16, z)) w.roads.push(cell(w, 16, z));
  for (let z = 21; z <= 23; z++) w.roads.push(cell(w, 19, z));
  const clusters = [
    { x: 8, z: 11, n: 38, kind: "wood" },
    { x: 22, z: 8, n: 25, kind: "wood" },
    { x: 7, z: 27, n: 22, kind: "wood" },
    { x: 35, z: 29, n: 22, kind: "wood" },
    { x: 23, z: 28, n: 13, kind: "stone" },
    { x: 11, z: 15, n: 9, kind: "food" },
  ] as const;
  for (const c of clusters)
    for (let i = 0; i < c.n; i++) {
      const x = Math.round(c.x + (random(w) - 0.5) * 9),
        z = Math.round(c.z + (random(w) - 0.5) * 8);
      if (
        !inside(w, x, z) ||
        w.terrain[cell(w, x, z)] ||
        buildingAt(w, x, z) ||
        w.roads.includes(cell(w, x, z)) ||
        w.nodes.some((n) => n.x === x && n.z === z)
      )
        continue;
      if (x >= 11 && x <= 25 && z >= 17 && z <= 26) continue;
      w.nodes.push({
        id: w.nextId++,
        kind: c.kind,
        x,
        z,
        amount: c.kind === "wood" ? 100 : c.kind === "stone" ? 150 : 70,
        variant: random(w),
      });
    }
  for (let i = 0; i < 10; i++)
    addVillager(w, { x: 16.5 + (i % 4), z: 21.5 + Math.floor(i / 4) * 0.18 });
  w.villagers[0].order = {
    type: "work",
    target: w.buildings.find((b) => b.kind === "farm")!.id,
  };
  w.villagers[1].order = {
    type: "work",
    target: w.buildings.find((b) => b.kind === "farm")!.id,
  };
  log(w, "A clearing, a few homes, and a beginning. Welcome to Komorebi.");
  return w;
}
export function placementError(
  w: World,
  kind: BuildingKind,
  x: number,
  z: number,
  rotation: number,
): string | null {
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3)
    return "Choose one of the four building directions.";
  const def = BUILDINGS[kind];
  if (def.tech && !w.techs.includes(def.tech))
    return `Research ${TECHS[def.tech].name} first.`;
  const [width, depth] = dimensions({ kind, rotation });
  for (let dx = 0; dx < width; dx++)
    for (let dz = 0; dz < depth; dz++) {
      const a = x + dx,
        b = z + dz,
        i = cell(w, a, b);
      if (!inside(w, a, b)) return "Place within the island.";
      if (kind === "bridge") {
        if (w.terrain[i] !== 1 || w.bridges.includes(i))
          return "Bridges need an empty water tile.";
        continue;
      }
      if (w.terrain[i] === 1)
        return "Build on dry ground; use bridges over water.";
      if (
        buildingAt(w, a, b) ||
        w.nodes.some((n) => n.x === a && n.z === b && n.amount > 0)
      )
        return "Leave space for buildings and resources.";
      if (w.roads.includes(i)) return "This tile already has a path.";
      if (
        kind !== "road" &&
        w.villagers.some((v) => Math.floor(v.x) === a && Math.floor(v.z) === b)
      )
        return "A villager is standing here.";
    }
  if (kind !== "road" && kind !== "bridge") {
    const candidate: Building = { id: -1, kind, x, z, rotation, progress: 0 };
    const preview = { ...w, buildings: [...w.buildings, candidate] };
    if (!perimeter(preview, { x, z }, width, depth).length)
      return "Leave an accessible edge for workers.";
    // Preserve access for every villager and existing structure, including the new site.
    const hall = w.buildings.find((b) => b.kind === "hall")!;
    const home = perimeter(preview, hall, ...dimensions(hall));
    const reachable = new Set<number>(),
      queue = [...home];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i],
        key = cell(preview, p.x, p.z);
      if (reachable.has(key)) continue;
      reachable.add(key);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = p.x + dx,
          nz = p.z + dz;
        if (walkable(preview, nx, nz) && !reachable.has(cell(preview, nx, nz)))
          queue.push({ x: nx, z: nz });
      }
    }
    if (
      !perimeter(preview, candidate, width, depth).some((p) =>
        reachable.has(cell(preview, p.x, p.z)),
      )
    )
      return "Connect this site to the village first.";
    if (
      w.villagers.some(
        (v) => !reachable.has(cell(preview, Math.floor(v.x), Math.floor(v.z))),
      )
    )
      return "This would cut off a villager’s route home.";
    if (
      w.buildings.some(
        (b) =>
          !perimeter(preview, b, ...dimensions(b)).some((p) =>
            reachable.has(cell(preview, p.x, p.z)),
          ),
      )
    )
      return "Keep a route open to every building.";
  }
  if (!canAfford(w, def.cost)) return "Not enough resources yet.";
  return null;
}
export function researchError(w: World, id: TechId): string | null {
  const t = TECHS[id];
  if (w.techs.includes(id)) return "Already researched.";
  if (w.research) return "Another research is in progress.";
  if (t.requires.some((r) => !w.techs.includes(r)))
    return "Complete the earlier research first.";
  if (
    t.building &&
    !w.buildings.some((b) => b.kind === t.building && b.progress >= 1)
  )
    return `Build a ${BUILDINGS[t.building].name.toLowerCase()} first.`;
  if (!canAfford(w, t.cost)) return "Not enough resources yet.";
  return null;
}
function assign(v: Villager, order: Order) {
  v.order = structuredClone(order);
  v.task = (
    {
      auto: "Finding work",
      idle: "Standing by",
      move: "Walking",
      gather: "Going to gather",
      build: "Going to build",
      work: "Going to work",
    } as const
  )[order.type];
  v.path = [];
  v.action = 0;
  v.blocked = 0;
  delete v.destination;
}
export function applyCommand(w: World, c: Command): CommandResult {
  const fail = (message: string) => ({ ok: false, message });
  if (c.type === "place") {
    if (!BUILDINGS[c.kind] || ![c.x, c.z, c.rotation].every(Number.isInteger))
      return fail("Invalid placement.");
    const error = placementError(w, c.kind, c.x, c.z, c.rotation);
    if (error) return fail(error);
    spend(w, BUILDINGS[c.kind].cost);
    if (c.kind === "road" || c.kind === "bridge") {
      w[c.kind === "road" ? "roads" : "bridges"].push(cell(w, c.x, c.z));
      invalidateNavigation(w);
      return { ok: true };
    }
    const b: Building = {
      id: w.nextId++,
      kind: c.kind,
      x: c.x,
      z: c.z,
      rotation: c.rotation,
      progress: 0,
    };
    w.buildings.push(b);
    invalidateNavigation(w);
    const builders = w.villagers.filter((v) => c.villagers.includes(v.id));
    if (!builders.length) {
      const available = w.villagers
        .filter((v) => v.auto && v.order.type !== "move")
        .sort((a, bv) => distance(a, b) - distance(bv, b));
      builders.push(...available.slice(0, 2));
    }
    for (const v of builders) assign(v, { type: "build", target: b.id });
    for (const v of w.villagers) v.path = [];
    log(w, `A ${BUILDINGS[b.kind].name.toLowerCase()} is taking shape.`);
    return { ok: true };
  }
  if (c.type === "order") {
    if (
      c.order.type === "move" &&
      (!Number.isFinite(c.order.target.x) ||
        !Number.isFinite(c.order.target.z) ||
        !walkable(
          w,
          Math.floor(c.order.target.x),
          Math.floor(c.order.target.z),
        ))
    )
      return fail("Choose an open, walkable tile.");
    if (
      c.order.type === "gather" &&
      !w.nodes.some(
        (n) => n.id === (c.order as { target: number }).target && n.amount > 0,
      )
    )
      return fail("This resource is exhausted.");
    if (
      c.order.type === "build" &&
      !w.buildings.some(
        (b) =>
          b.id === (c.order as { target: number }).target && b.progress < 1,
      )
    )
      return fail("Choose an unfinished building.");
    if (c.order.type === "work") {
      const target = c.order.target,
        b = w.buildings.find((b) => b.id === target);
      if (!b || b.progress < 1 || !["farm", "workshop"].includes(b.kind))
        return fail("Assign workers to a completed paddy or workshop.");
      const occupied = w.villagers.filter(
        (v) =>
          v.order.type === "work" &&
          v.order.target === target &&
          !c.ids.includes(v.id),
      ).length;
      if (occupied + c.ids.length > (b.kind === "farm" ? 3 : 2))
        return fail(
          `This ${BUILDINGS[b.kind].name.toLowerCase()} has room for ${b.kind === "farm" ? 3 : 2} workers.`,
        );
    }
    for (const v of w.villagers.filter((v) => c.ids.includes(v.id)))
      assign(v, c.order);
    w.scenario.flags.directed = true;
    return { ok: true };
  }
  if (c.type === "auto") {
    for (const v of w.villagers.filter((v) => c.ids.includes(v.id))) {
      v.auto = c.enabled;
      if (c.enabled && v.order.type === "idle") assign(v, { type: "auto" });
      if (!c.enabled && v.order.type === "auto") assign(v, { type: "idle" });
    }
    return { ok: true };
  }
  if (c.type === "research") {
    if (!TECHS[c.id]) return fail("Unknown research.");
    const error = researchError(w, c.id);
    if (error) return fail(error);
    spend(w, TECHS[c.id].cost);
    w.research = { id: c.id, progress: 0 };
    log(w, `Studying ${TECHS[c.id].name.toLowerCase()}.`);
    return { ok: true };
  }
  if (c.type === "recruit") {
    if (w.recruit !== null)
      return fail("A new villager is already on the way.");
    if (w.villagers.length >= capacity(w))
      return fail("Build another house to welcome more villagers.");
    if (w.stock.food < 35)
      return fail("You need 35 food to welcome a villager.");
    w.stock.food -= 35;
    w.recruit = 0;
    return { ok: true };
  }
  if (c.type === "demolish") {
    const b = w.buildings.find((b) => b.id === c.id);
    if (!b) return fail("Building not found.");
    if (b.kind === "hall") return fail("The village needs its hall.");
    w.buildings = w.buildings.filter((item) => item !== b);
    invalidateNavigation(w);
    for (const [k, v] of Object.entries(BUILDINGS[b.kind].cost))
      w.stock[k as Resource] += Math.floor(v * 0.5);
    for (const v of w.villagers) {
      v.path = [];
      if ("target" in v.order && v.order.target === b.id)
        assign(v, { type: v.auto ? "auto" : "idle" });
    }
    log(
      w,
      `${BUILDINGS[b.kind].name} dismantled; half its materials recovered.`,
    );
    return { ok: true };
  }
  if (c.type === "removePath") {
    if (
      !Number.isInteger(c.x) ||
      !Number.isInteger(c.z) ||
      !inside(w, c.x, c.z)
    )
      return fail("Choose a path tile.");
    const i = cell(w, c.x, c.z);
    if (w.roads.includes(i)) {
      w.roads = w.roads.filter((n) => n !== i);
      return { ok: true };
    }
    if (w.bridges.includes(i)) {
      const preview = { ...w, bridges: w.bridges.filter((n) => n !== i) };
      const hall = w.buildings.find((b) => b.kind === "hall")!,
        goals = perimeter(preview, hall, ...dimensions(hall));
      if (
        w.villagers.some(
          (v) =>
            (Math.floor(v.x) === c.x && Math.floor(v.z) === c.z) ||
            findPath(preview, v, goals) === null,
        )
      )
        return fail("This crossing is still needed by a villager.");
      if (
        w.buildings.some((b) => {
          const entrances = perimeter(preview, b, ...dimensions(b));
          return (
            !entrances.length || findPath(preview, entrances[0], goals) === null
          );
        })
      )
        return fail("Keep a crossing open to every building.");
      w.bridges = preview.bridges;
      w.stock.wood += 3;
      invalidateNavigation(w);
      for (const v of w.villagers) v.path = [];
      return { ok: true };
    }
    return fail("Choose a stone path or bridge tile.");
  }
  if (c.type === "config") {
    if (
      !Number.isInteger(c.maxPopulation) ||
      c.maxPopulation < 10 ||
      c.maxPopulation > 500
    )
      return fail("Choose a population limit from 10 to 500.");
    w.config.maxPopulation = c.maxPopulation;
    return { ok: true };
  }
  return fail("Unknown command.");
}
function approach(
  w: World,
  v: Villager,
  p: Point,
  width = 1,
  depth = 1,
): boolean {
  const goals = perimeter(w, p, width, depth);
  if (goals.some((g) => Math.floor(v.x) === g.x && Math.floor(v.z) === g.z))
    return true;
  const free = goals.filter(
    (g) =>
      !w.villagers.some(
        (other) =>
          other.id !== v.id &&
          ((Math.floor(other.x) === g.x && Math.floor(other.z) === g.z) ||
            (other.path.length > 0 &&
              Math.floor(other.path.at(-1)!.x) === g.x &&
              Math.floor(other.path.at(-1)!.z) === g.z)),
      ),
  );
  const path = findPath(w, v, free.length ? free : goals);
  if (path === null) {
    v.task = "Route blocked";
    v.blocked = 8;
    return false;
  }
  v.path = path;
  return path.length === 0;
}
function completeOrder(v: Villager) {
  assign(v, { type: v.auto ? "auto" : "idle" });
}
function chooseWork(w: World, v: Villager) {
  const unfinished = w.buildings
    .filter((b) => b.progress < 1)
    .sort((a, b) => distance(v, a) - distance(v, b));
  for (const b of unfinished)
    if (findPath(w, v, perimeter(w, b, ...dimensions(b))) !== null) {
      assign(v, { type: "build", target: b.id });
      return;
    }
  const want: Resource =
    w.stock.food < 70
      ? "food"
      : w.stock.wood < 100
        ? "wood"
        : w.stock.stone < 45
          ? "stone"
          : "wood";
  if (want === "food") {
    const farm = w.buildings.find(
      (b) =>
        b.kind === "farm" &&
        b.progress >= 1 &&
        w.villagers.filter(
          (a) => a.order.type === "work" && a.order.target === b.id,
        ).length < 3,
    );
    if (
      farm &&
      findPath(w, v, perimeter(w, farm, ...dimensions(farm))) !== null
    ) {
      assign(v, { type: "work", target: farm.id });
      return;
    }
  }
  const assigned = new Map<number, number>();
  for (const worker of w.villagers)
    if (worker.order.type === "gather")
      assigned.set(
        worker.order.target,
        (assigned.get(worker.order.target) ?? 0) + 1,
      );
  const score = (n: World["nodes"][number]) =>
    (n.kind === want ? 0 : 100) +
    distance(v, n) +
    (assigned.get(n.id) ?? 0) * 6;
  const candidates = w.nodes
    .filter((n) => n.amount > 0)
    .sort((a, b) => score(a) - score(b));
  for (const n of candidates.slice(0, 16))
    if (findPath(w, v, perimeter(w, n)) !== null) {
      assign(v, { type: "gather", target: n.id });
      return;
    }
  v.task = "No reachable work";
  v.blocked = 12;
}
function deliver(w: World, v: Villager): boolean {
  if (!v.cargo) return false;
  const stores = w.buildings
    .filter((b) => (b.kind === "hall" || b.kind === "store") && b.progress >= 1)
    .sort((a, b) => distance(v, a) - distance(v, b));
  for (const b of stores) {
    const goals = perimeter(w, b, ...dimensions(b));
    if (goals.some((g) => Math.floor(v.x) === g.x && Math.floor(v.z) === g.z)) {
      w.stock[v.cargo.kind] += v.cargo.amount;
      v.cargo = null;
      v.action = 0;
      return false;
    }
  }
  for (const b of stores) {
    const path = findPath(w, v, perimeter(w, b, ...dimensions(b)));
    if (path !== null) {
      v.path = path;
      v.task = `Hauling ${v.cargo.kind}`;
      return true;
    }
  }
  v.task = "No route to storage";
  v.blocked = 8;
  return true;
}
function updateVillager(w: World, v: Villager) {
  if (v.blocked > 0) {
    v.blocked -= STEP;
    return;
  }
  if (v.path.length) {
    // Spend the whole tick's travel time, even when it crosses a tile center.
    // Dropping the remainder made walkers briefly slow down at every waypoint.
    let remaining = STEP;
    while (remaining > 0 && v.path.length) {
      const p = v.path[0];
      if (!walkable(w, Math.floor(p.x), Math.floor(p.z))) {
        v.path = [];
        break;
      }
      const dx = p.x - v.x,
        dz = p.z - v.z;
      const distance = Math.hypot(dx, dz);
      const speed =
        1.25 *
        (w.roads.includes(cell(w, Math.floor(v.x), Math.floor(v.z)))
          ? 1.45
          : 1) *
        (v.morale < 30 ? 0.9 : 1);
      const travel = speed * remaining;
      if (distance <= travel) {
        v.x = p.x;
        v.z = p.z;
        v.path.shift();
        remaining -= distance / speed;
      } else {
        v.x += (dx / distance) * travel;
        v.z += (dz / distance) * travel;
        remaining = 0;
      }
    }
    return;
  }
  const carry = w.techs.includes("wheelbarrow") ? 12 : 8;
  if (
    v.cargo &&
    // Direct movement and standing by take priority over automatic delivery.
    // Keep the load until the player assigns work again.
    v.order.type !== "move" &&
    v.order.type !== "idle" &&
    (v.cargo.amount >= carry ||
      ["auto", "build"].includes(v.order.type) ||
      v.task.startsWith("Hauling") ||
      v.task === "No route to storage")
  ) {
    if (deliver(w, v)) return;
  }
  const rate = w.techs.includes("craft") ? 1.3 : 1;
  switch (v.order.type) {
    case "idle":
      v.task = "Resting";
      return;
    case "auto":
      chooseWork(w, v);
      return;
    case "move": {
      const p = {
        x: Math.floor(v.order.target.x),
        z: Math.floor(v.order.target.z),
      };
      const path = findPath(w, v, [p]);
      v.task = "Walking";
      if (path === null) {
        v.task = "Route blocked";
        v.blocked = 8;
        return;
      }
      if (!path.length) {
        assign(v, { type: "idle" });
        v.task = "Standing by";
      } else v.path = path;
      return;
    }
    case "build": {
      const b = w.buildings.find(
        (b) => v.order.type === "build" && b.id === v.order.target,
      );
      if (!b || b.progress >= 1) {
        completeOrder(v);
        return;
      }
      v.task = `Building ${BUILDINGS[b.kind].name.toLowerCase()}`;
      if (!approach(w, v, b, ...dimensions(b))) return;
      b.progress = Math.min(
        1,
        b.progress + (STEP * rate) / BUILDINGS[b.kind].work,
      );
      if (b.progress >= 1) {
        log(w, `${BUILDINGS[b.kind].name} is ready for village life.`);
        completeOrder(v);
      }
      return;
    }
    case "gather": {
      const n = w.nodes.find(
        (n) => v.order.type === "gather" && n.id === v.order.target,
      );
      if (!n || n.amount <= 0) {
        if (v.cargo && deliver(w, v)) return;
        completeOrder(v);
        return;
      }
      v.task = `Gathering ${n.kind}`;
      if (!approach(w, v, n)) return;
      if (v.cargo && v.cargo.kind !== n.kind) {
        deliver(w, v);
        return;
      }
      v.action += STEP * rate;
      if (v.action >= 0.8) {
        v.action -= 0.8;
        const amount = Math.min(1, n.amount);
        n.amount -= amount;
        if (n.amount <= 0) invalidateNavigation(w);
        v.cargo ??= { kind: n.kind, amount: 0 };
        v.cargo.amount += amount;
      }
      return;
    }
    case "work": {
      const b = w.buildings.find(
        (b) => v.order.type === "work" && b.id === v.order.target,
      );
      if (!b || b.progress < 1) {
        completeOrder(v);
        return;
      }
      v.task = b.kind === "farm" ? "Tending rice" : "Crafting insight";
      if (!approach(w, v, b, ...dimensions(b))) return;
      if (b.kind === "farm") {
        if (v.cargo && v.cargo.kind !== "food") {
          deliver(w, v);
          return;
        }
        v.action += STEP * rate * (w.techs.includes("agriculture") ? 1.4 : 1);
        if (v.action >= 1.2) {
          v.action -= 1.2;
          v.cargo ??= { kind: "food", amount: 0 };
          v.cargo.amount++;
        }
      } else w.stock.insight += STEP * 0.12;
      return;
    }
  }
}
export function step(w: World) {
  w.tick++;
  for (const v of w.villagers) updateVillager(w, v);
  w.stock.food = Math.max(
    0,
    w.stock.food - w.villagers.length * w.config.foodConsumption * STEP,
  );
  w.stock.insight += STEP * 0.065;
  if (w.research) {
    w.research.progress += STEP / TECHS[w.research.id].duration;
    if (w.research.progress >= 1) {
      log(w, `${TECHS[w.research.id].name} is now part of village life.`);
      w.techs.push(w.research.id);
      w.research = null;
    }
  }
  if (w.recruit !== null) {
    w.recruit += STEP;
    if (w.recruit >= 12 && w.villagers.length < capacity(w)) {
      const hall = w.buildings.find((b) => b.kind === "hall")!;
      const p = perimeter(w, hall, ...dimensions(hall))[0];
      if (p) {
        addVillager(w, { x: p.x + 0.5, z: p.z + 0.5 });
        log(w, `${w.villagers.at(-1)!.name} has joined the village.`);
        w.recruit = null;
      }
    }
  }
  if (w.tick % 20 === 0) {
    const amenities = w.buildings.filter(
      (b) => b.progress >= 1 && (b.kind === "tea" || b.kind === "shrine"),
    );
    for (const v of w.villagers) {
      const comfort = amenities.some((b) => distance(v, b) < 7),
        target =
          (w.stock.food > 0 ? 72 : 40) +
          (comfort ? 12 : 0) +
          (w.villagers.length <= capacity(w) ? 0 : -10);
      v.morale += (target - v.morale) * 0.08;
    }
    // Local encounters only; sparse relationships rather than an all-pairs social graph.
    const a = w.villagers[Math.floor(random(w) * w.villagers.length)];
    const b = w.villagers
      .filter((v) => v.id !== a.id && distance(v, a) < 4)
      .sort((x, y) => distance(x, a) - distance(y, a))[0];
    if (b) {
      const ids = [a.id, b.id].sort((x, y) => x - y),
        key = ids.join(":");
      const r = (w.relationships[key] ??= {
        a: ids[0],
        b: ids[1],
        affinity: 0,
        trust: 30,
        encounters: 0,
        lastTick: w.tick,
      });
      const warm = random(w) > 0.16;
      const boost = amenities.some((p) => distance(a, p) < 7) ? 2 : 1;
      r.affinity = Math.max(
        -100,
        Math.min(100, r.affinity + (warm ? 2 * boost : -3)),
      );
      r.trust = Math.max(0, Math.min(100, r.trust + (warm ? boost : -2)));
      r.encounters++;
      r.lastTick = w.tick;
      a.morale = Math.max(0, Math.min(100, a.morale + (warm ? 0.5 : -1)));
      if (r.affinity >= 20 && r.affinity - 2 * boost < 20)
        log(w, `${a.name} and ${b.name} are becoming familiar friends.`);
    }
  }
}
export function morale(w: World) {
  return Math.round(
    w.villagers.reduce((n, v) => n + v.morale, 0) / w.villagers.length,
  );
}
