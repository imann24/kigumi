import type { Building, Order, ResourceNode, Villager, World } from "./types";

export type WorkKind = "chop" | "mine" | "pick" | "tend" | "craft";
export interface WorkActivity {
  kind: WorkKind;
  target: ResourceNode | Building;
  tick: number;
  order: Order;
}

// Presentation evidence only: never saved, never used to determine production.
// Recording AFTER approach succeeds also supports interior paddy work positions.
const activities = new WeakMap<Villager, WorkActivity>();
export function recordWork(
  w: World,
  v: Villager,
  kind: WorkKind,
  target: ResourceNode | Building,
) {
  activities.set(v, { kind, target, tick: w.tick, order: v.order });
}

export function workingActivity(w: World, v: Villager): WorkActivity | null {
  const activity = activities.get(v);
  if (
    !activity ||
    activity.tick !== w.tick ||
    activity.order !== v.order ||
    v.path.length ||
    v.blocked > 0 ||
    v.task.startsWith("Hauling") ||
    v.task === "No route to storage"
  )
    return null;
  const target = activity.target;
  if ("amount" in target) {
    if (target.amount <= 0 || !w.nodes.includes(target)) return null;
  } else if (target.progress < 1 || !w.buildings.includes(target)) return null;
  return activity;
}
