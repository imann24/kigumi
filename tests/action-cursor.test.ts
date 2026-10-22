import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionCursorController,
  cursorImages,
} from "../src/game/action-cursor";

// A tiny EventTarget harness tests ownership/lifecycle without WebGL or a DOM dependency.
let win: EventTarget;
let doc: EventTarget & {
  hidden: boolean;
  elementFromPoint: ReturnType<typeof vi.fn>;
};
let canvas: HTMLCanvasElement;
let controller: ActionCursorController;
function pointer(type = "pointermove", extra = {}) {
  win.dispatchEvent(
    Object.assign(new Event(type), {
      clientX: 12,
      clientY: 24,
      buttons: 0,
      pointerType: "mouse",
      ...extra,
    }),
  );
}
beforeEach(() => {
  win = new EventTarget();
  canvas = Object.assign(new EventTarget(), {
    style: { cursor: "" },
  }) as unknown as HTMLCanvasElement;
  doc = Object.assign(new EventTarget(), {
    hidden: false,
    elementFromPoint: vi.fn(() => canvas),
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  controller = new ActionCursorController(canvas);
  controller.resolve = vi.fn(() => "wood" as const);
});
afterEach(() => {
  controller.dispose();
  vi.unstubAllGlobals();
});

describe("canvas cursor lifecycle", () => {
  it("keeps the precise hotspot, fallback and distinct cached original artwork", () => {
    expect(new Set(Object.values(cursorImages)).size).toBe(6);
    for (const image of Object.values(cursorImages)) {
      expect(image).toMatch(/ 2 2, auto$/);
      expect(decodeURIComponent(image)).toContain('width="36" height="36"');
    }
    pointer();
    expect(controller.resolve).toHaveBeenCalledWith(12, 24);
    expect(canvas.style.cursor).toBe(cursorImages.wood);
  });
  it.each(["blur", "pagehide", "pointercancel"])(
    "clears on %s and recovers on fresh movement",
    (event) => {
      pointer();
      win.dispatchEvent(new Event(event));
      expect(canvas.style.cursor).toBe("");
      controller.update(1000);
      expect(canvas.style.cursor).toBe("");
      pointer();
      expect(canvas.style.cursor).toBe(cursorImages.wood);
    },
  );
  it("restores on leaving, entering UI (including pointer capture), and hiding", () => {
    pointer();
    canvas.dispatchEvent(new Event("pointerleave"));
    expect(canvas.style.cursor).toBe("");
    pointer();
    doc.elementFromPoint.mockReturnValue({});
    pointer();
    expect(canvas.style.cursor).toBe("");
    doc.elementFromPoint.mockReturnValue(canvas);
    pointer();
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(canvas.style.cursor).toBe("");
  });
  it("refreshes stationary selection, target, mode and UI changes", () => {
    pointer();
    controller.resolve = vi.fn(() => null);
    controller.refresh();
    expect(canvas.style.cursor).toBe("");
    controller.resolve = vi.fn(() => "build" as const);
    controller.update(1000);
    expect(canvas.style.cursor).toBe(cursorImages.build);
    doc.elementFromPoint.mockReturnValue({});
    controller.update(1100);
    expect(canvas.style.cursor).toBe("");
  });
  it("keeps selection drags, camera gestures and touch on the normal cursor", () => {
    pointer();
    pointer("pointerdown", { buttons: 4 });
    expect(canvas.style.cursor).toBe("");
    pointer("pointerup");
    expect(canvas.style.cursor).toBe(cursorImages.wood);
    pointer("pointerdown", { buttons: 1 });
    expect(canvas.style.cursor).toBe("");
    pointer("pointermove", { pointerType: "touch" });
    expect(canvas.style.cursor).toBe("");
  });
  it("yields to camera cursor ownership and resumes contextual feedback", () => {
    pointer();
    controller.setOverride("grab");
    expect(canvas.style.cursor).toBe("grab");
    pointer("pointerdown", { buttons: 1 });
    controller.setOverride("grabbing");
    expect(canvas.style.cursor).toBe("grabbing");
    doc.elementFromPoint.mockReturnValue({});
    pointer();
    expect(canvas.style.cursor).toBe("");
    doc.elementFromPoint.mockReturnValue(canvas);
    pointer("pointerup");
    controller.setOverride(null);
    expect(canvas.style.cursor).toBe(cursorImages.wood);
    controller.setOverride("grab");
    win.dispatchEvent(new Event("blur"));
    expect(canvas.style.cursor).toBe("");
    pointer();
    expect(canvas.style.cursor).toBe(cursorImages.wood);
  });
  it("throttles stationary picking and restores prior style on teardown", () => {
    controller.dispose();
    canvas.style.cursor = "crosshair";
    controller = new ActionCursorController(canvas);
    controller.resolve = vi.fn(() => "build" as const);
    pointer();
    controller.update(1000);
    controller.update(1010);
    expect(controller.resolve).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(canvas.style.cursor).toBe("crosshair");
    pointer();
    controller.refresh();
    controller.update(2000);
    expect(controller.resolve).toHaveBeenCalledTimes(2);
  });
});
