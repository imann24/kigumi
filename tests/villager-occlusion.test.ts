import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { VillagerOcclusion } from "../src/game/villager-occlusion";
import { SceneEntities } from "../src/game/scene-entities";
import {
  BUILDING_OCCLUDER_LAYER,
  VILLAGER_SILHOUETTE_LAYER,
} from "../src/game/occlusion-layers";
import { createWorld } from "../src/simulation/engine";

function rendererStub() {
  let target: THREE.WebGLRenderTarget | null = null;
  const color = new THREE.Color("#123456");
  return {
    autoClear: true,
    shadowMap: { enabled: true },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 600),
    getPixelRatio: () => 1.5,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    getClearColor: (v: THREE.Color) => v.copy(color),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    render: vi.fn(),
  };
}

describe("villager occlusion ownership", () => {
  it("tags only placed buildings and villagers, retaining normal rendering and picking", () => {
    const entities = new SceneEntities(),
      w = createWorld(42);
    entities.sync(w);
    for (const model of entities.children)
      model.traverse((part) => {
        expect(part.layers.isEnabled(0)).toBe(true);
        expect(part.layers.isEnabled(BUILDING_OCCLUDER_LAYER)).toBe(
          model.userData.type === "building",
        );
        expect(part.layers.isEnabled(VILLAGER_SILHOUETTE_LAYER)).toBe(
          model.userData.type === "villager",
        );
      });
    const old = entities.children.slice();
    entities.reset();
    entities.sync(w);
    expect(entities.children.every((model) => !old.includes(model))).toBe(true);
    expect(
      entities
        .getModel(`villager:${w.villagers[0].id}`)!
        .layers.isEnabled(VILLAGER_SILHOUETTE_LAYER),
    ).toBe(true);
    entities.reset();
  });

  it("reuses fixed-size targets across frames and restores scene/renderer state", () => {
    const effect = new VillagerOcclusion(),
      renderer = rendererStub();
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera();
    scene.background = new THREE.Color("#abcdef");
    const background = scene.background;
    const targets: THREE.WebGLRenderTarget[] = [];
    const passes: number[] = [];
    renderer.render.mockImplementation(() => {
      passes.push(camera.layers.mask);
      const target = renderer.getRenderTarget();
      if (target) targets.push(target);
    });
    for (let i = 0; i < 2; i++)
      effect.render(renderer as unknown as THREE.WebGLRenderer, scene, camera);
    expect(passes).toEqual([1, 4, 1, 1, 1, 4, 1, 1]);
    expect(new Set(targets).size).toBe(2);
    expect(targets.every((t) => t.width === 800 && t.height === 600)).toBe(
      true,
    );
    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBeNull();
    expect(camera.layers.mask).toBe(1);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.getRenderTarget()).toBeNull();
    const disposed = [...new Set(targets)].map((t) => vi.spyOn(t, "dispose"));
    effect.dispose();
    expect(disposed.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });

  it("restores state even if a mask render fails", () => {
    const effect = new VillagerOcclusion(),
      renderer = rendererStub();
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera();
    const original = new THREE.MeshBasicMaterial();
    scene.overrideMaterial = original;
    renderer.render
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("context lost");
      });
    expect(() =>
      effect.render(renderer as unknown as THREE.WebGLRenderer, scene, camera),
    ).toThrow("context lost");
    expect(scene.overrideMaterial).toBe(original);
    expect(camera.layers.mask).toBe(1);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.autoClear).toBe(true);
    effect.dispose();
    original.dispose();
  });
});
