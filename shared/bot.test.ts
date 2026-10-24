import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  shoot,
  step,
  HEIGHT,
  WIDTH,
  groupOf,
  type Game,
} from "./game.ts";
import { BOT_SKILL, legalTargets, planShot } from "./bot.ts";

function settle(g: Game) {
  for (let i = 0; i < 9000 && g.moving; i++) step(g, 1 / 120);
  assert.equal(g.moving, false, "the shot must come to rest");
}
/** Deterministic noise, so a bot test never fails on a lucky day. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
/** A table with only the listed balls on it, everything else pocketed. */
function layout(
  positions: Record<number, [number, number]>,
  groups: Game["groups"] = [null, null],
) {
  const g = createGame();
  for (const ball of g.balls) {
    const spot = positions[ball.id];
    ball.pocketed = !spot;
    if (spot) {
      ball.x = spot[0];
      ball.y = spot[1];
    }
  }
  g.groups = groups;
  return g;
}

test("a ball sitting in front of a pocket is potted", () => {
  // Cue, object ball and the far corner pocket on one diagonal line.
  const g = layout({
    0: [WIDTH / 2 - 3.2, HEIGHT / 2 - 3.2],
    3: [WIDTH / 2 - 0.5, HEIGHT / 2 - 0.5],
  });
  const plan = planShot(g, 0, 1, rng(7));
  assert.ok(plan, "a clear shot must be found");
  assert.ok(plan!.quality > 0, "it is a planned pot, not a blind poke");
  assert.equal(shoot(g, plan!.angle, plan!.power), true);
  settle(g);
  assert.ok(
    g.balls.find((b) => b.id === 3)!.pocketed,
    "the bot missed a hanging ball",
  );
  assert.equal(g.balls[0].pocketed, false, "and it must not scratch");
});

test("the bot only ever shoots at balls of its own group", () => {
  const g = layout({ 0: [-3, 0], 2: [0, 0], 11: [1.4, 0.6], 13: [2.6, -0.8] }, [
    "solids",
    "stripes",
  ]);
  assert.deepEqual(
    legalTargets(g, 0).map((b) => b.id),
    [2],
  );
  assert.deepEqual(
    legalTargets(g, 1)
      .map((b) => b.id)
      .sort((a, b) => a - b),
    [11, 13],
  );
  const plan = planShot(g, 0, 1, rng(11));
  assert.ok(plan);
  shoot(g, plan!.angle, plan!.power);
  settle(g);
  assert.equal(g.firstContact, 2, "a solids player must hit a solid first");
  assert.equal(g.foul, false);
});

test("the eight ball is the target once the group is clear", () => {
  const g = layout({ 0: [-2, 0], 8: [2, 0] }, ["solids", "stripes"]);
  assert.deepEqual(
    legalTargets(g, 0).map((b) => b.id),
    [8],
  );
  const plan = planShot(g, 0, 1, rng(3));
  assert.ok(plan);
  shoot(g, plan!.angle, plan!.power);
  settle(g);
  assert.equal(g.firstContact, 8);
});

test("nothing legal left to hit means no shot at all", () => {
  const g = layout({ 0: [0, 0] });
  assert.equal(planShot(g, 0, 1, rng(5)), null);
  const over = layout({ 0: [-2, 0], 3: [2, 0] });
  over.winner = 1;
  assert.equal(planShot(over, 0, 1, rng(5)), null, "a finished game is over");
});

test("a blocked ball is not treated as a pot", () => {
  // The 3 hangs over the corner, but the 12 sits right in the way.
  const g = layout(
    {
      0: [0, HEIGHT / 2 - 1.6],
      3: [WIDTH / 2 - 1.6, HEIGHT / 2 - 1.6],
      12: [WIDTH / 2 - 2.6, HEIGHT / 2 - 1.6],
    },
    ["solids", "stripes"],
  );
  const plan = planShot(g, 0, 1, rng(9));
  assert.ok(plan);
  assert.equal(plan!.quality, 0, "a shot through another ball is no shot");
});

test("two bots play a whole rack out, potting and finishing", () => {
  const random = rng(20261024);
  let shots = 0,
    pots = 0;
  const g = createGame();
  while (g.winner === null && shots < 200) {
    const plan = planShot(g, g.turn, BOT_SKILL, random);
    assert.ok(plan, "the bot must always find something to hit");
    const before = g.balls.filter((b) => b.pocketed).length;
    assert.equal(shoot(g, plan!.angle, plan!.power), true);
    settle(g);
    shots++;
    if (g.balls.filter((b) => b.pocketed).length > before) pots++;
  }
  assert.notEqual(g.winner, null, "the rack has to end");
  assert.ok(shots < 120, `a full game took ${shots} shots`);
  // Measured around 37% at the default skill: a beatable club player.
  assert.ok(pots / shots > 0.25, `pot rate too low: ${pots}/${shots}`);
  assert.ok(pots / shots < 0.75, `pot rate too high: ${pots}/${shots}`);
});

test("the planned angle and power are always usable numbers", () => {
  const random = rng(42);
  for (let i = 0; i < 60; i++) {
    const g = createGame();
    // Scatter the rack a little so every layout is different.
    for (const ball of g.balls) {
      ball.x += (random() - 0.5) * 2;
      ball.y += (random() - 0.5) * 2;
      ball.x = Math.max(-WIDTH / 2 + 0.3, Math.min(WIDTH / 2 - 0.3, ball.x));
      ball.y = Math.max(-HEIGHT / 2 + 0.3, Math.min(HEIGHT / 2 - 0.3, ball.y));
      if (ball.id !== 0 && ball.id !== 8) ball.pocketed = random() < 0.4;
    }
    g.groups = ["solids", "stripes"];
    const plan = planShot(g, 0, BOT_SKILL, random);
    if (!plan) {
      assert.equal(legalTargets(g, 0).length, 0);
      continue;
    }
    assert.ok(Number.isFinite(plan.angle));
    assert.ok(plan.power > 0 && plan.power <= 1);
    const target = legalTargets(g, 0);
    assert.ok(
      target.every((b) => b.id === 8 || groupOf(b.id) === "solids"),
      "solids player must never be given a stripe",
    );
  }
});
