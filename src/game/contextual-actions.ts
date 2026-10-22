import type { BuildingKind } from "../simulation/catalog";
import { approachPath, orderError, placementError } from "../simulation/engine";
import { dimensions, farmWorkSpots, perimeter } from "../simulation/grid";
import type { Order, Point, World } from "../simulation/types";
import type { Hit } from "./scene";

export type ActionCursor =
  "wood" | "stone" | "food" | "build" | "farm" | "craft";

/** Both context-menu commands and hover feedback use the rendered entity hit. */
export function contextualOrder(
  w: World,
  hit: Hit | null,
  p: Point | null,
): Order | undefined {
  if (hit?.type === "resource") return { type: "gather", target: hit.id };
  if (hit?.type === "building") {
    const b = w.buildings.find((b) => b.id === hit.id);
    if (b && b.progress < 1) return { type: "build", target: b.id };
    if (b && (b.kind === "farm" || b.kind === "workshop"))
      return { type: "work", target: b.id };
    return;
  }
  if (p) return { type: "move", target: p };
}

export function contextualCursor(
  w: World,
  ids: number[],
  hit: Hit | null,
  p: Point | null,
  build: BuildingKind | null = null,
  rotation = 0,
): ActionCursor | null {
  // Placement can automatically assign builders, and paths need no workers.
  if (build)
    return p &&
      !placementError(w, build, Math.floor(p.x), Math.floor(p.z), rotation)
      ? "build"
      : null;
  const order = contextualOrder(w, hit, p);
  if (!order || orderError(w, ids, order)) return null;
  if (
    order.type !== "gather" &&
    order.type !== "build" &&
    order.type !== "work"
  )
    return null;
  const target =
    order.type === "gather"
      ? w.nodes.find((n) => n.id === order.target)!
      : w.buildings.find((b) => b.id === order.target)!;
  const farm =
    order.type === "work" && "progress" in target && target.kind === "farm"
      ? target
      : null;
  const goals = farm
    ? farmWorkSpots(w, farm)
    : "progress" in target
      ? perimeter(w, target, ...dimensions(target))
      : perimeter(w, target);
  // Match the simulation's approach routing. A mixed group is useful when at
  // least one selected villager can reach the target; never advertise a sealed site.
  if (
    !w.villagers.some(
      (v) => ids.includes(v.id) && approachPath(w, v, goals, farm?.id) !== null,
    )
  )
    return null;
  if (order.type === "gather")
    return w.nodes.find((n) => n.id === order.target)!.kind;
  if (order.type === "build") return "build";
  return target.kind === "farm" ? "farm" : "craft";
}
