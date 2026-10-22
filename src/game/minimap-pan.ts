import type { Point } from "../simulation/types";

export function minimapPoint(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  size: number,
): Point | null {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(x + y + size))
    return null;
  return {
    x: Math.max(0, Math.min(size, ((x - rect.left) / rect.width) * size)),
    z: Math.max(0, Math.min(size, ((y - rect.top) / rect.height) * size)),
  };
}

export function installMinimapPan(
  canvas: HTMLCanvasElement,
  options: { size: () => number; start: () => void; move: (p: Point) => void },
) {
  let pointer: number | null = null;
  const move = (e: PointerEvent) => {
    // CSS coordinates, not backing-store pixels; recompute after layout/resize.
    const p = minimapPoint(
      canvas.getBoundingClientRect(),
      e.clientX,
      e.clientY,
      options.size(),
    );
    if (p) options.move(p);
  };
  const end = () => {
    const id = pointer;
    pointer = null;
    delete canvas.dataset.dragging;
    if (id !== null && canvas.hasPointerCapture(id))
      canvas.releasePointerCapture(id);
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.ctrlKey || pointer !== null) return;
    e.preventDefault();
    options.start();
    pointer = e.pointerId;
    canvas.dataset.dragging = "true";
    canvas.setPointerCapture(e.pointerId);
    move(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointer) return;
    if (!(e.buttons & 1)) {
      end();
      return;
    }
    move(e);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointer || e.button !== 0) return;
    move(e);
    end();
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerId === pointer) end();
  });
  canvas.addEventListener("lostpointercapture", end);
  window.addEventListener("blur", end);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") end();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) end();
  });
}
