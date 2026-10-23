import * as THREE from "three";

/** Tile boundaries on the placement plane, beneath entities and selection marks. */
export class MapGrid extends THREE.LineSegments<
  THREE.BufferGeometry,
  THREE.LineBasicMaterial
> {
  private size = 0;

  constructor() {
    super(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: "#485d50",
        transparent: true,
        opacity: 0.62,
        toneMapped: false,
        depthTest: true,
        depthWrite: false,
      }),
    );
    // Grass tops are at y=0.015; leave a real gap to avoid coplanar flicker.
    // Roads, bridges, buildings and villagers still occlude the lines naturally.
    this.position.y = 0.04;
    this.renderOrder = 1;
    this.visible = false;
    this.raycast = () => {};
  }

  setSize(size: number) {
    if (size === this.size) return;
    const positions: number[] = [];
    for (let i = 0; i <= size; i++) {
      positions.push(0, 0, i, size, 0, i, i, 0, 0, i, 0, size);
    }
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.size = size;
  }
}
