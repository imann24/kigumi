import {
  BUILDINGS,
  RECRUIT_COST,
  type BuildingKind,
} from "../simulation/catalog";
import { capacity, recruitCount, recruitError } from "../simulation/engine";
import type { Command, World } from "../simulation/types";
import type { Hit } from "../game/scene";
import { productionMarkup } from "../game/production";
import { icon } from "../icons";
import { $, escape, setMarkup } from "./dom";

export interface InspectorState {
  world: World;
  selected: number[];
  focus: Hit | null;
  paused: boolean;
}

export interface InspectorActions {
  select(ids: number[], hit?: Hit | null): void;
  dispatch(command: Command): boolean;
}

/** Render from current application state; commands and selection return to the coordinator. */
export function renderInspector(
  state: InspectorState,
  thumbs: Record<BuildingKind, string>,
  { select, dispatch }: InspectorActions,
) {
  const { world: w, selected, focus } = state;
  const el = $("inspector");
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
  renderProduction(state);
}
export function renderProduction({ world, focus, paused }: InspectorState) {
  const el = $("production-status");
  if (!el || focus?.type !== "building") return;
  const parts = productionMarkup(world, focus.id, paused);
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
