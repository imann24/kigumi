import { dimensions } from "../simulation/grid";
import type { World } from "../simulation/types";
import type { VillageScene } from "../game/scene";

/** Draw world state and the camera footprint without owning camera gestures. */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  w: World,
  selected: number[],
  scene: Pick<VillageScene, "canvas" | "pointerWorld">,
) {
  const ctx = canvas.getContext("2d")!,
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
