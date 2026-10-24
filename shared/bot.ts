/**
 * The bot opponent: picks a shot, nothing else.
 *
 * It is deliberately a pure function of the game state — the same `shoot()`
 * the humans use takes its angle and power, so a bot cannot do anything a
 * player could not. The server runs it; the tests run it thousands of times
 * to measure how often it pots.
 */
import {
  HEIGHT,
  POCKETS,
  RADIUS,
  WIDTH,
  groupOf,
  type Ball,
  type Game,
} from "./game";

export type BotShot = {
  angle: number;
  power: number;
  /** 0 = blind poke, 1 = straight in from close range. */
  quality: number;
};

/** How well the bot plays: 0 = hopeless, 1 = never misses the line it picked. */
export const BOT_SKILL = 0.62;

/** Ordinary names: the opponent is openly a bot, it does not pretend. */
export const BOT_NAMES = [
  "Клава",
  "Гоша",
  "Марта",
  "Сева",
  "Нюра",
  "Тихон",
  "Зина",
  "Рудик",
];

const DIAMETER = RADIUS * 2;
const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

/**
 * Is the straight path from (ax,ay) to (bx,by) free of other balls?
 * `clearance` is how close a ball may sit to the line before it blocks it.
 */
function pathClear(
  balls: Ball[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ignore: number[],
  clearance = DIAMETER * 0.95,
) {
  const dx = bx - ax,
    dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return true;
  for (const ball of balls) {
    if (ball.pocketed || ignore.includes(ball.id)) continue;
    // Distance from the ball centre to the segment.
    const t = Math.max(
      0,
      Math.min(
        1,
        ((ball.x - ax) * dx + (ball.y - ay) * dy) / (length * length),
      ),
    );
    const px = ax + dx * t,
      py = ay + dy * t;
    if (dist(px, py, ball.x, ball.y) < clearance) return false;
  }
  return true;
}

/**
 * How much a shot is worth keeping once the cue ball's own path is taken
 * into account: 1 = the cue ball runs nowhere near a pocket, 0.25 = it is
 * heading straight for one.
 */
function scratchRisk(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  ghostX: number,
  ghostY: number,
  cut: number,
) {
  // A near-straight hit stops the cue ball instead of sending it away.
  if (cut > 0.94) return 1;
  // Tangent: the part of the cue ball's travel across the line of centres.
  let tx = cx - ux * cut,
    ty = cy - uy * cut;
  const length = Math.hypot(tx, ty);
  if (length < 1e-6) return 1;
  tx /= length;
  ty /= length;
  let risk = 1;
  for (const [px, py] of POCKETS) {
    const dx = px - ghostX,
      dy = py - ghostY;
    const along = dx * tx + dy * ty;
    if (along <= 0 || along > 4.2) continue;
    const across = Math.abs(dx * ty - dy * tx);
    if (across < 0.75) risk = Math.min(risk, 0.25 + across * 0.6);
  }
  return risk;
}

/** The balls this player is allowed to hit first, by the rules of the game. */
export function legalTargets(g: Game, index: number): Ball[] {
  const own = g.groups[index];
  const colours = g.balls.filter(
    (b) =>
      b.id !== 0 &&
      b.id !== 8 &&
      !b.pocketed &&
      (!own || groupOf(b.id) === own),
  );
  if (colours.length) return colours;
  const eight = g.balls.find((b) => b.id === 8 && !b.pocketed);
  return eight ? [eight] : [];
}

/**
 * Plan a shot. Returns null only when there is nothing legal left to hit.
 *
 * Every (ball, pocket) pair is scored: the cue ball has to reach the ghost
 * ball position unobstructed, the object ball has to reach the pocket
 * unobstructed, and a straight short shot beats a long thin cut. The chosen
 * line is then blurred by the skill setting, which is what makes the bot
 * miss like a person instead of either potting everything or flailing.
 */
export function planShot(
  g: Game,
  index: number,
  skill: number = BOT_SKILL,
  random: () => number = Math.random,
): BotShot | null {
  const cue = g.balls.find((b) => b.id === 0);
  if (!cue || cue.pocketed || g.winner !== null) return null;
  const targets = legalTargets(g, index);
  if (!targets.length) return null;

  let best: BotShot | null = null;
  for (const ball of targets) {
    for (const [px, py] of POCKETS) {
      const toPocket = Math.hypot(px - ball.x, py - ball.y);
      if (toPocket < 1e-6) continue;
      const ux = (px - ball.x) / toPocket,
        uy = (py - ball.y) / toPocket;
      // Where the cue ball must be at the moment of contact.
      const ghostX = ball.x - ux * DIAMETER,
        ghostY = ball.y - uy * DIAMETER;
      if (
        Math.abs(ghostX) > WIDTH / 2 - RADIUS * 0.5 ||
        Math.abs(ghostY) > HEIGHT / 2 - RADIUS * 0.5
      )
        continue;
      const toGhost = dist(cue.x, cue.y, ghostX, ghostY);
      if (toGhost < RADIUS * 0.6) continue;
      const cx = (ghostX - cue.x) / toGhost,
        cy = (ghostY - cue.y) / toGhost;
      // Cut angle: 1 = dead straight, 0 = impossible 90° cut.
      const cut = cx * ux + cy * uy;
      if (cut < 0.28) continue;
      if (!pathClear(g.balls, cue.x, cue.y, ghostX, ghostY, [0, ball.id]))
        continue;
      if (!pathClear(g.balls, ball.x, ball.y, px, py, [ball.id], RADIUS * 1.75))
        continue;
      // Straight, short and into a pocket the object ball is already facing.
      let quality =
        cut *
        cut *
        (1 / (1 + toGhost * 0.09)) *
        (1 / (1 + toPocket * 0.12)) *
        (ball.id === 8 ? 1.15 : 1);
      // After a cut the cue ball leaves along the tangent. If that line runs
      // into a pocket, this pretty shot is a scratch — look elsewhere first.
      quality *= scratchRisk(cx, cy, ux, uy, ghostX, ghostY, cut);
      if (!best || quality > best.quality) {
        const angle = Math.atan2(ghostY - cue.y, ghostX - cue.x);
        // Enough speed to carry the object ball home, more for a thin cut.
        const power = Math.max(
          0.3,
          Math.min(
            0.92,
            (0.3 + toGhost * 0.022 + toPocket * 0.05) / Math.max(0.5, cut),
          ),
        );
        best = { angle, power, quality };
      }
    }
  }

  if (!best) {
    // Nothing is on: roll into a legal ball the cue ball can actually reach,
    // which keeps the hit legal instead of handing over a free ball.
    let nearest = targets[0],
      shortest = Infinity,
      reachable = false;
    for (const ball of targets) {
      const d = dist(cue.x, cue.y, ball.x, ball.y);
      const clear = pathClear(g.balls, cue.x, cue.y, ball.x, ball.y, [
        0,
        ball.id,
      ]);
      // A ball in the open always beats a closer one hiding behind a cluster.
      if ((clear && !reachable) || (clear === reachable && d < shortest)) {
        shortest = d;
        nearest = ball;
        reachable = clear;
      }
    }
    best = {
      angle: Math.atan2(nearest.y - cue.y, nearest.x - cue.x),
      power: Math.max(0.3, Math.min(0.6, 0.28 + shortest * 0.025)),
      quality: 0,
    };
  }

  // Human-sized error: a weaker bot wanders off the line it picked.
  const error = (1 - Math.max(0, Math.min(1, skill))) * 0.075;
  const wobble = (random() + random() - 1) * error;
  return {
    angle: best.angle + wobble,
    power: Math.max(
      0.18,
      Math.min(1, best.power * (1 + (random() - 0.5) * 0.14)),
    ),
    quality: best.quality,
  };
}
