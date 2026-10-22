import { describe, expect, it } from "vitest";
import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { PanGesture, panCamera } from "../src/game/camera-pan";
import { minimapPoint } from "../src/game/minimap-pan";
import { VillageScene } from "../src/game/scene";

function view(angle: number, zoom: number, aspect = 1.6, tilt = 0.8) {
  const target = new Vector3(20, 0, 20);
  const camera = new OrthographicCamera(
    -16 * aspect,
    16 * aspect,
    16,
    -16,
    0.1,
    160,
  );
  camera.position
    .copy(target)
    .add(
      new Vector3(
        Math.sin(angle) * 45 * Math.sin(tilt),
        45 * Math.cos(tilt),
        Math.cos(angle) * 45 * Math.sin(tilt),
      ),
    );
  camera.lookAt(target);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const point = (x: number, y: number) => {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(x, y), camera);
    const p = ray.ray.intersectPlane(
      new Plane(new Vector3(0, 1, 0), 0),
      new Vector3(),
    )!;
    return { x: p.x, z: p.z };
  };
  return { camera, target, point };
}

describe("Space gesture ownership", () => {
  it("pauses only on a standalone release, never key repeat or a pan", () => {
    const g = new PanGesture();
    g.pressSpace();
    g.pressSpace();
    expect(g.releaseSpace()).toBe(true);
    expect(g.releaseSpace()).toBe(false);
    g.pressSpace();
    expect(g.begin(7)).toBe(true);
    expect(g.releaseSpace()).toBe(false);
    expect(g.active).toBe(false);
    expect(g.pointerId).toBe(7); // release still belongs to the pan
    expect(g.end(8)).toBe(false);
    expect(g.end(7)).toBe(true);
  });
  it("allows repeated drags while held without pausing afterward", () => {
    const g = new PanGesture();
    g.pressSpace();
    for (let i = 0; i < 3; i++) {
      expect(g.begin(1)).toBe(true);
      expect(g.active).toBe(true);
      expect(g.begin(2)).toBe(false);
      g.end(1);
    }
    expect(g.releaseSpace()).toBe(false);
  });
  it("cancellation consumes the eventual release without rearming", () => {
    const g = new PanGesture();
    g.pressSpace();
    g.begin(1);
    g.cancel();
    expect(g.active).toBe(false);
    expect(g.pointerId).toBe(1);
    expect(g.releaseSpace()).toBe(false);
    g.end(1);
    expect(g.begin(1)).toBe(false);
    g.pressSpace();
    expect(g.releaseSpace()).toBe(true);
  });
  it("Space during another pointer gesture does not toggle pause", () => {
    const g = new PanGesture();
    g.pressSpace(true);
    expect(g.releaseSpace()).toBe(false);
  });
});

describe("ground-plane camera movement", () => {
  for (const angle of [0, Math.PI / 2, 2.6, 4.8]) {
    for (const zoom of [0.65, 1.28, 3.5]) {
      it(`drags the world under the pointer at angle ${angle}, zoom ${zoom}`, () => {
        const { camera, target, point } = view(angle, zoom);
        const before = point(-0.1, 0.1);
        const offset = camera.position.clone().sub(target);
        VillageScene.prototype.panPointer.call(
          {
            camera,
            controls: { target },
            pointerWorld: point,
          } as unknown as VillageScene,
          { x: -0.1, y: 0.1 },
          { x: 0.1, y: -0.1 },
        );
        const after = point(0.1, -0.1);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.z).toBeCloseTo(before.z, 9);
        expect(
          camera.position.clone().sub(target).distanceTo(offset),
        ).toBeLessThan(1e-10);
      });
    }
  }
  for (const angle of [0.3, 1.8, 3.8]) {
    for (const tilt of [0.3, Math.PI * 0.42]) {
      for (const aspect of [0.75, 1.8]) {
        it(`keeps off-center zoom anchor at angle ${angle}, tilt ${tilt}, aspect ${aspect}`, () => {
          const { camera, target, point } = view(angle, 1.28, aspect, tilt);
          const before = point(0.16, -0.12);
          for (const zoom of [2.2, 0.65, 3.5, 1.28]) {
            camera.zoom = zoom;
            camera.updateProjectionMatrix();
            const after = point(0.16, -0.12);
            panCamera(camera, target, {
              x: before.x - after.x,
              z: before.z - after.z,
            });
            expect(point(0.16, -0.12).x).toBeCloseTo(before.x, 9);
            expect(point(0.16, -0.12).z).toBeCloseTo(before.z, 9);
            expect(target.y).toBe(0);
          }
        });
      }
    }
  }
  it("clamps both axes, permits immediate reverse movement, and ignores invalid intersections", () => {
    const { camera, target } = view(1, 1);
    const offset = camera.position.clone().sub(target);
    panCamera(camera, target, { x: 1000, z: -1000 });
    expect(target.toArray()).toEqual([40, 0, 0]);
    panCamera(camera, target, { x: -1, z: 1 });
    expect(target.toArray()).toEqual([39, 0, 1]);
    panCamera(camera, target, { x: NaN, z: Infinity });
    expect(target.toArray()).toEqual([39, 0, 1]);
    expect(camera.position.clone().sub(target).distanceTo(offset)).toBeLessThan(
      1e-10,
    );
    VillageScene.prototype.panPointer.call(
      {
        camera,
        controls: { target },
        pointerWorld: () => null,
      } as unknown as VillageScene,
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    );
    expect(target.toArray()).toEqual([39, 0, 1]);
  });
});

describe("minimap coordinates", () => {
  it("uses live CSS bounds independent of backing-store size and DPI", () => {
    expect(
      minimapPoint(
        { left: 20, top: 40, width: 136, height: 109 },
        88,
        94.5,
        40,
      ),
    ).toEqual({ x: 20, z: 20 });
    expect(
      minimapPoint(
        { left: 20, top: 40, width: 272, height: 218 },
        88,
        94.5,
        40,
      ),
    ).toEqual({ x: 10, z: 10 });
  });
  it("clamps captured drags outside the minimap and ignores hidden/invalid geometry", () => {
    const rect = { left: 20, top: 40, width: 136, height: 109 };
    expect(minimapPoint(rect, -100, 1000, 40)).toEqual({ x: 0, z: 40 });
    expect(minimapPoint(rect, 1000, -100, 40)).toEqual({ x: 40, z: 0 });
    expect(minimapPoint({ ...rect, width: 0 }, 0, 0, 40)).toBeNull();
    expect(minimapPoint(rect, NaN, 0, 40)).toBeNull();
  });
});
