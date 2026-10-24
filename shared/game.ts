import {
  WIDTH,
  HEIGHT,
  RADIUS,
  UNITS_PER_METRE,
  POCKETS,
  POCKET_CAPTURE_RADIUS,
  CUSHION_SEGMENTS,
} from "./table";
export { WIDTH, HEIGHT, RADIUS, POCKETS, UNITS_PER_METRE } from "./table";

export const PHYSICS = {
  gravity: 9.81 * UNITS_PER_METRE,
  slidingFriction: 0.2,
  // Slightly above a fast tournament cloth (~0.01-0.02): keeps the shot
  // realistic but lets a rack settle in seconds instead of half a minute.
  rollingFriction: 0.032,
  ballRestitution: 0.96,
  cushionRestitution: 0.8,
  maxShotSpeedMps: 5.5,
  minShotSpeedMps: 0.15,
  stopSpeed: 0.018 * UNITS_PER_METRE,
} as const;
// The slider controls an initial impulse, NOT a force applied each frame.
// This response curve gives more precision for soft positional shots.
export function shotSpeedMps(power: number) {
  const p = Math.max(0, Math.min(1, power));
  return p === 0
    ? 0
    : PHYSICS.minShotSpeedMps +
        (PHYSICS.maxShotSpeedMps - PHYSICS.minShotSpeedMps) * p ** 1.65;
}
export type Ball = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number; // angular velocity about world X (rad/s)
  wz: number; // angular velocity about world Z (rad/s)
  pocketed: boolean;
};
export type Group = "solids" | "stripes";
export type Game = {
  balls: Ball[];
  turn: number;
  groups: (Group | null)[];
  moving: boolean;
  winner: number | null;
  shotPocketed: number[];
  firstContact: number | null;
  shots: number;
  message: string;
  solo: boolean;
  target: Group | "eight" | null;
  canPocketEight: boolean;
};
export const groupOf = (id: number): Group => (id < 8 ? "solids" : "stripes");
export function createGame(solo = false): Game {
  const balls: Ball[] = [
    { id: 0, x: -2.8, y: 0.35, vx: 0, vy: 0, wx: 0, wz: 0, pocketed: false },
  ];
  const order = [1, 9, 2, 10, 8, 3, 4, 11, 12, 5, 13, 6, 14, 7, 15];
  let k = 0;
  for (let row = 0; row < 5; row++)
    for (let col = 0; col <= row; col++)
      balls.push({
        id: order[k++],
        x: 2 + row * RADIUS * Math.sqrt(3) * 1.015,
        y: (col - row / 2) * RADIUS * 2.03,
        vx: 0,
        vy: 0,
        wx: 0,
        wz: 0,
        pocketed: false,
      });
  if (solo) {
    const spots = [
      [-1.3, -1.25],
      [2.55, -1.45],
      [0.9, 0.5],
      [3.75, 0.9],
      [-0.55, 1.55],
      [3.1, -0.4],
      [-3.8, -1.6],
      [1.5, -0.65],
      [-0.2, -0.5],
      [4, -1.65],
      [-2.2, 1.65],
      [2.6, 1.5],
      [0.45, -1.8],
      [4.35, 1.7],
      [-4.1, 0.9],
    ];
    balls.slice(1).forEach((b, i) => {
      b.x = spots[i][0];
      b.y = spots[i][1];
    });
  }
  return {
    balls,
    turn: 0,
    groups: [null, null],
    moving: false,
    winner: null,
    shotPocketed: [],
    firstContact: null,
    shots: 0,
    target: null,
    canPocketEight: false,
    message: solo ? "Стол твой. Начнём?" : "Первый игрок разбивает пирамиду",
    solo,
  };
}
export function shoot(g: Game, angle: number, power: number) {
  if (
    g.moving ||
    g.winner !== null ||
    !Number.isFinite(angle) ||
    !Number.isFinite(power) ||
    power <= 0
  )
    return false;
  const own = g.groups[g.turn];
  const remaining = g.balls.some(
    (b) =>
      b.id !== 0 &&
      b.id !== 8 &&
      !b.pocketed &&
      (g.solo || !own || groupOf(b.id) === own),
  );
  g.canPocketEight = !remaining && (g.solo || own !== null);
  g.target = g.solo ? null : own ? (remaining ? own : "eight") : null;
  const cue = g.balls.find((b) => b.id === 0)!;
  const speed = shotSpeedMps(power) * UNITS_PER_METRE;
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;
  // A centre-ball hit starts sliding. Cloth friction subsequently creates rolling spin.
  cue.wx = cue.wz = 0;
  g.moving = true;
  g.shotPocketed = [];
  g.firstContact = null;
  g.shots++;
  g.message = "Шары в движении…";
  return true;
}
/** Centre-ball cloth model: Coulomb sliding friction + solid-sphere inertia (2/5 mr²).
 * After contact-point slip reaches zero, switch to rolling resistance without reversing v.
 * Ball/cushion impulses retain spin, so the cloth can produce natural follow after contact.
 * This is a planar approximation, not a calibrated six-degree-of-freedom pool simulator.
 */
export function advanceOnCloth(b: Ball, dt: number) {
  const sx = b.vx + RADIUS * b.wz,
    sy = b.vy - RADIUS * b.wx;
  const slip = Math.hypot(sx, sy);
  let remaining = dt;
  if (slip > 0.00001) {
    const decel = PHYSICS.slidingFriction * PHYSICS.gravity;
    const slideTime = Math.min(dt, slip / (3.5 * decel));
    const ax = (-decel * sx) / slip,
      ay = (-decel * sy) / slip;
    b.x += b.vx * slideTime + 0.5 * ax * slideTime ** 2;
    b.y += b.vy * slideTime + 0.5 * ay * slideTime ** 2;
    b.vx += ax * slideTime;
    b.vy += ay * slideTime;
    b.wx -= ((2.5 * ay) / RADIUS) * slideTime;
    b.wz += ((2.5 * ax) / RADIUS) * slideTime;
    remaining -= slideTime;
  }
  if (remaining > 0) {
    const v = Math.hypot(b.vx, b.vy);
    if (v > 0) {
      const decel = PHYSICS.rollingFriction * PHYSICS.gravity;
      const t = Math.min(remaining, v / decel),
        next = Math.max(0, v - decel * t);
      b.x += (b.vx / v) * (v * t - 0.5 * decel * t * t);
      b.y += (b.vy / v) * (v * t - 0.5 * decel * t * t);
      b.vx *= next / v;
      b.vy *= next / v;
    }
    b.wx = b.vy / RADIUS;
    b.wz = -b.vx / RADIUS;
    if (Math.hypot(b.vx, b.vy) < PHYSICS.stopSpeed)
      b.vx = b.vy = b.wx = b.wz = 0;
  }
}
function cushionCollisions(b: Ball) {
  for (const [a, c] of CUSHION_SEGMENTS) {
    const dx = c[0] - a[0],
      dy = c[1] - a[1],
      lengthSq = dx * dx + dy * dy;
    const t = Math.max(
      0,
      Math.min(1, ((b.x - a[0]) * dx + (b.y - a[1]) * dy) / lengthSq),
    );
    const qx = a[0] + t * dx,
      qy = a[1] + t * dy;
    const d = Math.hypot(b.x - qx, b.y - qy);
    if (d >= RADIUS) continue;
    let nx = d > 1e-8 ? (b.x - qx) / d : -dy / Math.sqrt(lengthSq);
    let ny = d > 1e-8 ? (b.y - qy) / d : dx / Math.sqrt(lengthSq);
    if (d <= 1e-8 && nx * qx + ny * qy > 0) {
      nx = -nx;
      ny = -ny;
    }
    b.x = qx + nx * (RADIUS + 1e-6);
    b.y = qy + ny * (RADIUS + 1e-6);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + PHYSICS.cushionRestitution) * vn * nx;
      b.vy -= (1 + PHYSICS.cushionRestitution) * vn * ny;
    }
  }
}
export function step(g: Game, dt: number) {
  if (!g.moving || !Number.isFinite(dt) || dt <= 0) return;
  // Adaptive microsteps prevent a hard break from tunnelling through balls or pocket jaws.
  const speed = Math.max(
    ...g.balls.map((b) => (b.pocketed ? 0 : Math.hypot(b.vx, b.vy))),
  );
  const count = Math.max(
    1,
    Math.ceil((speed * Math.min(dt, 0.05)) / (RADIUS * 0.45)),
  );
  const h = Math.min(dt, 0.05) / count;
  for (let k = 0; k < count; k++) {
    for (const b of g.balls) {
      if (b.pocketed) continue;
      advanceOnCloth(b, h);
      if (
        POCKETS.some(
          ([x, y]) => Math.hypot(b.x - x, b.y - y) < POCKET_CAPTURE_RADIUS,
        )
      ) {
        b.pocketed = true;
        b.vx = b.vy = b.wx = b.wz = 0;
        g.shotPocketed.push(b.id);
        continue;
      }
      cushionCollisions(b);
    }
    for (let i = 0; i < g.balls.length; i++)
      for (let j = i + 1; j < g.balls.length; j++) {
        const a = g.balls[i],
          b = g.balls[j];
        if (a.pocketed || b.pocketed) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d >= RADIUS * 2 || d < 1e-8) continue;
        const nx = dx / d,
          ny = dy / d,
          overlap = (RADIUS * 2 - d) / 2 + 1e-6;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const impact = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (impact > 0) {
          if (g.firstContact === null && (a.id === 0 || b.id === 0))
            g.firstContact = a.id === 0 ? b.id : a.id;
          const impulse = ((1 + PHYSICS.ballRestitution) * impact) / 2;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
  }
  if (
    g.balls.every(
      (b) =>
        b.pocketed ||
        (Math.hypot(b.vx, b.vy) < PHYSICS.stopSpeed &&
          Math.hypot(b.wx, b.wz) * RADIUS < PHYSICS.stopSpeed),
    )
  ) {
    g.balls.forEach((b) => {
      b.vx = b.vy = b.wx = b.wz = 0;
    });
    g.moving = false;
    finishShot(g);
  }
}
function finishShot(g: Game) {
  const p = g.turn,
    own = g.groups[p];
  const scratch = g.shotPocketed.includes(0);
  const wrongFirst =
    g.firstContact === null ||
    (!g.solo && g.target === null && g.firstContact === 8) ||
    (g.target === "eight"
      ? g.firstContact !== 8
      : g.target !== null &&
        (g.firstContact === 8 || groupOf(g.firstContact) !== g.target));
  const foul = scratch || Boolean(wrongFirst);
  if (g.shotPocketed.includes(8)) {
    const cleared = g.canPocketEight;
    g.winner = cleared && !foul ? p : 1 - p;
    g.message =
      cleared && !foul
        ? "Восьмёрка в лузе. Отличная победа!"
        : "Восьмёрка забита раньше времени";
    return;
  }
  const first = g.shotPocketed.find((id) => id !== 0 && id !== 8);
  if (!own && first !== undefined && !foul) {
    g.groups[p] = groupOf(first);
    g.groups[1 - p] = groupOf(first) === "solids" ? "stripes" : "solids";
  }
  if (scratch) {
    const cue = g.balls.find((b) => b.id === 0)!;
    cue.pocketed = false;
    cue.x = -2.8;
    cue.y = 0;
    outer: for (let x = -3.8; x < 4.5; x += 0.4)
      for (let y = 0; y < 2.3; y += 0.4) {
        if (
          g.balls.every(
            (b) =>
              b.id === 0 ||
              b.pocketed ||
              Math.hypot(b.x - x, b.y - y) > RADIUS * 2.1,
          )
        ) {
          cue.x = x;
          cue.y = y;
          break outer;
        }
      }
  }
  const scored = g.shotPocketed.some(
    (id) => id !== 0 && id !== 8 && groupOf(id) === g.groups[p],
  );
  if (!g.solo && (foul || !scored)) g.turn = 1 - p;
  g.message = scratch
    ? "Биток в лузе. Он возвращён на стол."
    : foul
      ? "Нет правильного касания. Переход хода."
      : scored
        ? "Хороший удар! Продолжай."
        : "Следующий удар — новая возможность";
}
