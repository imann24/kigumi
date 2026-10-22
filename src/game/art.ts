import * as THREE from "three";
import type { BuildingKind } from "../simulation/catalog";
const materials = new Map<string, THREE.MeshStandardMaterial>();
export function material(color: string) {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
    materials.set(color, m);
  }
  return m;
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1),
  sphereGeo = new THREE.IcosahedronGeometry(1, 1);
export function box(
  g: THREE.Group,
  color: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  const m = new THREE.Mesh(boxGeo, material(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
export function stone(
  g: THREE.Group,
  color: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  const m = new THREE.Mesh(sphereGeo, material(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
const wood = "#8c6347",
  darkWood = "#5c4939",
  plaster = "#e8ddbe",
  roofColor = "#566665";
/** Curved hip roof: the middle ring gives the eaves a subtle upturn. */
function roof(
  g: THREE.Group,
  w: number,
  d: number,
  y: number,
  color = roofColor,
  height = 0.9,
) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [scale, dy] of [
    [1, 0],
    [0.67, 0.15],
    [0.12, height],
  ])
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      vertices.push(x * w * 0.5 * scale, y + dy, z * d * 0.5 * scale);
  for (let ring = 0; ring < 2; ring++)
    for (let i = 0; i < 4; i++) {
      const a = ring * 4 + i,
        b = ring * 4 + ((i + 1) % 4),
        c = a + 4,
        e = b + 4;
      indices.push(a, c, b, b, c, e);
    }
  indices.push(8, 9, 10, 8, 10, 11);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  box(g, "#394d4b", 0, y + height + 0.045, 0, w * 0.19, 0.12, 0.15);
  // Fine tile lines on both pitches.
  for (let i = -Math.floor(w * 2); i <= Math.floor(w * 2); i++) {
    const x = i * 0.23;
    if (Math.abs(x) > w * 0.44) continue;
    for (const sign of [-1, 1]) {
      const curve = new THREE.LineCurve3(
        new THREE.Vector3(x, y + 0.025, sign * d * 0.48),
        new THREE.Vector3(x * 0.22, y + height + 0.025, sign * d * 0.055),
      );
      const line = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 1, 0.012, 3, false),
        material(color === "#a88b62" ? "#b69d77" : "#657775"),
      );
      g.add(line);
    }
  }
}
function lantern(g: THREE.Group, x: number, z: number) {
  box(g, darkWood, x, 0.8, z, 0.07, 1.6, 0.07);
  box(g, "#ebc78c", x, 1.5, z, 0.27, 0.35, 0.27);
  box(g, darkWood, x, 1.73, z, 0.34, 0.07, 0.34);
  box(g, wood, x, 1.28, z, 0.32, 0.06, 0.32);
}
function house(
  g: THREE.Group,
  w: number,
  d: number,
  tall = false,
  thatched = false,
) {
  const y = tall ? 1.7 : 1.15;
  box(g, "#989b89", 0, 0.12, 0, w, 0.24, d);
  box(g, wood, 0, 0.3, 0, w + 0.12, 0.15, d + 0.1);
  box(g, plaster, 0, 0.3 + y / 2, 0, w - 0.2, y, d - 0.2);
  for (const x of [-w / 2 + 0.12, 0, w / 2 - 0.12]) {
    box(g, darkWood, x, 0.3 + y / 2, d / 2 - 0.06, 0.085, y, 0.08);
    box(g, darkWood, x, 0.3 + y / 2, -d / 2 + 0.06, 0.085, y, 0.08);
  }
  box(g, wood, 0, 0.55, d / 2, 0.08, 0.6, 0.08);
  box(g, wood, 0, 0.52, d / 2, w, 0.07, 0.06);
  box(g, wood, 0, y + 0.25, d / 2, w, 0.09, 0.08);
  for (const x of [-w * 0.28, w * 0.28]) {
    box(g, "#b9c2af", x, 0.88, d / 2 - 0.02, w * 0.2, 0.5, 0.045);
    for (let i = 0; i < 3; i++)
      box(
        g,
        wood,
        x + (i - 1) * w * 0.065,
        0.88,
        d / 2 + 0.01,
        0.025,
        0.5,
        0.035,
      );
    box(g, wood, x, 0.88, d / 2 + 0.02, w * 0.2, 0.025, 0.03);
  }
  box(g, darkWood, 0, 0.71, d / 2 + 0.015, 0.43, 0.8, 0.06);
  box(g, "#b69366", 0, 0.69, d / 2 + 0.05, 0.32, 0.73, 0.02);
  for (const x of [-0.1, 0, 0.1])
    box(g, darkWood, x, 0.69, d / 2 + 0.07, 0.02, 0.73, 0.025);
  roof(
    g,
    w + 0.65,
    d + 0.65,
    y + 0.35,
    thatched ? "#a88b62" : roofColor,
    tall ? 1.15 : 0.8,
  );
  box(g, "#a7a38e", 0, 0.13, d / 2 + 0.25, 0.7, 0.2, 0.4);
}
export function buildingModel(kind: BuildingKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === "hall") {
    house(g, 3.3, 2.9, true);
    const upper = new THREE.Group();
    upper.position.y = 2.6;
    house(upper, 1.7, 1.5, false);
    g.add(upper);
    for (const x of [-1.7, 1.7]) {
      box(g, wood, x, 0.65, 1.65, 0.13, 1.3, 0.13);
      lantern(g, x, 1.7);
    }
    box(g, "#9a5948", 0, 0.21, 1.75, 2, 0.1, 0.65);
  } else if (kind === "house") {
    house(g, 2.35, 1.45, false, true);
    box(g, "#a88b62", -1, 0.4, -0.7, 0.4, 0.55, 0.4);
  } else if (kind === "store") {
    house(g, 1.6, 1.6);
    for (let i = 0; i < 3; i++) {
      box(g, "#b99a68", -0.5 + i * 0.45, 0.36, 1, 0.37, 0.5, 0.32);
      box(g, wood, -0.5 + i * 0.45, 0.36, 1.18, 0.4, 0.045, 0.035);
    }
  } else if (kind === "workshop") {
    house(g, 2.35, 1.45);
    box(g, darkWood, -0.4, 0.4, 1, 0.9, 0.1, 0.35);
    for (let i = 0; i < 4; i++)
      box(g, wood, -1 + i * 0.32, 0.2, -0.9, 0.22, 0.22, 0.9);
    box(g, "#8a8b7e", 0.9, 1.6, -0.4, 0.35, 1.1, 0.35);
  } else if (kind === "tea") {
    house(g, 2.4, 1.4);
    box(g, wood, 0, 0.17, 1, 2.7, 0.16, 0.8);
    for (const x of [-0.7, 0.7]) {
      box(g, "#9d5947", x, 0.3, 1, 0.55, 0.16, 0.4);
      lantern(g, x, 1.2);
    }
    box(g, "#879e91", 0, 1.35, 0.76, 1, 0.4, 0.04);
  } else if (kind === "farm") {
    box(g, "#9d9870", 0, 0.055, 0, 2.95, 0.12, 2.95);
    box(g, "#7caaa0", 0, 0.13, 0, 2.65, 0.035, 2.65);
    for (const a of [-1, 1]) {
      box(g, "#c0ad7e", a * 1.43, 0.17, 0, 0.12, 0.2, 3);
      box(g, "#c0ad7e", 0, 0.17, a * 1.43, 3, 0.2, 0.12);
    }
    for (let x = -1.1; x <= 1.1; x += 0.37)
      for (let z = -1.1; z <= 1.1; z += 0.37) {
        const stalk = box(g, "#9cba67", x, 0.32, z, 0.045, 0.36, 0.045);
        stalk.rotation.z = 0.1;
        const leaf = box(g, "#b6c67b", x + 0.055, 0.35, z, 0.03, 0.28, 0.04);
        leaf.rotation.z = -0.4;
      }
  } else if (kind === "shrine") {
    box(g, "#b9b7a0", 0, 0.12, 0, 1.8, 0.22, 1.8);
    house(g, 0.9, 0.8);
    for (const x of [-0.7, 0.7])
      box(g, "#a64e3f", x, 1.15, 0.73, 0.13, 2.2, 0.13);
    box(g, "#a64e3f", 0, 2, 0.73, 1.85, 0.15, 0.18);
    box(g, darkWood, 0, 2.21, 0.73, 2, 0.12, 0.23);
    stone(g, "#74976c", -0.7, 0.4, -0.5, 0.45, 0.5, 0.4);
  } else if (kind === "road") box(g, "#cec8b0", 0, 0.04, 0, 0.97, 0.08, 0.97);
  else if (kind === "bridge") {
    box(g, "#ac8a5e", 0, 0.09, 0, 1, 0.18, 1);
    for (let i = 0; i < 4; i++)
      box(g, "#c6a478", 0, 0.2, -0.36 + i * 0.24, 0.98, 0.05, 0.19);
  }
  return g;
}
export function treeModel(variant: number) {
  const g = new THREE.Group(),
    h = 1.6 + variant * 0.9;
  box(g, wood, 0, h * 0.4, 0, 0.17, h * 0.8, 0.17);
  if (variant > 0.7) {
    const pink = variant > 0.88;
    const colors = pink
      ? ["#dfaaa3", "#edc2b7", "#d69c9b"]
      : ["#77936b", "#93aa77", "#a9b685"];
    stone(g, colors[0], 0, h, 0, 0.82, 0.78, 0.72);
    stone(g, colors[1], -0.35, h + 0.35, 0.08, 0.6, 0.6, 0.6);
    stone(g, colors[2], 0.37, h + 0.1, 0.2, 0.6, 0.55, 0.6);
  } else {
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.78 - i * 0.16, 1.1, 7),
        material(["#537e68", "#658b6e", "#7b9a75"][i]),
      );
      mesh.position.y = h * 0.45 + i * 0.48;
      mesh.castShadow = true;
      g.add(mesh);
    }
  }
  return g;
}
export function villagerModel(index: number) {
  const g = new THREE.Group(),
    colors = ["#b66c51", "#748f91", "#ccad6b", "#6e8572", "#a28a97"];
  const body = box(
    g,
    colors[index % colors.length],
    0,
    0.38,
    0,
    0.23,
    0.36,
    0.18,
  );
  body.rotation.z = 0.02;
  stone(g, "#ddba91", 0, 0.67, 0, 0.13, 0.14, 0.13);
  box(g, "#514536", 0, 0.77, -0.015, 0.22, 0.09, 0.2);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = side < 0 ? "left-leg" : "right-leg";
    leg.position.set(side * 0.07, 0.235, 0);
    box(leg, "#565647", 0, -0.115, 0, 0.075, 0.23, 0.08);
    g.add(leg);
    const arm = new THREE.Group();
    arm.name = side < 0 ? "left-arm" : "right-arm";
    arm.position.set(side * 0.16, 0.545, 0);
    arm.rotation.z = side * 0.16;
    box(arm, colors[index % colors.length], 0, -0.145, 0, 0.07, 0.29, 0.08);
    g.add(arm);
  }
  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.25, 0.13, 10),
    material("#c8b17c"),
  );
  hat.position.y = 0.87;
  hat.name = "hat";
  g.add(hat);
  const cargo = box(g, "#b99a68", 0, 0.4, -0.2, 0.25, 0.27, 0.2);
  cargo.name = "cargo";
  cargo.visible = false;
  return g;
}
/** Ground-plane overlays stay legible through foliage and on light paths. */
function selectionLayer(
  geometry: THREE.BufferGeometry,
  color: string,
  order: number,
) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = order;
  return mesh;
}

export function selectionRing(radius = 0.4) {
  const group = new THREE.Group();
  group.add(
    selectionLayer(
      new THREE.RingGeometry(radius * 0.78, radius + 0.035, 64),
      "#405445",
      10,
    ),
    selectionLayer(
      new THREE.RingGeometry(radius * 0.84, radius, 64),
      "#fff0ba",
      11,
    ),
  );
  return group;
}

export function villagerSelectionRing() {
  const group = new THREE.Group();
  group.add(
    selectionLayer(new THREE.RingGeometry(0.34, 0.73, 64), "#182b26", 12),
    selectionLayer(new THREE.RingGeometry(0.43, 0.64, 64), "#fff36b", 13),
  );
  return group;
}

export function selectionFootprint(width: number, depth: number) {
  const group = new THREE.Group();
  const border = (padding: number, thickness: number) => {
    const x = width / 2 + padding,
      y = depth / 2 + padding;
    const shape = new THREE.Shape();
    shape.moveTo(-x, -y);
    shape.lineTo(x, -y);
    shape.lineTo(x, y);
    shape.lineTo(-x, y);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-x + thickness, -y + thickness);
    hole.lineTo(-x + thickness, y - thickness);
    hole.lineTo(x - thickness, y - thickness);
    hole.lineTo(x - thickness, -y + thickness);
    hole.closePath();
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape);
  };
  group.add(
    selectionLayer(border(0.15, 0.18), "#405445", 10),
    selectionLayer(border(0.11, 0.1), "#fff0ba", 11),
  );
  return group;
}

/** Release per-model geometry without disposing the shared primitive/material cache. */
export function disposeGroup(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    ownedMaterials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      if (o.geometry !== boxGeo && o.geometry !== sphereGeo)
        geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (![...materials.values()].includes(m)) ownedMaterials.add(m);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of ownedMaterials) m.dispose();
}
