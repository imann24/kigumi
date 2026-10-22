/// <reference types="vite/client" />
import "./style.css";
import {
  BUILDINGS,
  RESOURCE_LABEL,
  RECRUIT_COST,
  TECHS,
  type BuildingKind,
  type Resource,
  type TechId,
} from "./simulation/catalog";
import {
  capacity,
  createWorld,
  morale,
  placementError,
  researchError,
  recruitCount,
  recruitError,
  STEP,
} from "./simulation/engine";
import { dimensions } from "./simulation/grid";
import {
  deserialize,
  loadLocal,
  saveLocal,
  serialize,
} from "./simulation/save";
import { LocalSession } from "./simulation/session";
import type { Command, Point, World } from "./simulation/types";
import { VillageScene, type Hit } from "./game/scene";
import {
  contextualCursor,
  contextualOrder,
  type ActionCursor,
} from "./game/contextual-actions";
import { installMinimapPan } from "./game/minimap-pan";
import { installSpacePan } from "./game/camera-pan";
import { thumbnails } from "./game/thumbnails";
import { productionMarkup } from "./game/production";
import { icon } from "./icons";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const markupCache = new WeakMap<HTMLElement, string>();
function setMarkup(el: HTMLElement, html: string) {
  if (markupCache.get(el) !== html) {
    el.innerHTML = html;
    markupCache.set(el, html);
  }
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let session: LocalSession;
let loadWarning = "";
try {
  session = new LocalSession(loadLocal() ?? createWorld());
} catch {
  session = new LocalSession(createWorld());
  loadWarning =
    "The autosave could not be read. A fresh village is open; your manual save is untouched.";
}
let selected: number[] = [],
  focus: Hit | null = null,
  build: BuildingKind | null = null,
  rotation = 0,
  speed = 1,
  grid = false,
  category = "all",
  modal = "",
  lastUi = 0,
  lastSave = 0,
  accumulator = 0,
  lastFrame = 0,
  saveFailed = false,
  lastTechs = "";
let erasing = false;
let pointer: Point | null = null,
  lastPaint = "",
  drag: { x: number; y: number; shift: boolean } | null = null;
const app = $("app");
app.innerHTML = `
  <canvas id="world" aria-label="Komorebi village. Select villagers with left click and give orders with right click."></canvas>
  <div class="vignette"></div>
  <header class="topbar">
    <div class="resources">${(["wood", "food", "stone", "insight"] as Resource[]).map((r) => `<div class="resource ${r}" title="${r === "insight" ? "Produced by the village hall and assigned workshop workers" : r === "food" ? "Gather berries or assign farmers to paddies. Villagers consume a little food over time." : `Gather ${r} and carry it to a hall or storehouse`}"><span class="resource-icon">${icon(r, 23)}</span><div><strong id="stock-${r}">0</strong><small>${RESOURCE_LABEL[r]}</small></div></div>`).join("")}</div>
    <button class="village-stat" id="population" title="Village overview">${icon("people", 21)}<span><strong id="pop">10 / 20</strong><small>Villagers</small></span></button>
    <button class="village-stat" id="community" title="Community and connections">${icon("heart", 20)}<span><strong id="morale">Content</strong><small id="morale-value">75% belonging</small></span></button>
  </header>
  <div class="top-actions"><span class="season">${icon("sun", 17)} <span id="day">Day 1</span></span><div class="time-controls"><button id="pause" aria-label="Pause" title="Pause / resume [tap Space]">${icon("pause", 16)}</button><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button></div><button class="square" id="save" aria-label="Save game" title="Save game [Ctrl / Cmd + S]">${icon("save")}</button><button class="square" id="settings" aria-label="Settings" title="Settings and saves">${icon("gear")}</button></div>
  <details class="journal chrome-panel" data-panel="journal"><summary>${icon("leaf", 16)} Progress & research</summary><div class="panel-content"><div id="milestones"></div><button id="research" class="text-button">Knowledge tree ${icon("arrow", 15)}</button></div></details>
  <details id="inspector-panel" class="inspector-panel chrome-panel" hidden open><summary>Selection</summary><aside id="inspector" class="inspector"></aside></details>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="build-hint" class="build-hint" hidden><div id="build-description"></div><output id="build-facing" aria-live="polite"></output><button id="rotate-building" title="Rotate building 90° [R]" aria-label="Rotate building 90 degrees">↶ Rotate 90° <kbd>R</kbd></button><span><kbd>Esc</kbd> Cancel</span></div>
  <div id="selection-box" class="selection-box" hidden></div>
  <details class="map-panel chrome-panel" data-panel="map" open><summary>${icon("flag", 13)} Map</summary><div class="panel-content"><button id="home" class="map-center" title="Center on the village [Home]">Center village ↗</button><canvas id="minimap" width="160" height="128" aria-label="Minimap; click or drag to move camera"></canvas><div class="map-footer"><span class="live-dot"></span><span id="save-status">Saved on this device</span></div></div></details>
  <details id="build-panel" class="build-panel chrome-panel" data-panel="build" open><summary>${icon("house", 17)} Build <kbd>B</kbd></summary><div class="build-body"><div class="build-heading"><div class="build-tabs"><button class="active" data-category="all">Homes & community</button><button data-category="production">Production</button><button data-category="paths">Paths & crossings</button></div><button id="grid" title="Show grid [G]">${icon("plus", 14)} Grid <kbd>G</kbd></button></div><div id="build-cards" class="build-cards"></div></div></details>
  <footer><button id="help" title="Controls and field guide [?]">${icon("help", 15)} Help <kbd>?</kbd></button></footer>
  <button id="chrome-toggle" class="square" aria-label="Hide interface" aria-pressed="false" title="Hide interface [H]">${icon("panels", 16)}</button>
  <div id="modal-layer" class="modal-layer" hidden></div><input id="import-file" type="file" accept=".json" hidden/>
`;
// Panel preferences belong to this device, independently of village saves.
const panels = Array.from(
  document.querySelectorAll<HTMLDetailsElement>("[data-panel]"),
);
try {
  const saved = JSON.parse(localStorage.getItem("kigumi.panels") ?? "{}");
  for (const panel of panels) {
    const value = saved?.[panel.dataset.panel!];
    if (typeof value === "boolean") panel.open = value;
  }
} catch {
  /* Keep defaults when storage is unavailable. */
}
for (const panel of panels)
  panel.addEventListener("toggle", () => {
    try {
      localStorage.setItem(
        "kigumi.panels",
        JSON.stringify(
          Object.fromEntries(panels.map((p) => [p.dataset.panel, p.open])),
        ),
      );
    } catch {
      /* Collapsing panels still works without storage. */
    }
  });
function toggleChrome() {
  const hidden = app.classList.toggle("chrome-hidden");
  const button = $("chrome-toggle");
  button.setAttribute("aria-pressed", String(hidden));
  button.setAttribute(
    "aria-label",
    hidden ? "Show interface" : "Hide interface",
  );
  button.title = `${hidden ? "Show" : "Hide"} interface [H]`;
  button.innerHTML = icon("panels", 16);
  if (hidden) {
    build = null;
    erasing = false;
    renderCards();
    updatePreview();
  }
}
let scene: VillageScene;
let thumbs: Record<BuildingKind, string>;
try {
  scene = new VillageScene($<HTMLCanvasElement>("world"));
  scene.setWorld(session.world);
  thumbs = thumbnails();
} catch (e) {
  app.innerHTML = `<div class="startup-error"><h1>Kigumi needs WebGL 2</h1><p>Your graphics context could not start. Try updating your graphics drivers or enabling hardware acceleration.</p><pre>${escape(String(e))}</pre></div>`;
  throw e;
}
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("toast").classList.remove("visible"),
    4200,
  );
}
let toastTimer = 0;
function dispatch(c: Command) {
  const result = session.dispatch(c);
  if (!result.ok) toast(result.message ?? "That action is not available.");
  else {
    scene.sync(session.world);
    renderUi();
  }
  cursorCache = null;
  scene.cursor.refresh();
  return result.ok;
}
function costMarkup(cost: Partial<Record<Resource, number>>) {
  return Object.entries(cost)
    .map(
      ([r, n]) =>
        `<span class="${session.world.stock[r as Resource] < n ? "short" : ""}">${icon(r, 12)} ${n}</span>`,
    )
    .join("");
}
function renderCards() {
  const keys = (Object.keys(BUILDINGS) as BuildingKind[]).filter(
    (k) =>
      k !== "hall" &&
      (category === "all"
        ? !["road", "bridge"].includes(k)
        : BUILDINGS[k].category === category),
  );
  $("build-cards").innerHTML =
    keys
      .map((k) => {
        const b = BUILDINGS[k],
          locked = b.tech && !session.world.techs.includes(b.tech);
        return `<button class="build-card ${build === k ? "selected" : ""} ${locked ? "locked" : ""}" data-build="${k}" title="${b.description}${locked ? ` Requires ${TECHS[b.tech!].name}.` : ""}" ${locked ? 'aria-disabled="true"' : ""}><span class="card-top">${locked ? '<span class="lock-label">RESEARCH</span>' : `<span class="footprint">${b.size.join(" × ")}</span>`}</span><img src="${thumbs[k]}" alt=""/><strong>${b.name}</strong><span class="cost">${costMarkup(b.cost)}</span></button>`;
      })
      .join("") +
    (category === "paths"
      ? `<button class="build-card ${erasing ? "selected" : ""}" id="erase-paths" title="Remove paths to make room for a new arrangement. Bridges can be removed if nobody is cut off."><span class="erase-icon">${icon("close", 28)}</span><strong>Lift a path</strong><span class="cost">Make room to rearrange</span></button>`
      : "");
  if ($("erase-paths"))
    $("erase-paths").onclick = () => {
      erasing = !erasing;
      build = null;
      lastPaint = "";
      renderCards();
      updatePreview();
    };
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-build]"))
    b.onclick = () => {
      erasing = false;
      const kind = b.dataset.build as BuildingKind;
      const def = BUILDINGS[kind];
      if (def.tech && !session.world.techs.includes(def.tech)) {
        openModal("research");
        return;
      }
      build = build === kind ? null : kind;
      // Each new choice starts facing south; repeated placements retain direction.
      rotation = 0;
      lastPaint = "";
      renderCards();
      updatePreview();
    };
}
function select(ids: number[], hit: Hit | null = null) {
  selected = ids;
  focus = hit;
  scene.select(selected, hit);
  const panel = $<HTMLDetailsElement>("inspector-panel");
  panel.hidden = !ids.length && !hit;
  panel.open = true;
  panel.querySelector("summary")!.textContent = "Selection";
  renderInspector();
  scene.cursor.refresh();
}
function renderInspector() {
  const w = session.world,
    el = $("inspector");
  const close = `<button class="close-small" id="clear-selection" aria-label="Clear selection">${icon("close", 16)}</button>`;
  const welcomeControl = `<button class="primary" id="welcome" aria-describedby="welcome-requirement">${icon("plus", 16)} <span class="welcome-label" id="welcome-label">Welcome a villager</span><span>${RECRUIT_COST} food</span></button><p class="small-note" id="welcome-requirement"></p>`;
  if (selected.length) {
    const villagers = w.villagers.filter((v) => selected.includes(v.id));
    const v = villagers[0];
    if (!v) {
      select([]);
      return;
    }
    const bonds = Object.values(w.relationships)
      .filter((r) => r.a === v.id || r.b === v.id)
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, 3);
    setMarkup(
      el,
      `${close}<span class="eyebrow">${villagers.length === 1 ? "VILLAGER" : "WORK PARTY"}</span><h2>${villagers.length === 1 ? escape(v.name) : `${villagers.length} villagers`}</h2><p class="status-line"><span class="live-dot"></span>${villagers.length === 1 ? escape(v.task) : "Ready for your direction"}</p><div class="inspector-rule"></div><div class="detail-row"><span>Feeling at home</span><b>${Math.round(villagers.reduce((n, a) => n + a.morale, 0) / villagers.length)}%</b></div><div class="meter"><i style="width:${v.morale}%"></i></div>${v.cargo ? `<div class="detail-row"><span>Carrying ${v.cargo.kind}</span><b>${Math.round(v.cargo.amount)} / ${w.techs.includes("wheelbarrow") ? 12 : 8}</b></div>` : ""}<p class="small-note">Right-click a resource to gather, a site to build, or open ground to move.</p><button class="wide-button ${villagers.every((a) => a.auto) ? "enabled" : ""}" id="auto-work">${icon("leaf", 16)} Auto-work ${villagers.every((a) => a.auto) ? "on" : "off"}</button><div class="button-row"><button id="stop-work">Stand by</button><button id="resume-work">Find work</button></div>${
        villagers.length === 1 && bonds.length
          ? `<div class="section-label connections-label">FAMILIAR FACES</div>${bonds
              .map((r) => {
                const other = w.villagers.find(
                  (a) => a.id === (r.a === v.id ? r.b : r.a),
                );
                return `<div class="detail-row"><span>${escape(other?.name ?? "Neighbor")}</span><small>${r.affinity > 20 ? "Friend" : r.affinity < 0 ? "Some friction" : "Acquaintance"} · ${r.trust} trust</small></div>`;
              })
              .join("")}`
          : ""
      }`,
    );
    $("auto-work").onclick = () =>
      dispatch({
        type: "auto",
        ids: selected,
        enabled: !villagers.every((a) => a.auto),
      });
    $("stop-work").onclick = () =>
      dispatch({ type: "order", ids: selected, order: { type: "idle" } });
    $("resume-work").onclick = () =>
      dispatch({ type: "order", ids: selected, order: { type: "auto" } });
  } else if (focus?.type === "building") {
    const b = w.buildings.find((b) => b.id === focus!.id);
    if (!b) {
      select([]);
      return;
    }
    const def = BUILDINGS[b.kind];
    const workers = w.villagers.filter(
      (v) => "target" in v.order && v.order.target === b.id,
    );
    setMarkup(
      el,
      `${close}<span class="eyebrow">${b.progress < 1 ? "UNDER CONSTRUCTION" : "VILLAGE BUILDING"}</span><img class="inspector-art" src="${thumbs[b.kind]}" alt=""/><h2>${def.name}</h2><p>${def.description}</p>${b.progress < 1 ? `<div class="detail-row"><span>Construction</span><b>${Math.floor(b.progress * 100)}%</b></div><div class="meter"><i style="width:${b.progress * 100}%"></i></div>` : ""}<div class="detail-row"><span>Assigned villagers</span><b>${workers.length}</b></div>${workers.length ? `<p class="small-note">${workers.map((v) => escape(v.name)).join(", ")}</p><button class="wide-button" id="select-workers">Select workers</button>` : ""}${b.kind === "hall" ? `<div id="production-status"></div>${welcomeControl}` : ""}${b.kind === "farm" || b.kind === "workshop" || b.progress < 1 ? `<button class="wide-button" id="assign-nearest">${icon("people", 16)} Assign nearest villager</button>` : ""}${b.kind !== "hall" ? '<button class="danger-link" id="demolish">Dismantle · recover 50%</button>' : ""}`,
    );
    if ($("select-workers"))
      $("select-workers").onclick = () => select(workers.map((v) => v.id));
    if ($("welcome"))
      $("welcome").onclick = () => dispatch({ type: "recruit" });
    if ($("assign-nearest"))
      $("assign-nearest").onclick = () => {
        const candidates = w.villagers
          .filter((v) => !workers.some((a) => a.id === v.id))
          .sort(
            (a, c) =>
              Math.hypot(a.x - b.x, a.z - b.z) -
              Math.hypot(c.x - b.x, c.z - b.z),
          );
        if (candidates[0])
          dispatch({
            type: "order",
            ids: [candidates[0].id],
            order: { type: b.progress < 1 ? "build" : "work", target: b.id },
          });
      };
    if ($("demolish"))
      $("demolish").onclick = () => {
        if (dispatch({ type: "demolish", id: b.id })) select([]);
      };
  } else if (focus?.type === "resource") {
    const n = w.nodes.find((n) => n.id === focus!.id);
    if (!n || n.amount <= 0) {
      select([]);
      return;
    }
    setMarkup(
      el,
      `${close}<span class="eyebrow">NATURAL RESOURCE</span><h2>${n.kind === "wood" ? "Woodland" : n.kind === "stone" ? "Stone outcrop" : "Wild berries"}</h2><p>${Math.ceil(n.amount)} ${n.kind === "food" ? "food" : n.kind} remaining</p><p class="small-note">Select villagers, then right-click here to gather. A nearby storehouse will shorten their trips.</p>`,
    );
  } else {
    setMarkup(
      el,
      `<span class="eyebrow">A PLACE TO BELONG</span><h2>Village life</h2><div class="village-portrait">${icon("hall", 34)}<span>Growing gently.<small>Every path is a possibility.</small></span></div><div class="detail-row"><span>Homes & gathering places</span><b>${w.buildings.filter((b) => b.progress === 1 && ["hall", "house", "tea", "shrine"].includes(b.kind)).length}</b></div><div class="detail-row"><span>Working villagers</span><b>${w.villagers.filter((v) => !["idle", "move"].includes(v.order.type)).length} / ${w.villagers.length}</b></div><div class="detail-row"><span>Space to grow</span><b>${Math.max(0, capacity(w) - w.villagers.length - recruitCount(w))} unreserved places</b></div>${welcomeControl}<p class="small-note">${recruitCount(w)} villagers on the way. Select the hall to see the welcome queue and research.</p><div class="inspector-rule"></div><span class="eyebrow">AROUND THE VILLAGE</span><p class="latest-event">${escape(w.log.at(-1)?.text ?? "")}</p>`,
    );
    $("welcome").onclick = () => dispatch({ type: "recruit" });
  }
  $("inspector-panel").querySelector("summary")!.textContent =
    el.querySelector("h2")?.textContent ?? "Selection";
  if ($("clear-selection")) $("clear-selection").onclick = () => select([]);
  const welcome = $<HTMLButtonElement>("welcome");
  if (welcome) {
    const error = recruitError(w);
    welcome.disabled = !!error;
    welcome.title = error ?? "Reserve one place and pay for a villager";
    $("welcome-label").textContent =
      w.recruit === null ? "Welcome a villager" : "Queue a villager";
    $("welcome-requirement").textContent =
      error ?? `${RECRUIT_COST} food and one place reserved per order.`;
  }
  renderProduction();
}
function renderProduction() {
  const el = $("production-status");
  if (!el || focus?.type !== "building") return;
  const parts = productionMarkup(
    session.world,
    focus.id,
    !speed || !!modal || document.hidden,
  );
  if (!parts) return;
  setMarkup(
    el,
    `<section class="production-status" aria-label="Production and research"><div id="welcome-active"></div><div id="welcome-queue" tabindex="-1"></div><div id="research-active"></div></section>`,
  );
  setMarkup($("welcome-active"), parts.welcome);
  const queue = $("welcome-queue");
  queue.onkeydown = (e) => {
    // Let the focused list scroll without panning the camera or toggling pause.
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Space",
      ].includes(e.code)
    )
      e.stopPropagation();
  };
  const oldList = queue.querySelector("ol"),
    scroll = oldList?.scrollTop ?? 0;
  const focused = document.activeElement === oldList;
  setMarkup(queue, parts.queue);
  const list = queue.querySelector("ol");
  if (list) list.scrollTop = scroll;
  if (focused && document.activeElement !== list)
    (list ?? queue).focus({ preventScroll: true });
  setMarkup($("research-active"), parts.research);
}
function renderUi() {
  const w = session.world;
  if (w.techs.join(":") !== lastTechs) {
    lastTechs = w.techs.join(":");
    renderCards();
  }
  for (const r of ["wood", "food", "stone", "insight"] as Resource[])
    $("stock-" + r).textContent = Math.floor(w.stock[r]).toLocaleString();
  $("pop").textContent = `${w.villagers.length} / ${capacity(w)}`;
  const m = morale(w);
  $("morale").textContent =
    m >= 70 ? "Content" : m >= 50 ? "Settling in" : "Unsettled";
  $("morale-value").textContent = `${m}% belonging`;
  $("day").textContent = `Day ${1 + Math.floor((w.tick * STEP) / 240)}`;
  const steps = [
    {
      text: "Give your villagers a direction",
      done: w.scenario.flags.directed,
    },
    {
      text: "Build a place to call home",
      done:
        w.buildings.filter((b) => b.kind === "house" && b.progress >= 1)
          .length > 2,
    },
    { text: "Discover your first tradition", done: w.techs.length > 0 },
  ];
  $("milestones").innerHTML = steps
    .map(
      (s, i) =>
        `<div class="milestone ${s.done ? "done" : ""}"><span>${s.done ? icon("check", 12) : `0${i + 1}`}</span>${s.text}</div>`,
    )
    .join("");
  renderInspector();
  drawMap();
  if (modal === "research") renderResearch();
}
function updatePreview() {
  scene.cursor.refresh();
  const hint = $("build-hint");
  hint.hidden = !build && !erasing;
  const rotatable = !!build && BUILDINGS[build].category !== "paths";
  $("rotate-building").hidden = !rotatable;
  $("build-facing").hidden = !rotatable;
  if (rotatable) {
    const facing = `Facing ${["South", "East", "North", "West"][rotation]} · ${dimensions({ kind: build!, rotation }).join(" × ")}`;
    if ($("build-facing").textContent !== facing)
      $("build-facing").textContent = facing;
  }
  hint.classList.remove("invalid");
  if (erasing) {
    scene.preview(pointer ? "road" : null, pointer ?? undefined, 0, false);
    setMarkup(
      $("build-description"),
      `${icon("close", 18)} <b>Lift a path</b><span class="placement-message">Click or drag to remove paths</span>`,
    );
    return;
  }
  if (build) {
    const error = pointer
      ? placementError(
          session.world,
          build,
          Math.floor(pointer.x),
          Math.floor(pointer.z),
          rotation,
        )
      : null;
    scene.preview(
      pointer ? build : null,
      pointer ?? undefined,
      rotation,
      !error,
    );
    setMarkup(
      $("build-description"),
      `${icon(build, 18)} <b>${BUILDINGS[build].name}</b><span class="placement-message">${error ?? (pointer ? "Click to place" : "Point at the island to place")}</span>`,
    );
    hint.classList.toggle("invalid", !!error);
  } else scene.preview(null);
  if (!build && grid) scene.showGrid(true);
}
function rotateBuilding() {
  if (!build || BUILDINGS[build].category === "paths" || modal) return;
  rotation = (rotation + 1) % 4;
  lastPaint = "";
  updatePreview();
}
$("rotate-building").onclick = rotateBuilding;
function place() {
  if ((!build && !erasing) || !pointer) return;
  const x = Math.floor(pointer.x),
    z = Math.floor(pointer.z),
    key = `${x}:${z}`;
  if (key === lastPaint) return;
  lastPaint = key;
  if (erasing) {
    dispatch({ type: "removePath", x, z });
    return;
  }
  if (
    dispatch({
      type: "place",
      kind: build!,
      x,
      z,
      rotation,
      villagers: selected,
    })
  ) {
    updatePreview();
    renderCards();
  }
}
function drawMap() {
  const canvas = $<HTMLCanvasElement>("minimap"),
    ctx = canvas.getContext("2d")!,
    w = session.world,
    sx = canvas.width / w.size,
    sz = canvas.height / w.size;
  ctx.fillStyle = "#abb98f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < w.terrain.length; i++)
    if (w.terrain[i]) {
      ctx.fillStyle = "#87aaa4";
      ctx.fillRect(
        (i % w.size) * sx,
        Math.floor(i / w.size) * sz,
        sx + 0.3,
        sz + 0.3,
      );
    }
  ctx.fillStyle = "#d5c9a9";
  for (const i of [...w.roads, ...w.bridges])
    ctx.fillRect((i % w.size) * sx, Math.floor(i / w.size) * sz, sx, sz);
  for (const n of w.nodes) {
    if (n.amount <= 0) continue;
    ctx.fillStyle =
      n.kind === "wood"
        ? "#607e62"
        : n.kind === "stone"
          ? "#888e80"
          : "#b7896b";
    ctx.fillRect(n.x * sx, n.z * sz, sx, sz);
  }
  for (const b of w.buildings) {
    const [a, c] = dimensions(b);
    ctx.fillStyle =
      b.kind === "farm" ? "#bed09b" : b.progress < 1 ? "#d0b788" : "#775b45";
    ctx.fillRect(b.x * sx, b.z * sz, a * sx, c * sz);
  }
  for (const v of w.villagers) {
    ctx.fillStyle = selected.includes(v.id) ? "#fff7c9" : "#f5e7bd";
    ctx.fillRect(v.x * sx - 1, v.z * sz - 1, 2, 2);
  }
  ctx.strokeStyle = "#fff9dd";
  ctx.lineWidth = 1;
  const rect = scene.canvas.getBoundingClientRect();
  const corners = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ].map(([x, y]) => scene.pointerWorld(x, y));
  if (corners.every((p) => p !== null)) {
    ctx.beginPath();
    corners.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * sx, p.z * sz);
      else ctx.lineTo(p.x * sx, p.z * sz);
    });
    ctx.closePath();
    ctx.stroke();
  }
}
function save(manual = false) {
  try {
    saveLocal(session.world, manual);
    saveFailed = false;
    $("save-status").textContent = manual
      ? "Village saved."
      : "Autosaved · on this device";
    if (manual) toast("Village saved on this device.");
  } catch {
    if (!saveFailed)
      toast(
        "Unable to save locally. Export your village from Settings to keep it.",
      );
    saveFailed = true;
    $("save-status").textContent = "Save unavailable — export a copy";
  }
}
function replaceWorld(w: World) {
  session = new LocalSession(w);
  selected = [];
  focus = null;
  build = null;
  erasing = false;
  scene.setWorld(w);
  scene.select([]);
  $("inspector-panel").hidden = true;
  accumulator = 0;
  lastFrame = performance.now();
  closeModal();
  renderCards();
  renderUi();
  updatePreview();
  save();
}
function closeModal() {
  modal = "";
  renderProduction();
  $("modal-layer").hidden = true;
  $("modal-layer").innerHTML = "";
  lastFrame = performance.now();
}
function modalShell(title: string, subtitle: string, body: string) {
  $("modal-layer").hidden = false;
  $("modal-layer").innerHTML =
    `<section class="modal" role="dialog" aria-modal="true" aria-label="${title}"><button id="close-modal" class="modal-close" aria-label="Close">${icon("close")}</button><span class="eyebrow">FIELD NOTES</span><h2>${title}</h2><p class="modal-subtitle">${subtitle}</p>${body}</section>`;
  $("close-modal").onclick = closeModal;
  $("close-modal").focus();
  scene.cursor.clear();
}
function renderResearch() {
  const w = session.world;
  const html = Object.entries(TECHS)
    .map(([id, t]) => {
      const done = w.techs.includes(id as TechId),
        active = w.research?.id === id,
        error = researchError(w, id as TechId);
      return `<article class="tech-card ${done ? "researched" : ""}"><div class="tech-icon">${icon(id === "agriculture" ? "food" : id === "community" ? "tea" : id === "wheelbarrow" ? "road" : "workshop", 25)}</div><span class="eyebrow">${t.requires.length ? "BUILDING ON " + t.requires.map((r) => TECHS[r].name.toUpperCase()).join(" + ") : "FOUNDATION"}</span><h3>${t.name}</h3><p>${t.description}</p>${t.building ? `<small>Requires a completed ${BUILDINGS[t.building].name.toLowerCase()}</small>` : ""}<div class="tech-bottom"><span class="cost">${costMarkup(t.cost)}</span><button data-tech="${id}" ${error ? "disabled" : ""} title="${error ?? "Begin research"}">${done ? "✓ Learned" : active ? `${Math.floor(w.research!.progress * 100)}%` : "Research"}</button></div>${active ? `<div class="meter"><i style="width:${w.research!.progress * 100}%"></i></div>` : ""}</article>`;
    })
    .join("");
  if ($("research-grid")) $("research-grid").innerHTML = html;
  else
    modalShell(
      "Small discoveries. Lasting change.",
      "Knowledge grows from everyday life. Research continues when you return to the village.",
      `<div id="research-grid" class="research-grid">${html}</div><p class="small-note">The village hall slowly produces insight. Assign craftspeople to workshops to learn faster.</p>`,
    );
  document.querySelectorAll<HTMLButtonElement>("[data-tech]").forEach(
    (b) =>
      (b.onclick = () => {
        if (dispatch({ type: "research", id: b.dataset.tech as TechId })) {
          closeModal();
          renderCards();
          toast("Research has begun. Let village life continue.");
        }
      }),
  );
}
function openModal(type: string) {
  modal = type;
  renderProduction();
  if (type === "research") {
    renderResearch();
    return;
  }
  if (type === "help") {
    modalShell(
      "A village, at your own pace.",
      "There is no finish line. Find a rhythm, make connections, and build somewhere worth belonging.",
      `<div class="guide-grid"><article>${icon("people", 27)}<h3>Give a little direction</h3><p>Click a villager or drag a selection box. Shift adds to your selection. Right-click resources to gather, unfinished buildings to construct, paddies or workshops to assign work, and ground to move.</p></article><article>${icon("road", 27)}<h3>Make every journey count</h3><p>Workers carry resources to the nearest reachable hall or storehouse. Paths make walking 45% faster. Keep routes open around buildings. Drag to lay paths; build bridges tile by tile across water. Use Lift a path to rearrange routes.</p></article><article>${icon("house", 27)}<h3>Grow thoughtfully</h3><p>Select a building below, then place it on the grid. R or Rotate 90° cycles through four directions; Escape cancels. A new building choice starts facing South. Selected villagers build it, or two nearby auto-workers help. Homes increase capacity. Welcome villagers for 35 food.</p></article><article>${icon("heart", 27)}<h3>Leave room for togetherness</h3><p>Villagers meet as their paths cross. Shared traditions unlock tea houses and shrines, improving nearby morale and bonds. Food shortages gently reduce morale and work speed; nobody dies.</p></article></div><div class="shortcut-list"><span><kbd>Tap Space</kbd> Pause</span><span><kbd>Space + left drag</kbd> Pan</span><span><kbd>WASD / arrows</kbd> Pan</span><span><kbd>Q / E</kbd> Rotate</span><span><kbd>Middle drag</kbd> Orbit</span><span><kbd>Scroll</kbd> Zoom at cursor</span><span><kbd>B</kbd> Build panel</span><span><kbd>H</kbd> Hide interface</span><span><kbd>G</kbd> Grid</span><span><kbd>I</kbd> Select idle</span><span><kbd>Minimap drag</kbd> Pan</span><span><kbd>Home</kbd> Center</span><span><kbd>1 / 2 / 4</kbd> Speed</span><span><kbd>Ctrl / Cmd + S</kbd> Save</span></div><p class="small-note">Auto-work finds a new job when a resource is exhausted or construction finishes. Explicit move orders end in standing by. Your village pauses while a menu is open or the game is closed.</p>`,
    );
  } else if (type === "settings") {
    modalShell(
      "Your corner of the world.",
      "Local saves, a little fine-tuning, and a fresh beginning whenever you want one.",
      `<div class="settings-row"><div><h3>Population limit</h3><p>Housing still determines available places.</p></div><input id="population-limit" type="number" min="10" max="500" value="${session.world.config.maxPopulation}"/><button id="apply-limit">Apply</button></div><div class="settings-row"><div><h3>Keep this village</h3><p>Autosaved every 30 seconds. Manual saves use a separate slot.</p></div><button id="manual-save">Save</button><button id="manual-load">Load manual</button></div><div class="settings-row"><div><h3>Take a copy with you</h3><p>Export a JSON save to move between devices.</p></div><button id="export">Export</button><button id="import">Import</button></div><div class="settings-row"><div><h3>A new clearing</h3><p>Save or export first. Starting over replaces the autosave.</p></div><input id="new-seed" type="number" value="${session.world.seed}" min="0" max="4294967295" aria-label="World seed"/><button id="new-village">New village</button></div><p class="small-note">Desktop · mouse & keyboard · fully offline. All art is generated locally. No accounts, telemetry, or online services.</p>`,
    );
    $("apply-limit").onclick = () => {
      if (
        dispatch({
          type: "config",
          maxPopulation: Number($<HTMLInputElement>("population-limit").value),
        })
      )
        toast("Population limit updated.");
    };
    $("manual-save").onclick = () => save(true);
    $("manual-load").onclick = () => {
      try {
        const w = loadLocal(true);
        if (w) {
          replaceWorld(w);
          toast("Manual save loaded.");
        } else toast("No manual save yet.");
      } catch {
        toast("The manual save could not be read.");
      }
    };
    $("export").onclick = () => {
      const blob = new Blob([serialize(session.world)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `kigumi-day-${1 + Math.floor((session.world.tick * STEP) / 240)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $("import").onclick = () => $<HTMLInputElement>("import-file").click();
    $("new-village").onclick = () => {
      const seed = Number($<HTMLInputElement>("new-seed").value);
      if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
        toast("Choose a seed from 0 to 4294967295.");
        return;
      }
      modalShell(
        "Begin again?",
        "Your manual save will remain. The current autosave will be replaced.",
        `<div class="confirm-actions"><button id="cancel-new">Keep this village</button><button class="primary" id="confirm-new">Start a new village</button></div>`,
      );
      $("cancel-new").onclick = () => openModal("settings");
      $("confirm-new").onclick = () => replaceWorld(createWorld(seed));
    };
  } else if (type === "community") {
    const w = session.world,
      bonds = Object.values(w.relationships)
        .sort((a, b) => b.encounters - a.encounters)
        .slice(0, 8);
    modalShell(
      "The ties between us.",
      "Little encounters, familiar faces, and a growing sense of home.",
      `<div class="community-summary"><strong>${morale(w)}<small>VILLAGE MORALE</small></strong><strong>${Object.values(w.relationships).filter((r) => r.affinity >= 20).length}<small>FRIENDSHIPS</small></strong><strong>${w.villagers.length}<small>NEIGHBORS</small></strong></div><div class="bonds">${bonds.length ? bonds.map((r) => `<div class="bond-row"><span>${escape(w.villagers.find((v) => v.id === r.a)?.name ?? "")} <span class="muted">&</span> ${escape(w.villagers.find((v) => v.id === r.b)?.name ?? "")}</span><span>${r.affinity >= 20 ? "Growing friendship" : r.affinity < 0 ? "A little friction" : "Getting acquainted"}</span><small>${r.encounters} encounters · ${r.trust} trust</small></div>`).join("") : "<p>Give everyone a little time to settle in. Connections form when villagers share space.</p>"}</div><p class="small-note">Tea houses and shrines improve nearby morale. Shared spaces help connections form; scarce food can make village life feel harder.</p>`,
    );
  }
}
// Interaction stays on the canvas; UI never leaks placement clicks into the world.
const canvas = $<HTMLCanvasElement>("world");
// Cache expensive placement checks per tile/tick. Contextual orders read live
// selection, positions and reservations; their terrain connectivity cache only
// changes with navigation/access, never merely because the simulation tick advanced.
let cursorCache: {
  world: World;
  key: string;
  value: ActionCursor | null;
} | null = null;
scene.cursor.resolve = (x, y) => {
  if (modal || erasing || drag || (!build && !selected.length)) return null;
  const w = session.world;
  if (!build) return contextualCursor(w, selected, scene.hit(x, y), null);
  const p = scene.pointerWorld(x, y);
  const key = `${w.tick}:${build}:${rotation}:${p ? `${Math.floor(p.x)},${Math.floor(p.z)}` : ""}`;
  if (cursorCache?.world === w && cursorCache.key === key)
    return cursorCache.value;
  const value = contextualCursor(w, selected, null, p, build, rotation);
  cursorCache = { world: w, key, value };
  return value;
};

const cameraPan = installSpacePan(scene, {
  enabled: () => !modal,
  tap: () => setSpeed(speed ? 0 : 1),
  start: () => {
    drag = null;
    $("selection-box").hidden = true;
  },
  move: (from, to) => scene.panPointer(from, to),
  hover: (x, y) => {
    pointer = scene.pointerWorld(x, y);
    updatePreview();
  },
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.ctrlKey) return;
  pointer = scene.pointerWorld(e.clientX, e.clientY);
  if (build || erasing) {
    lastPaint = "";
    place();
    drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    return;
  }
  drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.defaultPrevented) return;
  pointer = scene.pointerWorld(e.clientX, e.clientY);
  updatePreview();
  if (!drag) return;
  if (build || erasing) {
    if ((build === "road" || build === "bridge" || erasing) && e.buttons & 1)
      place();
    return;
  }
  const box = $("selection-box");
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
    box.hidden = false;
    Object.assign(box.style, {
      left: Math.min(e.clientX, drag.x) + "px",
      top: Math.min(e.clientY, drag.y) + "px",
      width: Math.abs(e.clientX - drag.x) + "px",
      height: Math.abs(e.clientY - drag.y) + "px",
    });
  }
});
// Native secondary clicks (including macOS Control-click) may not emit a
// matching right-button pointerup. Handle the context action exactly once.
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (modal) return;
  if (build || erasing) {
    build = null;
    erasing = false;
    renderCards();
    updatePreview();
    return;
  }
  if (!selected.length) {
    toast("Select a villager first, then right-click to give an order.");
    return;
  }
  const hit = scene.hit(e.clientX, e.clientY),
    p = scene.pointerWorld(e.clientX, e.clientY);
  const order = contextualOrder(session.world, hit, p);
  if (!order && hit?.type === "building")
    toast("Right-click a paddy, workshop, resource, or open ground.");
  if (order && dispatch({ type: "order", ids: selected, order })) {
    if (order.type === "gather") scene.flashResource(order.target);
    toast(
      order.type === "move"
        ? "On our way."
        : order.type === "gather"
          ? "Gathering party assigned."
          : order.type === "build"
            ? "Let’s get building."
            : "Workers assigned.",
    );
  }
});
window.addEventListener("pointerup", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || !drag) return;
  const start = drag;
  drag = null;
  $("selection-box").hidden = true;
  if (build || erasing) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
    const ids = scene.inRectangle(start.x, start.y, e.clientX, e.clientY);
    select(start.shift ? [...new Set([...selected, ...ids])] : ids);
    return;
  }
  const hit = scene.hit(e.clientX, e.clientY);
  if (hit?.type === "villager")
    select(start.shift ? [...new Set([...selected, hit.id])] : [hit.id]);
  else select([], hit);
});
function setSpeed(n: number) {
  speed = n;
  document
    .querySelectorAll<HTMLButtonElement>("[data-speed]")
    .forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.speed) === n),
    );
  $("pause").innerHTML = icon(n ? "pause" : "play", 16);
  $("pause").setAttribute("aria-label", n ? "Pause" : "Resume");
  renderProduction();
}
$("pause").onclick = () => setSpeed(speed ? 0 : 1);
document
  .querySelectorAll<HTMLButtonElement>("[data-speed]")
  .forEach((b) => (b.onclick = () => setSpeed(Number(b.dataset.speed))));
$("save").onclick = () => save(true);
$("settings").onclick = () => openModal("settings");
$("help").onclick = () => openModal("help");
$("research").onclick = () => openModal("research");
$("community").onclick = () => openModal("community");
$("population").onclick = () => {
  select([]);
  $("inspector-panel").hidden = false;
  $("inspector-panel").querySelector("summary")!.textContent = "Village";
};
$("chrome-toggle").onclick = toggleChrome;
$("home").onclick = () => scene.home();
$("grid").onclick = () => {
  grid = !grid;
  scene.showGrid(grid || !!build);
  $("grid").classList.toggle("active", grid);
};
installMinimapPan($<HTMLCanvasElement>("minimap"), {
  size: () => session.world.size,
  start: () => {
    cameraPan.cancel();
    drag = null;
    $("selection-box").hidden = true;
  },
  move: (p) => {
    scene.focus(p);
    drawMap();
  },
});
canvas.addEventListener("wheel", (e) => {
  pointer = scene.pointerWorld(e.clientX, e.clientY);
  updatePreview();
  drawMap();
});
scene.controls.addEventListener("change", drawMap);
$("modal-layer").onclick = (e) => {
  if (e.target === $("modal-layer")) closeModal();
};
$<HTMLInputElement>("import-file").onchange = async (e) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    const w = deserialize(await file.text());
    replaceWorld(w);
    toast("Village imported. Welcome back.");
  } catch (error) {
    toast(
      error instanceof Error ? error.message : "Unable to import this save.",
    );
  }
  input.value = "";
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-category]",
))
  button.onclick = () => {
    category = button.dataset.category!;
    document
      .querySelectorAll("[data-category]")
      .forEach((b) => b.classList.toggle("active", b === button));
    renderCards();
  };
window.addEventListener("keydown", (e) => {
  if (e.code === "Tab" && modal) {
    const items = Array.from(
      $("modal-layer").querySelectorAll<HTMLElement>(
        "button:not([disabled]),input,a[href]",
      ),
    );
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
    e.preventDefault();
    save(true);
    return;
  }
  if (e.code === "Escape") {
    closeModal();
    build = null;
    erasing = false;
    drag = null;
    $("selection-box").hidden = true;
    renderCards();
    updatePreview();
    return;
  }
  if (e.target instanceof HTMLInputElement || modal) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code))
    e.preventDefault();
  if (e.repeat) return;
  if (e.code === "KeyH" && !e.ctrlKey && !e.metaKey && !e.altKey)
    toggleChrome();
  if (e.code === "KeyB" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (app.classList.contains("chrome-hidden")) toggleChrome();
    const panel = $<HTMLDetailsElement>("build-panel");
    panel.open = !panel.open;
  }
  if (e.code === "KeyR" && build && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    rotateBuilding();
  }
  if (e.code === "KeyG") $("grid").click();
  if (e.code === "Home") scene.home();
  if (e.code === "KeyI")
    select(
      session.world.villagers
        .filter(
          (v) => v.order.type === "idle" || v.task === "No reachable work",
        )
        .map((v) => v.id),
    );
  if (e.key === "?") openModal("help");
  if (["Digit1", "Digit2", "Digit4"].includes(e.code))
    setSpeed(Number(e.code.at(-1)));
});
window.addEventListener("beforeunload", () => save());
document.addEventListener("visibilitychange", () => {
  lastFrame = performance.now();
  if (document.hidden) save();
  renderProduction();
});
let animationFrame = 0;
function frame(now: number) {
  animationFrame = requestAnimationFrame(frame);
  const dt = Math.min(0.15, (now - lastFrame) / 1000 || 0);
  lastFrame = now;
  if (!modal && !document.hidden) {
    accumulator += dt * speed;
    while (accumulator >= STEP) {
      scene.captureMovement(session.world);
      session.advance();
      accumulator -= STEP;
    }
    if (now - lastUi > 250) {
      scene.sync(session.world);
      renderUi();
      lastUi = now;
    }
  }
  scene.frame(
    now,
    accumulator / STEP,
    modal || document.hidden ? 0 : dt * speed,
  );
  if (now - lastSave > 30000) {
    save();
    lastSave = now;
  }
  if (now % 2000 < 30 && build) updatePreview();
}
renderCards();
renderUi();
animationFrame = requestAnimationFrame(frame);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(animationFrame);
    scene.dispose();
  });
if (loadWarning) toast(loadWarning);
