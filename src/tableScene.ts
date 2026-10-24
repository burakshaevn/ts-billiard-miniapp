import * as THREE from "three";
import {
  CUSHIONS,
  WIDTH,
  HEIGHT,
  POCKETS,
  POCKET_RADIUS,
} from "../shared/table";

/**
 * Flat, glare-free table in the style of the mobile pool apps: one bright
 * blue cloth, graphite rails, silver pocket collars, white sights. No wood,
 * no brass, no mirror highlights — a shiny rail threw a white streak across
 * the cloth and made the balls hard to read on a phone.
 */
export const RAIL_TOP = 0.26;

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
// The cloth outline: the playing rectangle with the six pocket mouths bitten
// out of it. No black discs painted on felt — the holes are real.
function opening() {
  const p = POCKET_RADIUS,
    w = WIDTH / 2,
    h = HEIGHT / 2,
    s = new THREE.Shape();
  s.moveTo(-w + p, -h);
  s.lineTo(-p, -h);
  s.absarc(0, -h, p, Math.PI, 0, true);
  s.lineTo(w - p, -h);
  s.absarc(w, -h, p, Math.PI, Math.PI / 2, true);
  s.lineTo(w, h - p);
  s.absarc(w, h, p, -Math.PI / 2, -Math.PI, true);
  s.lineTo(p, h);
  s.absarc(0, h, p, 0, -Math.PI, true);
  s.lineTo(-w + p, h);
  s.absarc(-w, h, p, 0, -Math.PI / 2, true);
  s.lineTo(-w, -h + p);
  s.absarc(-w, -h, p, Math.PI / 2, 0, true);
  s.closePath();
  return s;
}
/**
 * The hole the rails are cut with: the playing rectangle grown by `pad` (so
 * the cushions stay in the open and are actually visible) merged with a
 * circle of radius `r` around every pocket. One closed path, no overlapping
 * holes — the triangulator cannot union shapes itself.
 */
function outline(pad: number, r: number) {
  const x = WIDTH / 2,
    z = HEIGHT / 2,
    w = x + pad,
    h = z + pad,
    // Where a pocket circle crosses the grown edge, and at what angle.
    c = Math.sqrt(Math.max(0.0001, r * r - pad * pad)),
    a = Math.atan2(pad, c),
    PI = Math.PI,
    s = new THREE.Shape();
  s.moveTo(-x + c, -h);
  s.lineTo(-c, -h);
  s.absarc(0, -z, r, a - PI, -a, false);
  s.lineTo(x - c, -h);
  s.absarc(x, -z, r, a - PI, PI / 2 - a, false);
  s.lineTo(w, z - c);
  s.absarc(x, z, r, a - PI / 2, PI - a, false);
  s.lineTo(c, h);
  s.absarc(0, z, r, a, PI - a, false);
  s.lineTo(-x + c, h);
  s.absarc(-x, z, r, a, PI + a, false);
  s.lineTo(-w, -z + c);
  s.absarc(-x, -z, r, PI - a, 2 * PI - a, false);
  s.closePath();
  return s;
}
function extrude(s: THREE.Shape, height: number) {
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth: height,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 28,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
/**
 * One painted cloth: a soft blue pool of light in the middle, darker towards
 * the rails, a hint of weave and the head string. Painted instead of lit, so
 * the table looks the same on every phone and never glares.
 */
function clothTexture() {
  const w = 1024,
    h = 512,
    canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, 640);
  glow.addColorStop(0, "#54c2e9");
  glow.addColorStop(0.4, "#3e9fd1");
  glow.addColorStop(0.75, "#2d7cae");
  glow.addColorStop(1, "#21587f");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // Head string, exactly where the cue ball is spotted after a scratch.
  ctx.fillStyle = "#ffffff14";
  ctx.fillRect(Math.round(w * 0.25) - 1, 0, 2, h);
  const image = ctx.getImageData(0, 0, w, h);
  let seed = 7919;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const n = ((seed % 1000) / 1000 - 0.5) * 9;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  // ShapeGeometry uses raw table coordinates as UVs: remap them onto 0..1.
  t.repeat.set(1 / WIDTH, 1 / HEIGHT);
  t.offset.set(0.5, 0.5);
  t.anisotropy = 8;
  return t;
}
function cushionGeometry(points: [number, number][]) {
  const positions: number[] = [];
  // The nose sits at ball height and the back edge tucks just under the rail
  // top, so the cushion reads as one clean sloped band from above instead of
  // fighting the rail for the same pixels along the seam.
  points.forEach(([x, z], i) =>
    positions.push(x, i < 2 ? 0.148 : RAIL_TOP - 0.01, z),
  );
  points.forEach(([x, z]) => positions.push(x, 0.03, z));
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
    // Only the balls cast: a rail shadow would draw a dark stripe along the
    // cloth that the flat look does not have.
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // Matte everywhere. Lambert has no specular term at all, which is the
  // whole point: nothing on this table can catch a highlight.
  const flat = (color: string) => new THREE.MeshLambertMaterial({ color });
  // Rails stop short of the cushions, so the band of cushion shows.
  const CUSHION_BACK = 0.27,
    CAP = 0.49;
  const hole = outline(CUSHION_BACK, CAP - 0.02);
  // Thin darker lip under the rails, so the table has an outline on black.
  // Its opening is cut wider than the rail's: two walls in exactly the same
  // place flickered against each other around every pocket.
  const base = roundedRectangle(12.2, 6.8, 0.42);
  base.holes.push(outline(CUSHION_BACK + 0.07, CAP + 0.05));
  add(extrude(base, 0.52), flat("#15171b"), -0.3);
  const rails = roundedRectangle(12, 6.6, 0.4);
  rails.holes.push(hole);
  add(extrude(rails, 0.36), flat("#343a40"), -0.1);
  const felt = new THREE.MeshLambertMaterial({ map: clothTexture() });
  const feltGeometry = new THREE.ShapeGeometry(opening(), 56);
  feltGeometry.rotateX(-Math.PI / 2);
  add(feltGeometry, felt, 0.035);
  // Lighter than the cloth it meets: that contrast is what makes the band of
  // cushion visible all the way round the table.
  const cushionMat = new THREE.MeshLambertMaterial({
    color: "#3a89b8",
    side: THREE.DoubleSide,
  });
  CUSHIONS.forEach((c) =>
    add(cushionGeometry([c.a, c.b, c.backB, c.backA]), cushionMat),
  );
  const collar = flat("#aeb4ba");
  const wellMat = new THREE.MeshBasicMaterial({
    color: "#0c0e10",
    side: THREE.BackSide,
  });
  for (const [x, z] of POCKETS) {
    // Silver collar, black mouth — the two shapes a pool player looks for.
    // Both lie flat on the cloth: anything standing up here would slice
    // through a ball rolling past the pocket.
    const cap = add(
      new THREE.RingGeometry(POCKET_RADIUS + 0.005, CAP, 48),
      collar,
      0.038,
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.x = x;
    cap.position.z = z;
    // One open funnel, not a disc over a tube: two lids at the same height
    // fought for the pixels and the pocket grew a ring of teeth.
    const well = add(
      new THREE.CylinderGeometry(POCKET_RADIUS + 0.01, 0.2, 0.62, 44, 1, true),
      wellMat,
      -0.2705,
    );
    well.position.x = x;
    well.position.z = z;
    const bottom = add(
      new THREE.CircleGeometry(0.205, 28),
      new THREE.MeshBasicMaterial({ color: "#070809" }),
      -0.58,
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.x = x;
    bottom.position.z = z;
  }
  const sight = new THREE.MeshBasicMaterial({ color: "#e9edf0" });
  const sightGeometry = new THREE.CircleGeometry(0.055, 20);
  const dot = (x: number, z: number) => {
    const m = add(sightGeometry, sight, RAIL_TOP + 0.004);
    m.rotation.x = -Math.PI / 2;
    m.position.x = x;
    m.position.z = z;
  };
  for (const z of [-3.14, 3.14])
    for (const x of [-4.05, -2.7, -1.35, 1.35, 2.7, 4.05]) dot(x, z);
  for (const x of [-5.84, 5.84]) for (const z of [-1.35, 0, 1.35]) dot(x, z);
}
