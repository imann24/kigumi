// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderInspector,
  renderProduction,
  type InspectorState,
} from "../src/ui/inspector";
import { BUILDINGS, type BuildingKind } from "../src/simulation/catalog";
import { createWorld } from "../src/simulation/engine";

const thumbs = Object.fromEntries(
  Object.keys(BUILDINGS).map((k) => [k, `${k}.png`]),
) as Record<BuildingKind, string>;
let state: InspectorState;
const select = vi.fn(),
  dispatch = vi.fn(() => true);
const render = () => renderInspector(state, thumbs, { select, dispatch });
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
beforeEach(() => {
  document.body.innerHTML =
    '<details id="inspector-panel"><summary>Selection</summary><aside id="inspector"></aside></details>';
  state = { world: createWorld(42), selected: [], focus: null, paused: false };
  select.mockClear();
  dispatch.mockReset().mockReturnValue(true);
});

describe("selection inspector", () => {
  it("escapes names/tasks and routes work-party commands through the coordinator", () => {
    const [a, b] = state.world.villagers;
    a.name = '<img src=x onerror="alert(1)">';
    a.task = "<script>hello</script>";
    state.selected = [a.id];
    render();
    expect(document.querySelector("h2")!.textContent).toBe(a.name);
    expect(document.querySelector(".status-line")!.textContent).toBe(a.task);
    expect(
      document.querySelector("#inspector img, #inspector script"),
    ).toBeNull();
    state.selected = [a.id, b.id];
    a.auto = b.auto = true;
    render();
    button("auto-work").click();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "auto",
      ids: [a.id, b.id],
      enabled: false,
    });
    button("stop-work").click();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "order",
      ids: [a.id, b.id],
      order: { type: "idle" },
    });
    button("resume-work").click();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "order",
      ids: [a.id, b.id],
      order: { type: "auto" },
    });
    button("clear-selection").click();
    expect(select).toHaveBeenCalledWith([]);
  });

  it("selects assigned workers and assigns the nearest unassigned villager to construction or production", () => {
    const farm = state.world.buildings.find((b) => b.kind === "farm")!;
    for (const v of state.world.villagers) v.order = { type: "idle" };
    const [worker, nearest] = state.world.villagers;
    worker.order = { type: "work", target: farm.id };
    nearest.x = farm.x;
    nearest.z = farm.z;
    state.focus = { type: "building", id: farm.id };
    render();
    button("select-workers").click();
    expect(select).toHaveBeenLastCalledWith([worker.id]);
    button("assign-nearest").click();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "order",
      ids: [nearest.id],
      order: { type: "work", target: farm.id },
    });
    farm.progress = 0.3;
    render();
    button("assign-nearest").click();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "order",
      ids: [nearest.id],
      order: { type: "build", target: farm.id },
    });
  });

  it("clears a dismantled selection only when the command succeeds", () => {
    const house = state.world.buildings.find((b) => b.kind === "house")!;
    state.focus = { type: "building", id: house.id };
    render();
    dispatch.mockReturnValue(false);
    button("demolish").click();
    expect(dispatch).toHaveBeenCalledWith({ type: "demolish", id: house.id });
    expect(select).not.toHaveBeenCalled();
    dispatch.mockReturnValue(true);
    button("demolish").click();
    expect(select).toHaveBeenCalledWith([]);
  });

  it("clears missing villagers, buildings and depleted resources", () => {
    state.selected = [-1];
    render();
    state.selected = [];
    state.focus = { type: "building", id: -1 };
    render();
    const n = state.world.nodes[0];
    n.amount = 0;
    state.focus = { type: "resource", id: n.id };
    render();
    expect(select.mock.calls).toEqual([[[]], [[]], [[]]]);
  });

  it("keeps welcome availability and labels current in the overview and hall", () => {
    render();
    expect(button("welcome").disabled).toBe(false);
    button("welcome").click();
    expect(dispatch).toHaveBeenCalledWith({ type: "recruit" });
    state.focus = {
      type: "building",
      id: state.world.buildings.find((b) => b.kind === "hall")!.id,
    };
    state.world.recruit = 1;
    state.world.stock.food = 0;
    render();
    expect(button("welcome").disabled).toBe(true);
    expect(button("welcome-label").textContent).toBe("Queue a villager");
    expect(button("welcome-requirement").textContent).toMatch(/food/i);
    state.world.stock.food = 1000;
    render();
    expect(button("welcome").disabled).toBe(false);
    expect(document.querySelector("summary")!.textContent).toBe(
      BUILDINGS.hall.name,
    );
  });

  it("preserves queue focus/scroll during progress updates and transfers focus when the queue empties", () => {
    state.focus = {
      type: "building",
      id: state.world.buildings.find((b) => b.kind === "hall")!.id,
    };
    state.world.recruit = 1;
    state.world.recruitQueue = 10;
    state.world.research = { id: "agriculture", progress: 0.25 };
    render();
    const list = document.querySelector("ol")!;
    list.scrollTop = 45;
    list.focus();
    state.world.recruit = 2;
    state.paused = true;
    renderProduction(state);
    expect(document.querySelector("ol")).toBe(list);
    expect(document.activeElement).toBe(list);
    expect(list.scrollTop).toBe(45);
    expect(button("welcome-active").textContent).toContain("Paused");
    expect(button("research-active").textContent).toContain("Paused");
    state.world.recruitQueue = 9;
    renderProduction(state);
    const replacement = document.querySelector("ol")!;
    expect(replacement).not.toBe(list);
    expect(document.activeElement).toBe(replacement);
    expect(replacement.scrollTop).toBe(45);
    state.world.recruitQueue = 0;
    renderProduction(state);
    expect(document.activeElement).toBe(button("welcome-queue"));
  });

  it("contains queue navigation keys so they cannot pan the camera or toggle pause", () => {
    state.focus = {
      type: "building",
      id: state.world.buildings.find((b) => b.kind === "hall")!.id,
    };
    state.world.recruit = 1;
    state.world.recruitQueue = 3;
    render();
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    for (const code of [
      "Space",
      "Home",
      "End",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
    ])
      document
        .querySelector("ol")!
        .dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    expect(listener).not.toHaveBeenCalled();
    document
      .querySelector("ol")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { code: "Escape", bubbles: true }),
      );
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", listener);
  });
});
