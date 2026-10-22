import { icon } from "../icons";
import {
  RECRUIT_COST,
  RECRUIT_DURATION,
  RECRUIT_QUEUE_LIMIT,
  TECHS,
} from "../simulation/catalog";
import { capacity, recruitCount } from "../simulation/engine";
import { dimensions, perimeter } from "../simulation/grid";
import type { World } from "../simulation/types";

function activity(
  label: string,
  name: string,
  symbol: string,
  progress: number,
  status: string,
) {
  const percent = Math.floor(Math.min(1, Math.max(0, progress)) * 100);
  return `<article class="production-activity" aria-label="${label}">
    <div class="production-title">${icon(symbol, 16)}<strong>${name}</strong><span>${percent}%</span></div>
    <div class="meter" role="progressbar" aria-label="${name} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent}% · ${status}"><i style="width:${percent}%"></i></div>
    <p class="small-note">${status}</p>
  </article>`;
}

/** Independent markup regions keep queue scrolling/focus intact as progress changes.
 * Identical paid waiting orders are stored as a count and shown in arrival order.
 * Farms/workshops produce continuously, not in queues.
 */
export function productionMarkup(
  w: World,
  buildingId: number,
  paused: boolean,
) {
  const hall = w.buildings.find((b) => b.id === buildingId);
  if (hall?.kind !== "hall") return null;
  const count = recruitCount(w);
  const full = w.villagers.length >= capacity(w);
  let welcome: string;
  if (w.recruit === null) {
    welcome = `<p class="small-note">No villager on the way.${full ? " Housing or population limit reached." : w.stock.food < RECRUIT_COST ? ` Requires ${RECRUIT_COST} food to begin.` : " Use Welcome a villager to begin."}</p>`;
  } else {
    // Use the same spawning hall as the simulation (including imported multi-hall worlds).
    const spawnHall = w.buildings.find((b) => b.kind === "hall")!;
    const ready = w.recruit >= RECRUIT_DURATION;
    const status = ready
      ? full
        ? "Waiting for housing or a higher population limit"
        : !perimeter(w, spawnHall, ...dimensions(spawnHall)).length
          ? "Waiting for an open space beside the hall"
          : "Ready to arrive"
      : "Welcoming";
    welcome = activity(
      "Active villager welcome",
      "Villager ×1",
      "people",
      w.recruit / RECRUIT_DURATION,
      `${paused ? "Paused · " : ""}${status}`,
    );
  }
  const research = w.research
    ? activity(
        "Active village research",
        TECHS[w.research.id].name,
        "research",
        w.research.progress,
        paused ? "Paused · Researching" : "Researching",
      )
    : '<p class="small-note">No research in progress. Choose a technology in Knowledge tree.</p>';
  const queue = w.recruitQueue
    ? `<h4>Up next · ${w.recruitQueue}</h4><ol class="production-queue" start="2" tabindex="0" aria-label="Waiting villagers, in arrival order">${Array.from({ length: w.recruitQueue }, () => `<li><span>${icon("people", 14)} Villager ×1 <small>Paid</small></span></li>`).join("")}</ol>`
    : '<p class="small-note">No waiting villagers.</p>';
  return {
    welcome: `<h3>Welcome queue · ${count} / ${RECRUIT_QUEUE_LIMIT}</h3>${welcome}`,
    queue,
    research: `<h3>Village research</h3>${research}<p class="small-note production-note">Research progresses independently of the welcome queue.</p>`,
  };
}
