import { Vector3 } from "three";
import type { Camera } from "three";
import type { Point } from "../simulation/types";

// Translate camera and orbit target together, keeping the existing map limits.
export function panCamera(camera: Camera, target: Vector3, delta: Point) {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return;
  const offset = new Vector3(
    Math.max(0, Math.min(40, target.x + delta.x)) - target.x,
    0,
    Math.max(0, Math.min(40, target.z + delta.z)) - target.z,
  );
  camera.position.add(offset);
  target.add(offset);
  camera.updateMatrixWorld();
}

/** A claimed pointer remains consumed after cancellation until its release. */
export class PanGesture {
  space = false;
  used = false;
  pointerId: number | null = null;
  get active() {
    return this.space && this.pointerId !== null;
  }
  pressSpace(buttonsDown = false) {
    if (this.space) return;
    this.space = true;
    this.used = buttonsDown || this.pointerId !== null;
  }
  releaseSpace() {
    const tap = this.space && !this.used;
    this.space = false;
    return tap;
  }
  begin(pointerId: number) {
    if (!this.space || this.pointerId !== null) return false;
    this.used = true;
    this.pointerId = pointerId;
    return true;
  }
  end(pointerId: number) {
    if (this.pointerId !== pointerId) return false;
    this.pointerId = null;
    return true;
  }
  cancel() {
    this.space = false;
    this.used = true;
  }
}

export function isUiControl(
  target: EventTarget | null,
  worldCanvas?: HTMLCanvasElement,
) {
  if (!(target instanceof Element)) return false;
  // Body and the world remain game keyboard surfaces even if focusable. Other
  // tabindex regions include scroll containers and programmatic focus fallbacks.
  if (target === worldCanvas || target.tagName === "BODY") return false;
  return !!target.closest(
    'input, textarea, select, button, a[href], summary, audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="slider"], [role="combobox"]',
  );
}

/** Capture before OrbitControls and world actions; leave ordinary UI events alone. */
export function installSpacePan(
  surface: {
    canvas: HTMLCanvasElement;
    cursor?: { setOverride: (value: "grab" | "grabbing" | null) => void };
  },
  options: {
    enabled: () => boolean;
    tap: () => void;
    start: () => void;
    move: (
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => void;
    hover: (x: number, y: number) => void;
  },
) {
  const { canvas } = surface;
  const gesture = new PanGesture();
  let previous = { x: 0, y: 0 };
  let buttons = 0;
  let suppressClick = false;
  const cursor = () => {
    const value = gesture.active ? "grabbing" : gesture.space ? "grab" : null;
    // Use the shared cursor owner when available; the attribute is the fallback
    // for builds without contextual cursors. Never compete with its inline style.
    if (surface.cursor) surface.cursor.setOverride(value);
    else if (value) canvas.dataset.cameraPan = value;
    else delete canvas.dataset.cameraPan;
  };
  const consume = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const cancel = () => {
    gesture.cancel();
    cursor();
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code === "Escape") cancel();
      if (
        e.code !== "Space" ||
        !options.enabled() ||
        isUiControl(e.target, canvas) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      e.preventDefault();
      if (!e.repeat) gesture.pressSpace(buttons !== 0);
      cursor();
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.code !== "Space" || !gesture.space) return;
      const tap = gesture.releaseSpace();
      cursor();
      if (!isUiControl(e.target, canvas)) e.preventDefault();
      if (tap && options.enabled() && !isUiControl(e.target, canvas))
        options.tap();
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      buttons = e.buttons;
      if (gesture.pointerId !== null) {
        // A fresh primary press also recovers from release outside the window.
        if (e.button === 0 && e.pointerId === gesture.pointerId)
          gesture.end(e.pointerId);
        else {
          consume(e);
          return;
        }
      }
      suppressClick = false;
      if (gesture.space) gesture.used = true;
      if (
        e.target !== canvas ||
        !options.enabled() ||
        e.button !== 0 ||
        e.buttons !== 1 ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.pointerType === "touch" ||
        !gesture.begin(e.pointerId)
      )
        return;
      previous = { x: e.clientX, y: e.clientY };
      suppressClick = true;
      options.start();
      canvas.setPointerCapture(e.pointerId);
      consume(e);
      cursor();
    },
    true,
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      buttons = e.buttons;
      if (gesture.pointerId !== e.pointerId) {
        if (gesture.space) cursor();
        return;
      }
      if (!(e.buttons & 1)) {
        gesture.end(e.pointerId);
        cancel();
        return;
      }
      const next = { x: e.clientX, y: e.clientY };
      if (gesture.active && options.enabled()) options.move(previous, next);
      previous = next;
      options.hover(next.x, next.y);
      // Let passive hover tracking see the pointer. World actions ignore events
      // claimed with preventDefault; pointerdown never reached OrbitControls.
      e.preventDefault();
    },
    true,
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      buttons = e.buttons;
      if (e.button !== 0 || !gesture.end(e.pointerId)) return;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      options.hover(e.clientX, e.clientY);
      e.preventDefault();
      cursor();
    },
    true,
  );
  window.addEventListener(
    "pointercancel",
    (e) => {
      if (!gesture.end(e.pointerId)) return;
      buttons = 0;
      cancel();
      e.preventDefault();
    },
    true,
  );
  canvas.addEventListener("lostpointercapture", () => {
    if (gesture.pointerId !== null) cancel();
  });
  window.addEventListener(
    "click",
    (e) => {
      if (suppressClick && e.detail !== 0) {
        suppressClick = false;
        consume(e);
      }
    },
    true,
  );
  canvas.addEventListener(
    "contextmenu",
    (e) => {
      if (gesture.space) gesture.used = true;
      if (gesture.pointerId !== null) consume(e);
    },
    true,
  );
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (gesture.space) gesture.used = true;
      if (gesture.pointerId !== null) consume(e);
    },
    { capture: true, passive: false },
  );
  window.addEventListener("blur", () => {
    buttons = 0;
    cancel();
  });
  window.addEventListener("focusin", (e) => {
    if (isUiControl(e.target, canvas)) cancel();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      buttons = 0;
      cancel();
    }
  });
  return { cancel };
}
