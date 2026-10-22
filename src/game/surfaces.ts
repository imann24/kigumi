import { buildingAt } from "../simulation/grid";
import type { Point, World } from "../simulation/types";

/** The paddy water surface in art.ts is at 0.1475, above ordinary ground. */
export function paddyHeight(world: World, p: Point) {
  const b = buildingAt(world, Math.floor(p.x), Math.floor(p.z));
  return b?.kind === "farm" ? 0.15 * (0.15 + b.progress * 0.85) : 0;
}
