import * as THREE from "three";
import { buildingModel, disposeGroup } from "./art";
import { BUILDINGS, type BuildingKind } from "../simulation/catalog";
export function thumbnails(): Record<BuildingKind, string> {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(192, 128);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#fff6de", "#8c9d83", 2.8));
  const sun = new THREE.DirectionalLight("#fff0cf", 3);
  sun.position.set(-3, 7, 5);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-2.6, 2.6, 2.1, -1.4, 0.1, 30);
  camera.position.set(5, 4.5, 6);
  camera.lookAt(0, 0.5, 0);
  const result = {} as Record<BuildingKind, string>;
  for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
    const g = buildingModel(kind);
    scene.add(g);
    renderer.render(scene, camera);
    result[kind] = renderer.domElement.toDataURL();
    scene.remove(g);
    disposeGroup(g);
  }
  renderer.dispose();
  return result;
}
