import * as THREE from "three";
import { dimensions } from "../simulation/grid";
import type { Point, World } from "../simulation/types";
import { workingActivity } from "../simulation/work-activity";
import {
  berryBushModel,
  buildingModel,
  disposeGroup,
  setBuildingProgress,
  stone,
  treeModel,
  villagerModel,
} from "./art";
import { advanceWalk, interpolatePosition, type WalkPose } from "./walking";
import {
  advanceGather,
  applyGatherPose,
  createGatherPose,
  gatheringRig,
  type GatherPose,
  type GatheringRig,
} from "./gathering";
import { paddyHeight } from "./surfaces";
import { ResourcePulses } from "./resource-pulses";

/** Owns entity models and visual-only state; never advances or mutates the world. */
export class SceneEntities extends THREE.Group {
  private models = new Map<string, THREE.Group>();
  private previousPositions = new Map<number, Point>();
  private walkPoses = new Map<number, WalkPose>();
  private gatherPoses = new Map<number, GatherPose>();
  private gatherRigs = new Map<number, GatheringRig>();
  private resourcePulses = new ResourcePulses();

  getModel(key: string) {
    return this.models.get(key);
  }

  /** Restore pulse materials before releasing models, including on save replacement. */
  reset() {
    this.resourcePulses.clear();
    this.models.clear();
    this.previousPositions.clear();
    this.walkPoses.clear();
    this.gatherPoses.clear();
    this.gatherRigs.clear();
    disposeGroup(this);
    this.clear();
  }

  /** Snapshot immediately before each fixed simulation step, including multiple steps per frame. */
  captureMovement(w: World) {
    for (const v of w.villagers)
      this.previousPositions.set(v.id, { x: v.x, z: v.z });
  }
  flashResource(id: number, now: number) {
    const model = this.models.get(`resource:${id}`);
    if (model) this.resourcePulses.start(model, now);
  }

  sync(w: World) {
    const alive = new Set<string>();
    for (const n of w.nodes) {
      if (n.amount <= 0) continue;
      const key = `resource:${n.id}`;
      alive.add(key);
      if (!this.models.has(key)) {
        let g: THREE.Group;
        if (n.kind === "wood") g = treeModel(n.variant);
        else if (n.kind === "food") g = berryBushModel();
        else {
          g = new THREE.Group();
          stone(g, "#969e91", 0, 0.36, 0, 0.6, 0.58, 0.51);
          stone(g, "#b5b6a3", 0.28, 0.22, 0.3, 0.35, 0.3, 0.35);
        }
        g.position.set(n.x + 0.5, 0, n.z + 0.5);
        g.rotation.y = n.variant * 6;
        g.userData = { type: "resource", id: n.id };
        this.add(g);
        this.models.set(key, g);
      }
    }
    for (const b of w.buildings) {
      const key = `building:${b.id}`;
      alive.add(key);
      let g = this.models.get(key);
      if (!g) {
        g = buildingModel(b.kind);
        const [a, c] = dimensions(b);
        g.position.set(b.x + a / 2, 0, b.z + c / 2);
        g.rotation.y = (b.rotation * Math.PI) / 2;
        g.userData = { type: "building", id: b.id };
        this.add(g);
        this.models.set(key, g);
      }
      setBuildingProgress(g, b.progress);
    }
    for (const v of w.villagers) {
      const key = `villager:${v.id}`;
      alive.add(key);
      let g = this.models.get(key);
      if (!g) {
        g = villagerModel(v.id);
        this.gatherPoses.set(v.id, createGatherPose(v.id));
        this.gatherRigs.set(v.id, gatheringRig(g));
        this.walkPoses.set(v.id, { phase: v.id % 6, weight: 0, heading: 0 });
        g.position.set(v.x, 0, v.z);
        g.userData = { type: "villager", id: v.id };
        this.add(g);
        this.models.set(key, g);
      }
      g.getObjectByName("cargo")!.visible = !!v.cargo;
    }
    for (const [key, g] of this.models)
      if (!alive.has(key)) {
        this.resourcePulses.remove(g);
        this.remove(g);
        disposeGroup(g);
        this.models.delete(key);
        if (g.userData.type === "villager") {
          this.walkPoses.delete(g.userData.id);
          this.previousPositions.delete(g.userData.id);
          this.gatherPoses.delete(g.userData.id);
          this.gatherRigs.delete(g.userData.id);
        }
      }
  }

  updatePulses(now: number) {
    this.resourcePulses.update(now);
  }

  animate(w: World | undefined, alpha: number, simulationDelta: number) {
    for (const v of w?.villagers ?? []) {
      const g = this.models.get(`villager:${v.id}`);
      if (g) {
        const p = interpolatePosition(
          this.previousPositions.get(v.id) ?? v,
          v,
          alpha,
        );
        const pose = this.walkPoses.get(v.id)!;
        const moving =
          Math.hypot(p.x - g.position.x, p.z - g.position.z) > 0.000001;
        advanceWalk(
          pose,
          p.x - g.position.x,
          p.z - g.position.z,
          simulationDelta,
        );
        g.position.x = p.x;
        g.position.z = p.z;
        const gather = this.gatherPoses.get(v.id)!;
        advanceGather(
          gather,
          moving ? null : workingActivity(w!, v),
          pose,
          p,
          simulationDelta,
        );
        g.rotation.y = pose.heading;
        const stride = Math.sin(pose.phase) * pose.weight;
        g.getObjectByName("left-leg")!.rotation.x = stride * 0.48;
        g.getObjectByName("right-leg")!.rotation.x = -stride * 0.48;
        g.getObjectByName("left-arm")!.rotation.x = -stride * 0.32;
        g.getObjectByName("right-arm")!.rotation.x = stride * 0.32;
        applyGatherPose(this.gatherRigs.get(v.id)!, gather);
        g.position.y =
          paddyHeight(w!, p) +
          (1 - Math.cos(pose.phase * 2)) * 0.012 * pose.weight;
        g.rotation.z = stride * 0.018;
      }
    }
  }
}
