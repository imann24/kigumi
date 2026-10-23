import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type BuildingKind } from "../simulation/catalog";
import { cell, dimensions } from "../simulation/grid";
import type { Point, World } from "../simulation/types";
import {
  buildingModel,
  disposeGroup,
  selectionFootprint,
  selectionRing,
  villagerSelectionRing,
} from "./art";
import { ActionCursorController } from "./action-cursor";
import { SceneEntities } from "./scene-entities";
import { createTerrain } from "./terrain";
import { panCamera } from "./camera-pan";
import { PlannedPaths } from "./planned-paths";
import { paddyHeight } from "./surfaces";
import { MapGrid } from "./map-grid";
export type Hit = { type: "villager" | "building" | "resource"; id: number };
export class VillageScene {
  renderer: THREE.WebGLRenderer;
  readonly cursor: ActionCursorController;
  private listeners = new AbortController();
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  private terrain = new THREE.Group();
  private entities = new SceneEntities();
  private paths = new THREE.Group();
  private markers = new THREE.Group();
  private plannedPaths = new PlannedPaths();
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private grid = new MapGrid();
  private ghost = new THREE.Group();
  private world?: World;
  private pathSignature = "";
  private footprint?: THREE.Mesh;
  private ghostKind?: BuildingKind;
  private ghostRotation = 0;
  private selected = new Set<number>();
  private selectedObject: Hit | null = null;
  private keys = new Set<string>();
  private lastTime = 0;
  private petals: THREE.InstancedMesh;
  private temp = new THREE.Object3D();
  constructor(public canvas: HTMLCanvasElement) {
    this.cursor = new ActionCursorController(canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene.background = new THREE.Color("#dce3d7");
    this.scene.fog = new THREE.Fog("#dce3d7", 55, 100);
    this.camera = new THREE.OrthographicCamera(-22, 22, 16, -16, 0.1, 160);
    this.camera.position.set(45, 37, 49);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(19, 0, 20);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minZoom = 0.65;
    this.controls.maxZoom = 3.5;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.mouseButtons = {
      LEFT: undefined as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: undefined as unknown as THREE.MOUSE,
    };
    this.controls.enablePan = false;
    this.controls.update();
    // Let OrbitControls retain wheel/trackpad normalization and zoom limits.
    // Translate on the ground plane after its zoom, rather than moving vertically.
    let wheelAnchor: Point | null = null;
    let wheelZoom = this.camera.zoom;
    canvas.addEventListener(
      "wheel",
      (e) => {
        wheelAnchor = null;
        const rect = canvas.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          return;
        wheelAnchor = this.pointerWorld(e.clientX, e.clientY);
        wheelZoom = this.camera.zoom;
      },
      { capture: true, passive: true },
    );
    canvas.addEventListener("wheel", (e) => {
      if (!wheelAnchor || wheelZoom === this.camera.zoom) return;
      const after = this.pointerWorld(e.clientX, e.clientY);
      if (after)
        panCamera(this.camera, this.controls.target, {
          x: wheelAnchor.x - after.x,
          z: wheelAnchor.z - after.z,
        });
      wheelAnchor = null;
    });
    this.scene.add(new THREE.HemisphereLight("#fff6d9", "#7a8e78", 2.1));
    const sun = new THREE.DirectionalLight("#ffe7bb", 3.5);
    sun.position.set(-16, 40, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -34,
      right: 34,
      top: 34,
      bottom: -34,
      near: 0.5,
      far: 100,
    });
    sun.shadow.normalBias = 0.045;
    sun.shadow.bias = -0.0001;
    sun.target.position.set(20, 0, 20);
    this.scene.add(sun, sun.target);
    this.scene.add(
      this.terrain,
      this.paths,
      this.entities,
      this.markers,
      this.plannedPaths,
      this.ghost,
    );
    this.scene.add(this.grid);
    this.petals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.07, 0.12),
      new THREE.MeshBasicMaterial({
        color: "#f3d5c0",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
      }),
      35,
    );
    this.scene.add(this.petals);
    const options = { signal: this.listeners.signal };
    window.addEventListener("resize", () => this.resize(), options);
    window.addEventListener(
      "keydown",
      (e) => {
        if (
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLSelectElement)
        )
          this.keys.add(e.code);
      },
      options,
    );
    window.addEventListener("keyup", (e) => this.keys.delete(e.code), options);
    window.addEventListener("blur", () => this.keys.clear(), options);
    this.resize();
  }
  dispose() {
    this.cursor.dispose();
    this.listeners.abort();
    this.controls.dispose();
    this.entities.reset();
    disposeGroup(this.scene);
    this.renderer.dispose();
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.left = -16 * aspect;
    this.camera.right = 16 * aspect;
    this.camera.top = 16;
    this.camera.bottom = -16;
    this.camera.updateProjectionMatrix();
  }
  setWorld(w: World) {
    this.cursor.clear();
    this.world = w;
    this.grid.setSize(w.size);
    this.selected.clear();
    this.selectedObject = null;
    this.plannedPaths.clearRoutes();
    this.entities.reset();
    for (const group of [this.paths, this.markers, this.terrain]) {
      disposeGroup(group);
      group.clear();
    }
    this.pathSignature = "";
    this.terrain.add(createTerrain(w));
    this.sync(w);
    this.home();
  }
  home() {
    this.controls.target.set(19, 0, 20);
    this.camera.position.set(45, 37, 49);
    this.camera.zoom = 1.28;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  focus(p: Point) {
    const delta = new THREE.Vector3(p.x, 0, p.z).sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.controls.update();
  }
  select(ids: number[], object: Hit | null = null) {
    this.selected = new Set(ids);
    this.selectedObject = object;
    this.plannedPaths.clearRoutes();
    this.updateMarkers();
  }
  private markerHeight(p: Point) {
    // Clear the road surface (0.08) and raised bridge planks (0.225).
    // Depth testing still lets feet, buildings and foliage cover the markings.
    const w = this.world;
    if (w && paddyHeight(w, p)) return paddyHeight(w, p) + 0.025;
    return w?.bridges.includes(cell(w, Math.floor(p.x), Math.floor(p.z)))
      ? 0.245
      : 0.1;
  }
  private updateMarkers() {
    disposeGroup(this.markers);
    this.markers.clear();
    if (!this.world) return;
    for (const v of this.world.villagers)
      if (this.selected.has(v.id)) {
        const ring = villagerSelectionRing();
        ring.position.set(v.x, this.markerHeight(v), v.z);
        this.markers.add(ring);
      }
    if (this.selectedObject?.type === "building") {
      const b = this.world.buildings.find(
        (b) => b.id === this.selectedObject!.id,
      );
      if (b) {
        const [a, c] = dimensions(b);
        const ring = selectionFootprint(a, c);
        ring.position.set(b.x + a / 2, 0.1, b.z + c / 2);
        this.markers.add(ring);
      }
    } else if (this.selectedObject?.type === "resource") {
      const n = this.world.nodes.find(
        (n) => n.id === this.selectedObject!.id && n.amount > 0,
      );
      if (n) {
        const ring = selectionRing(n.kind === "wood" ? 0.85 : 0.7);
        ring.position.set(n.x + 0.5, 0.1, n.z + 0.5);
        this.markers.add(ring);
      }
    }
  }
  /** Snapshot immediately before each fixed simulation step. */
  captureMovement(w: World) {
    this.entities.captureMovement(w);
  }
  /** Called once after a successful player gather command, regardless of party size. */
  flashResource(id: number) {
    if (
      !this.world?.villagers.some((v) => this.selected.has(v.id)) ||
      !this.world.nodes.some((n) => n.id === id && n.amount > 0)
    )
      return;
    this.entities.flashResource(id, performance.now());
  }
  sync(w: World) {
    this.world = w;
    this.entities.sync(w);
    if (
      this.selectedObject &&
      !this.entities.getModel(
        `${this.selectedObject.type}:${this.selectedObject.id}`,
      )
    ) {
      this.selectedObject = null;
      this.updateMarkers();
    }
    const signature = `${w.roads.length}:${w.bridges.length}`;
    if (this.pathSignature !== signature) {
      this.pathSignature = signature;
      disposeGroup(this.paths);
      this.paths.clear();
      for (const [tiles, kind] of [
        [w.roads, "road"],
        [w.bridges, "bridge"],
      ] as const) {
        for (const i of tiles) {
          const g = buildingModel(kind);
          g.position.set((i % w.size) + 0.5, 0, Math.floor(i / w.size) + 0.5);
          this.paths.add(g);
        }
      }
    }
  }
  pointerWorld(clientX: number, clientY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(clientX + clientY))
      return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.pointer, this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, p)) return null;
    return { x: p.x, z: p.z };
  }
  panPointer(from: { x: number; y: number }, to: { x: number; y: number }) {
    // Ground-plane intersections account for zoom, tilt, and orbit orientation.
    const a = this.pointerWorld(from.x, from.y);
    const b = this.pointerWorld(to.x, to.y);
    if (a && b)
      panCamera(this.camera, this.controls.target, {
        x: a.x - b.x,
        z: a.z - b.z,
      });
  }
  hit(clientX: number, clientY: number): Hit | null {
    this.pointerWorld(clientX, clientY);
    const hits = this.ray.intersectObjects(this.entities.children, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      let target: Hit | null = null;
      while (obj && obj !== this.entities) {
        // Raycaster also intersects invisible objects, including unfinished roofs.
        if (!obj.visible) {
          target = null;
          break;
        }
        if (obj.userData.type) target = obj.userData as Hit;
        obj = obj.parent;
      }
      if (target) return target;
    }
    return null;
  }
  inRectangle(x1: number, y1: number, x2: number, y2: number): number[] {
    if (!this.world) return [];
    const rect = this.canvas.getBoundingClientRect();
    return this.world.villagers
      .filter((v) => {
        const rendered =
          this.entities.getModel(`villager:${v.id}`)?.position ?? v;
        const p = new THREE.Vector3(rendered.x, 0.4, rendered.z).project(
          this.camera,
        );
        const x = ((p.x + 1) * rect.width) / 2 + rect.left,
          y = ((-p.y + 1) * rect.height) / 2 + rect.top;
        return (
          x >= Math.min(x1, x2) &&
          x <= Math.max(x1, x2) &&
          y >= Math.min(y1, y2) &&
          y <= Math.max(y1, y2)
        );
      })
      .map((v) => v.id);
  }
  preview(kind: BuildingKind | null, p?: Point, rotation = 0, valid = true) {
    if (!kind || !p) {
      this.ghost.visible = false;
      return;
    }
    if (this.ghostKind !== kind || this.ghostRotation !== rotation) {
      disposeGroup(this.ghost);
      this.ghost.clear();
      this.ghostKind = kind;
      this.ghostRotation = rotation;
      const model = buildingModel(kind);
      model.rotation.y = (rotation * Math.PI) / 2;
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = (o.material as THREE.Material).clone();
          (o.material as THREE.Material).transparent = true;
          (o.material as THREE.Material).opacity = 0.55;
        }
      });
      this.ghost.add(model);
      const [a, c] = dimensions({ kind, rotation });
      this.footprint = new THREE.Mesh(
        new THREE.BoxGeometry(a, 0.04, c),
        new THREE.MeshBasicMaterial({
          color: "#648570",
          transparent: true,
          opacity: 0.5,
        }),
      );
      this.footprint.position.y = 0.07;
      this.ghost.add(this.footprint);
    }
    const [a, c] = dimensions({ kind, rotation });
    this.ghost.visible = true;
    this.ghost.position.set(
      Math.floor(p.x) + a / 2,
      0.03,
      Math.floor(p.z) + c / 2,
    );
    (this.footprint!.material as THREE.MeshBasicMaterial).color.set(
      valid ? "#6b9577" : "#b75d49",
    );
  }
  showGrid(enabled: boolean) {
    this.grid.visible = enabled;
  }
  frame(now: number, alpha = 1, simulationDelta = 0) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;
    this.entities.updatePulses(now);
    const right = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrix,
      0,
    );
    right.y = 0;
    right.normalize();
    const forward = new THREE.Vector3().crossVectors(
      new THREE.Vector3(0, 1, 0),
      right,
    );
    const pan = new THREE.Vector3();
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) pan.add(forward);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) pan.sub(forward);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) pan.add(right);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) pan.sub(right);
    pan.multiplyScalar((dt * 12) / this.camera.zoom);
    if (
      this.controls.target.x + pan.x >= 0 &&
      this.controls.target.x + pan.x <= 40 &&
      this.controls.target.z + pan.z >= 0 &&
      this.controls.target.z + pan.z <= 40
    ) {
      this.camera.position.add(pan);
      this.controls.target.add(pan);
    }
    const angle =
      (this.keys.has("KeyQ") ? 1 : 0) - (this.keys.has("KeyE") ? 1 : 0);
    if (angle) {
      const offset = this.camera.position
        .clone()
        .sub(this.controls.target)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * dt);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.entities.animate(this.world, alpha, simulationDelta);
    if (this.world)
      this.plannedPaths.update(
        this.world,
        this.selected,
        (v) => this.entities.getModel(`villager:${v.id}`)?.position ?? v,
      );
    // Move existing rings instead of rebuilding geometry every animation frame.
    let index = 0;
    for (const v of this.world?.villagers ?? [])
      if (this.selected.has(v.id)) {
        const ring = this.markers.children[index++];
        const rendered =
          this.entities.getModel(`villager:${v.id}`)?.position ?? v;
        if (ring)
          ring.position.set(
            rendered.x,
            this.markerHeight(rendered),
            rendered.z,
          );
      }
    for (let i = 0; i < 35; i++) {
      this.temp.position.set(
        5 + ((i * 7.17 + now * 0.0004) % 30),
        1 + ((i * 0.57 + now * 0.00015) % 4),
        5 + ((i * 3.71 + now * 0.0002) % 30),
      );
      this.temp.scale.set(1, 1, 1);
      this.temp.rotation.set(i + now * 0.0003, i, now * 0.0006);
      this.temp.updateMatrix();
      this.petals.setMatrixAt(i, this.temp.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.cursor.update(now);
  }
}
