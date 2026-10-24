import * as THREE from "three";
import {
  CUSHIONS,
  WIDTH,
  HEIGHT,
  POCKETS,
  POCKET_RADIUS,
} from "../shared/table";

function roundedRectangle(w: number, d: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return s;
}
// An actual cut-out, including the outer parts of all six pockets. No black discs on felt.
function opening(outward: boolean) {
  const p = POCKET_RADIUS,
    w = WIDTH / 2,
    h = HEIGHT / 2,
    s = new THREE.Shape();
  s.moveTo(-w + p, -h);
  s.lineTo(-p, -h);
  s.absarc(0, -h, p, Math.PI, outward ? Math.PI * 2 : 0, !outward);
  s.lineTo(w - p, -h);
  s.absarc(w, -h, p, Math.PI, outward ? Math.PI * 2.5 : Math.PI / 2, !outward);
  s.lineTo(w, h - p);
  s.absarc(w, h, p, -Math.PI / 2, outward ? Math.PI : -Math.PI, !outward);
  s.lineTo(p, h);
  s.absarc(0, h, p, 0, outward ? Math.PI : -Math.PI, !outward);
  s.lineTo(-w + p, h);
  s.absarc(-w, h, p, 0, outward ? Math.PI * 1.5 : -Math.PI / 2, !outward);
  s.lineTo(-w, -h + p);
  s.absarc(-w, -h, p, Math.PI / 2, outward ? Math.PI * 2 : 0, !outward);
  s.closePath();
  return s;
}
function extrude(s: THREE.Shape, height: number, bevel = 0.025) {
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth: height,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
function noiseTexture(kind: "cloth" | "wood") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!,
    image = ctx.createImageData(512, 256);
  let seed = 73;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 512; x++) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed % 1000) / 1000;
      const i = (y * 512 + x) * 4;
      if (kind === "wood") {
        const grain = Math.sin(
          y * 0.69 +
            Math.sin(x * 0.012) * 2.7 +
            Math.sin(x * 0.004 + y * 0.045) * 4,
        );
        const fine = Math.sin(y * 2.9 + x * 0.009) * 0.3;
        const f = 0.76 + grain * 0.16 + fine * 0.08 + noise * 0.12;
        image.data[i] = 65 * f;
        image.data[i + 1] = 37 * f;
        image.data[i + 2] = 23 * f;
      } else {
        const f = 0.94 + noise * 0.12 + ((x + y) % 2) * 0.025;
        image.data[i] = 25 * f;
        image.data[i + 1] = 103 * f;
        image.data[i + 2] = 83 * f;
      }
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(kind === "wood" ? 0.7 : 5, kind === "wood" ? 1.7 : 5);
  t.anisotropy = 8;
  return t;
}
function cushionGeometry(points: [number, number][]) {
  const positions: number[] = [];
  points.forEach(([x, z], i) => positions.push(x, i < 2 ? 0.145 : 0.255, z));
  points.forEach(([x, z]) => positions.push(x, 0.025, z));
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    indices.push(i, i + 4, j + 4, i, j + 4, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g.toNonIndexed();
}
export function createTableBody(scene: THREE.Scene) {
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    y = 0,
  ) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const dark = new THREE.MeshStandardMaterial({
    color: "#101310",
    roughness: 0.43,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: "#9c8552",
    // Softer than real brass on purpose: a mirror rail threw a white streak
    // across the table on a phone.
    metalness: 0.5,
    roughness: 0.5,
  });
  const woodTexture = noiseTexture("wood");
  const timber = new THREE.MeshPhysicalMaterial({
    map: woodTexture,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.23,
    color: "#d6b997",
  });
  // The base is a ring, too: the wells visibly descend through it.
  const base = roundedRectangle(12.05, 6.65, 0.42);
  base.holes.push(opening(true));
  add(extrude(base, 0.58, 0.04), dark, -0.67);
  const trim = roundedRectangle(12.08, 6.68, 0.44);
  trim.holes.push(roundedRectangle(11.92, 6.52, 0.35));
  add(extrude(trim, 0.03, 0.009), brass, -0.19);
  const deck = roundedRectangle(12, 6.6, 0.4);
  deck.holes.push(opening(true));
  add(extrude(deck, 0.22, 0.015), timber, -0.12);
  const cloth = noiseTexture("cloth");
  const feltMat = new THREE.MeshStandardMaterial({
    map: cloth,
    bumpMap: cloth,
    bumpScale: 0.0075,
    roughness: 0.92,
    color: "#9ec4a7",
  });
  const feltGeometry = new THREE.ShapeGeometry(opening(false), 48);
  feltGeometry.rotateX(-Math.PI / 2);
  add(feltGeometry, feltMat, 0.035);
  const cushionMat = new THREE.MeshStandardMaterial({
    map: cloth,
    bumpMap: cloth,
    bumpScale: 0.003,
    roughness: 0.88,
    color: "#7fa48a",
    side: THREE.DoubleSide,
  });
  CUSHIONS.forEach((c) =>
    add(cushionGeometry([c.a, c.b, c.backB, c.backA]), cushionMat),
  );
  // Recessed leather-lined wells and a quiet, dark lip — no raised gold hoops.
  const leather = new THREE.MeshStandardMaterial({
    color: "#211910",
    roughness: 0.87,
    side: THREE.DoubleSide,
  });
  const wellMat = new THREE.MeshStandardMaterial({
    color: "#070908",
    roughness: 1,
    side: THREE.BackSide,
  });
  for (const [x, z] of POCKETS) {
    const lip = add(
      new THREE.RingGeometry(POCKET_RADIUS - 0.018, POCKET_RADIUS + 0.025, 48),
      leather,
      0.041,
    );
    lip.rotation.x = -Math.PI / 2;
    lip.position.x = x;
    lip.position.z = z;
    const well = add(
      new THREE.CylinderGeometry(
        POCKET_RADIUS - 0.016,
        0.21,
        0.64,
        40,
        1,
        true,
      ),
      wellMat,
      -0.285,
    );
    well.position.x = x;
    well.position.z = z;
    const bottom = add(
      new THREE.CircleGeometry(0.215, 32),
      new THREE.MeshBasicMaterial({ color: "#020403" }),
      -0.605,
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.x = x;
    bottom.position.z = z;
    // Leather stitches are inset into the lip, not emissive decorations.
    const seam = add(
      new THREE.TorusGeometry(POCKET_RADIUS + 0.013, 0.005, 4, 48),
      new THREE.MeshStandardMaterial({ color: "#665741", roughness: 1 }),
      0.045,
    );
    seam.rotation.x = Math.PI / 2;
    seam.position.x = x;
    seam.position.z = z;
  }
  const diamondMat = new THREE.MeshStandardMaterial({
    color: "#e7d9b9",
    metalness: 0.12,
    roughness: 0.35,
  });
  const diamondGeo = new THREE.BoxGeometry(0.07, 0.008, 0.07);
  for (const z of [-3.12, 3.12])
    for (const x of [-4.05, -2.7, -1.35, 1.35, 2.7, 4.05]) {
      const m = add(diamondGeo, diamondMat, 0.122);
      m.position.x = x;
      m.position.z = z;
      m.rotation.y = Math.PI / 4;
    }
  for (const x of [-5.81, 5.81])
    for (const z of [-1.35, 0, 1.35]) {
      const m = add(diamondGeo, diamondMat, 0.122);
      m.position.x = x;
      m.position.z = z;
      m.rotation.y = Math.PI / 4;
    }
  // Maker's plate, flush with the near rail.
  const plate = add(new THREE.BoxGeometry(1.1, 0.012, 0.19), brass, 0.119);
  plate.position.z = 3.13;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#34291a";
  ctx.textAlign = "center";
  ctx.font = "600 37px Arial";
  ctx.fillText("Л  У  З  А", 256, 61);
  const logo = add(
    new THREE.PlaneGeometry(0.95, 0.17),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
    0.13,
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.z = 3.13;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 30),
    new THREE.ShadowMaterial({ opacity: 0.55 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.8;
  shadow.receiveShadow = true;
  scene.add(shadow);
}
