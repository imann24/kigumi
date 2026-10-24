import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourcePulses } from "../src/game/resource-pulses";
import { disposeGroup, material, treeModel } from "../src/game/art";
import { VillageScene } from "../src/game/scene";
import { createWorld } from "../src/simulation/engine";

// Keep real scene/model construction and lifecycle; only the DOM/WebGL shell is mocked.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      shadowMap = {};
      setPixelRatio() {}
      setSize() {}
      getDrawingBufferSize(v: THREE.Vector2) {
        return v.set(800, 600);
      }
      getPixelRatio() {
        return 1;
      }
      getRenderTarget() {
        return null;
      }
      setRenderTarget() {}
      getClearColor(v: THREE.Color) {
        return v.set(0);
      }
      getClearAlpha() {
        return 1;
      }
      setClearColor() {}
      render() {}
    },
  };
});
vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    target = new THREE.Vector3();
    update() {}
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function meshes(model: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) result.push(o);
  });
  return result;
}
const surface = (mesh: THREE.Mesh) =>
  mesh.material as THREE.MeshStandardMaterial;
function village() {
  vi.stubGlobal("window", { devicePixelRatio: 1, addEventListener() {} });
  vi.stubGlobal("document", { addEventListener() {} });
  const scene = new VillageScene({
    style: { cursor: "" },
    addEventListener() {},
    clientWidth: 800,
    clientHeight: 600,
  } as unknown as HTMLCanvasElement);
  const world = createWorld(42);
  scene.setWorld(world);
  const model = (id: number) => {
    let found: THREE.Object3D | undefined;
    scene.scene.traverse((o) => {
      if (o.userData.type === "resource" && o.userData.id === id) found = o;
    });
    return found!;
  };
  return { scene, world, model };
}

describe("whole-resource gather feedback", () => {
  it.each(["wood", "stone", "food"] as const)(
    "pulses all parts of an actual %s model and restores its exact materials",
    (kind) => {
      const { scene, world, model } = village();
      const node = world.nodes.find((n) => n.kind === kind)!;
      const parts = meshes(model(node.id));
      expect(parts.length).toBeGreaterThan(1);
      const originals = parts.map(surface);
      const geometry = parts.map((p) => p.geometry);
      const saved = JSON.stringify(world);
      const now = vi.spyOn(performance, "now").mockReturnValue(1000);
      scene.select(world.villagers.map((v) => v.id));
      const start = vi.spyOn(ResourcePulses.prototype, "start");
      scene.flashResource(node.id);
      expect(start).toHaveBeenCalledTimes(1);
      scene.frame(1120);
      parts.forEach((part, i) => {
        expect(surface(part)).not.toBe(originals[i]);
        expect(surface(part).color.equals(originals[i].color)).toBe(false);
        expect(surface(part).emissive.getHex()).not.toBe(0);
        expect(part.geometry).toBe(geometry[i]);
      });
      scene.frame(1650);
      parts.forEach((part, i) => expect(part.material).toBe(originals[i]));
      expect(JSON.stringify(world)).toBe(saved);
      now.mockRestore();
    },
  );

  it.each([0.2, 0.8, 0.95])(
    "isolates every tree variant (%s), even with shared art",
    (variant) => {
      const target = treeModel(variant),
        neighbor = treeModel(variant);
      const parts = meshes(target),
        adjacent = meshes(neighbor);
      const originals = parts.map(surface);
      const colors = originals.map((m) => m.color.clone());
      const pulses = new ResourcePulses();
      pulses.start(target, 0);
      pulses.update(120);
      parts.forEach((part, i) => {
        expect(surface(part).color.equals(colors[i])).toBe(false);
        expect(adjacent[i].material).toBe(originals[i]);
        expect(surface(adjacent[i]).color.equals(colors[i])).toBe(true);
      });
      pulses.clear();
      disposeGroup(target);
      disposeGroup(neighbor);
    },
  );

  it("refreshes at the rendered brightness without reallocating or accumulating tint", () => {
    const model = treeModel(0.2),
      part = meshes(model)[0];
    const original = surface(part),
      pulses = new ResourcePulses();
    pulses.start(model, 0);
    pulses.update(60);
    const copy = surface(part),
      halfway = copy.color.clone();
    pulses.update(120);
    const peak = copy.color.clone();
    expect(halfway.equals(peak)).toBe(false);
    pulses.update(400);
    const fading = copy.color.clone();
    pulses.start(model, 400);
    pulses.update(400);
    expect(surface(part)).toBe(copy);
    expect(copy.color.equals(fading)).toBe(true);
    pulses.update(520);
    expect(copy.color.equals(peak)).toBe(true);
    pulses.start(model, 520);
    pulses.update(520);
    expect(copy.color.equals(peak)).toBe(true);
    pulses.update(1100);
    expect(part.material).toBe(copy); // Expiry is measured from the refreshed click.
    pulses.update(1170);
    expect(part.material).toBe(original);
  });

  it("restores nested multi-material meshes and disposes only its owned copies once", () => {
    const root = new THREE.Group(),
      nested = new THREE.Group();
    const shared = material("#658b6e"),
      second = material("#8c6347");
    const originals = [shared, second, shared];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), originals);
    nested.add(mesh);
    root.add(nested);
    const pulses = new ResourcePulses();
    const sharedDispose = vi.spyOn(shared, "dispose");
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    pulses.start(root, 0);
    const copies = mesh.material as THREE.Material[];
    expect(copies[0]).toBe(copies[2]);
    const disposed = [
      vi.spyOn(copies[0], "dispose"),
      vi.spyOn(copies[1], "dispose"),
    ];
    pulses.start(root, 50);
    pulses.update(170);
    pulses.remove(root);
    pulses.clear();
    pulses.update(2000);
    expect(mesh.material).toBe(originals);
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(sharedDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
  });

  it("keeps separately clicked models independent and expires after a delayed frame", () => {
    const first = treeModel(0.2),
      second = treeModel(0.2);
    const a = meshes(first)[0],
      b = meshes(second)[0],
      original = a.material;
    const pulses = new ResourcePulses();
    pulses.start(first, 0);
    pulses.update(120);
    pulses.start(second, 500);
    pulses.update(650);
    expect(a.material).toBe(original);
    expect(b.material).not.toBe(original);
    pulses.update(10000);
    expect(b.material).toBe(original);
  });

  it("ignores no/stale selections and missing or exhausted resources", () => {
    const { scene, world } = village(),
      node = world.nodes[0];
    const start = vi.spyOn(ResourcePulses.prototype, "start");
    scene.flashResource(node.id);
    scene.select([-1]);
    scene.flashResource(node.id);
    scene.select([world.villagers[0].id]);
    scene.flashResource(-1);
    node.amount = 0;
    scene.flashResource(node.id);
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["depleted", "removed", "replaced"])(
    "cleans up when the resource is %s",
    (action) => {
      const { scene, world, model } = village(),
        node = world.nodes[0];
      const part = meshes(model(node.id))[0],
        original = part.material;
      vi.spyOn(performance, "now").mockReturnValue(0);
      scene.select([world.villagers[0].id]);
      scene.flashResource(node.id);
      scene.frame(120);
      const dispose = vi.spyOn(surface(part), "dispose");
      if (action === "replaced") scene.setWorld(createWorld(43));
      else {
        if (action === "depleted") node.amount = 0;
        else world.nodes = world.nodes.filter((n) => n.id !== node.id);
        scene.sync(world);
      }
      expect(part.material).toBe(original);
      expect(dispose).toHaveBeenCalledTimes(1);
      scene.frame(1000);
      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );
});
