import * as THREE from "three";

const RISE_MS = 120;
const DURATION_MS = 650;
const cream = new THREE.Color("#fff0ba");
type TintedMaterial = THREE.Material & { color: THREE.Color };
type Pulse = {
  started: number;
  from: number;
  strength: number;
  meshes: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[];
  materials: Map<TintedMaterial, TintedMaterial>;
};
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Temporary, model-local materials; shared geometry and cached art stay untouched. */
export class ResourcePulses {
  private active = new Map<THREE.Object3D, Pulse>();

  start(model: THREE.Object3D, now: number) {
    const current = this.active.get(model);
    if (current) {
      // Rise from the last rendered brightness instead of snapping back to dark.
      current.from = current.strength;
      current.started = now;
      return;
    }
    const pulse: Pulse = {
      started: now,
      from: 0,
      strength: 0,
      meshes: [],
      materials: new Map(),
    };
    const clone = (original: THREE.Material) => {
      if (!("color" in original) || !(original.color instanceof THREE.Color))
        return original;
      const tinted = original as TintedMaterial;
      let copy = pulse.materials.get(tinted);
      if (!copy) {
        copy = tinted.clone();
        pulse.materials.set(tinted, copy);
      }
      return copy;
    };
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material;
      pulse.meshes.push({ mesh: object, original });
      object.material = Array.isArray(original)
        ? original.map(clone)
        : clone(original);
    });
    this.active.set(model, pulse);
  }

  update(now: number) {
    for (const [model, pulse] of this.active) {
      const elapsed = Math.max(0, now - pulse.started);
      if (elapsed >= DURATION_MS) {
        this.remove(model);
        continue;
      }
      pulse.strength =
        elapsed < RISE_MS
          ? THREE.MathUtils.lerp(pulse.from, 1, smoothstep(elapsed / RISE_MS))
          : 1 - smoothstep((elapsed - RISE_MS) / (DURATION_MS - RISE_MS));
      for (const [original, copy] of pulse.materials) {
        copy.color.copy(original.color).lerp(cream, pulse.strength * 0.35);
        if (
          copy instanceof THREE.MeshStandardMaterial &&
          original instanceof THREE.MeshStandardMaterial
        ) {
          // A little emission keeps shaded trunks and lower foliage readable too.
          copy.emissive
            .copy(original.emissive)
            .lerp(cream, pulse.strength * 0.2);
          copy.emissiveIntensity = THREE.MathUtils.lerp(
            original.emissiveIntensity,
            1,
            pulse.strength,
          );
        }
      }
    }
  }

  remove(model: THREE.Object3D) {
    const pulse = this.active.get(model);
    if (!pulse) return;
    for (const { mesh, original } of pulse.meshes) mesh.material = original;
    for (const copy of pulse.materials.values()) copy.dispose();
    this.active.delete(model);
  }

  clear() {
    for (const model of this.active.keys()) this.remove(model);
  }
}
