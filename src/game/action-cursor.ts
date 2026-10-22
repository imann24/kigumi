import type { ActionCursor } from "./contextual-actions";

// Original, local artwork. A precise arrow tip remains at (2, 2); the tool sits
// beside it so that the action never obscures the actual picking hotspot.
const drawings: Record<ActionCursor, string> = {
  wood: '<path d="m17 28 9-19 3 2-9 19z"/><path d="m22 10-6-2-4 8 8 3 4-6z"/>',
  stone:
    '<path d="m15 28 9-18 3 2-9 18z"/><path d="M12 15q8-12 18-3l-1 3q-7-6-17 0Z"/>',
  food: '<path d="M16 22q-2-10 8-10-1 8-8 10Z"/><path d="m18 20 5-6"/><circle cx="15" cy="24" r="4"/><circle cx="24" cy="24" r="4"/><circle cx="20" cy="29" r="3"/>',
  build: '<path d="m14 28 10-16 3 2-10 16z"/><path d="m19 10 4-5 9 7-4 5z"/>',
  farm: '<path d="m16 29 7-19 3 1-7 19z"/><path d="m15 10 15 5-1 4-15-5z"/><path d="M12 31h17"/>',
  craft:
    '<path d="m22 9 2 4 4-1 1 4 4 2-2 4 1 4-4 1-2 4-4-2-4 1-1-4-4-2 2-4-1-4 4-1z"/><circle cx="23" cy="21" r="4"/>',
};
export const cursorImages = Object.fromEntries(
  Object.entries(drawings).map(([action, drawing]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><g stroke="#fff4d9" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" fill="#6b8571">${drawing}<path d="M2 2v18l5-5 5-2Z"/></g><g stroke="#40594a" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" fill="#eaf0d9">${drawing}</g><path d="M2 2v18l5-5 5-2Z" fill="#fff4d9" stroke="#40594a" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    return [
      action,
      `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, auto`,
    ];
  }),
) as Record<ActionCursor, string>;

/** Canvas-only ownership: UI keeps its ordinary cursor, even during capture. */
export class ActionCursorController {
  resolve: (x: number, y: number) => ActionCursor | null = () => null;
  private position: { x: number; y: number } | null = null;
  private buttons = 0;
  private lastUpdate = -Infinity;
  private disposed = false;
  private override: "grab" | "grabbing" | null = null;
  private original: string;
  private listeners = new AbortController();
  constructor(private canvas: HTMLCanvasElement) {
    this.original = canvas.style.cursor;
    const options = { signal: this.listeners.signal };
    const track = (e: PointerEvent) => {
      this.position =
        e.pointerType === "touch" ? null : { x: e.clientX, y: e.clientY };
      this.buttons = e.buttons;
      this.refresh();
    };
    window.addEventListener("pointermove", track, options);
    window.addEventListener("pointerdown", track, options);
    window.addEventListener("pointerup", track, options);
    canvas.addEventListener("pointerleave", () => this.clear(), options);
    window.addEventListener("pointercancel", () => this.clear(), options);
    window.addEventListener("blur", () => this.clear(), options);
    window.addEventListener("pagehide", () => this.clear(), options);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.clear();
      },
      options,
    );
  }
  /** Recheck stationary pointers as simulation, camera, or overlapping UI changes. */
  update(now: number) {
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    this.refresh();
  }
  refresh() {
    if (this.disposed) return;
    const p = this.position;
    const onCanvas =
      p &&
      !document.hidden &&
      document.elementFromPoint(p.x, p.y) === this.canvas;
    const action =
      onCanvas && !this.override && !this.buttons
        ? this.resolve(p.x, p.y)
        : null;
    const value =
      onCanvas && this.override
        ? this.override
        : action
          ? cursorImages[action]
          : this.original;
    if (this.canvas.style.cursor !== value) this.canvas.style.cursor = value;
  }
  /** Camera gestures may temporarily own the canvas cursor. No input is consumed. */
  setOverride(cursor: "grab" | "grabbing" | null) {
    this.override = cursor;
    this.refresh();
  }
  clear() {
    this.position = null;
    this.buttons = 0;
    this.override = null;
    this.canvas.style.cursor = this.original;
  }
  dispose() {
    this.clear();
    this.disposed = true;
    this.listeners.abort();
  }
}
