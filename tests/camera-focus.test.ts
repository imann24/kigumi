// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installSpacePan, isUiControl } from "../src/game/camera-pan";

const canvas = document.createElement("canvas");
const ui = document.createElement("section");
const tap = vi.fn();
const start = vi.fn();
const move = vi.fn();
const hover = vi.fn();
const key = (target: EventTarget, type: "keydown" | "keyup") => {
  const event = new KeyboardEvent(type, {
    code: "Space",
    key: " ",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};
beforeAll(() => {
  canvas.id = "world";
  canvas.tabIndex = -1;
  document.body.append(canvas, ui);
  installSpacePan({ canvas }, { enabled: () => true, tap, start, move, hover });
});
beforeEach(() => {
  (document.activeElement as HTMLElement)?.blur();
  window.dispatchEvent(new Event("blur"));
  ui.replaceChildren();
  vi.clearAllMocks();
});

describe("Space focus ownership and capture/bubble ordering", () => {
  it.each([
    ["scrollable list", '<ol tabindex="0"><li>Queued villager</li></ol>'],
    ["programmatic region", '<div tabindex="-1">Queue fallback</div>'],
    ["custom focus region", '<section tabindex="0">Panel</section>'],
    ["positive tab order", '<div tabindex="3">Panel</div>'],
    ["listbox", '<div role="listbox" tabindex="0">Items</div>'],
    ["button", "<button>Action</button>"],
    ["text input", '<input value="text">'],
    ["textarea", "<textarea>text</textarea>"],
    ["select", "<select><option>Choice</option></select>"],
    ["link", '<a href="#">Link</a>'],
    ["editable", '<div contenteditable="true">text</div>'],
  ])(
    "leaves Space on a focused %s untouched before its bubbling handler",
    (_, markup) => {
      ui.innerHTML = markup;
      const target = ui.firstElementChild as HTMLElement;
      target.focus();
      expect(document.activeElement).toBe(target);
      const bubbling = vi.fn((e: Event) => {
        // The queue's stopPropagation happens AFTER the camera's window capture.
        expect(e.defaultPrevented).toBe(false);
        e.stopPropagation();
      });
      target.addEventListener("keydown", bubbling);
      expect(key(target, "keydown").defaultPrevented).toBe(false);
      expect(bubbling).toHaveBeenCalledOnce();
      expect(canvas.dataset.cameraPan).toBeUndefined();
      expect(key(target, "keyup").defaultPrevented).toBe(false);
      expect(tap).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
      expect(move).not.toHaveBeenCalled();
    },
  );
  it("recognizes descendants and native media controls without queue-specific selectors", () => {
    ui.innerHTML =
      '<div tabindex="-1"><span>Nested item</span></div><audio controls></audio><video controls></video><details><summary>Details</summary></details>';
    for (const selector of ["span", "audio", "video", "summary"])
      expect(isUiControl(ui.querySelector(selector), canvas)).toBe(true);
  });
  it.each(["body", "canvas"])(
    "keeps standalone Space taps on the %s, even with tabindex",
    (surface) => {
      const target = surface === "body" ? document.body : canvas;
      target.tabIndex = -1;
      target.focus();
      expect(key(target, "keydown").defaultPrevented).toBe(true);
      expect(canvas.dataset.cameraPan).toBe("grab");
      expect(tap).not.toHaveBeenCalled();
      key(target, "keyup");
      expect(tap).toHaveBeenCalledOnce();
      expect(canvas.dataset.cameraPan).toBeUndefined();
    },
  );
  it("cancels an armed Space gesture when focus moves into a scroll region", () => {
    key(document.body, "keydown");
    ui.innerHTML = '<div tabindex="-1">Queue fallback</div>';
    const region = ui.firstElementChild as HTMLElement;
    region.focus();
    expect(canvas.dataset.cameraPan).toBeUndefined();
    key(region, "keyup");
    expect(tap).not.toHaveBeenCalled();
  });
});
