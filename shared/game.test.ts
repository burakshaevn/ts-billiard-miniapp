import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  shoot,
  step,
  WIDTH,
  HEIGHT,
  RADIUS,
  type Game,
} from "./game.ts";
function settle(g: Game) {
  for (let i = 0; i < 7200 && g.moving; i++) step(g, 1 / 120);
  assert.equal(g.moving, false, "a shot should settle within 60s");
}
test("rack has 16 unique, non-overlapping balls", () => {
  const g = createGame();
  assert.equal(new Set(g.balls.map((b) => b.id)).size, 16);
  for (let i = 0; i < 16; i++)
    for (let j = i + 1; j < 16; j++)
      assert.ok(
        Math.hypot(g.balls[i].x - g.balls[j].x, g.balls[i].y - g.balls[j].y) >=
          RADIUS * 2,
      );
});
test("rejects invalid input, duplicate shots and shots after game over", () => {
  const g = createGame();
  assert.equal(shoot(g, NaN, 0.5), false);
  assert.equal(shoot(g, 0, Infinity), false);
  assert.equal(shoot(g, 0, 0.7), true);
  assert.equal(shoot(g, 1, 0.5), false);
  settle(g);
  g.winner = 0;
  assert.equal(shoot(g, 0, 0.5), false);
});
test("break transfers momentum, preserves finite positions and comes to rest", () => {
  const g = createGame();
  const initial = g.balls.map((b) => [b.x, b.y]);
  shoot(g, 0, 1);
  settle(g);
  assert.ok(
    g.balls.some(
      (b, i) =>
        i > 0 && Math.hypot(b.x - initial[i][0], b.y - initial[i][1]) > 0.2,
    ),
  );
  for (const b of g.balls) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    if (!b.pocketed) {
      assert.ok(Math.abs(b.x) <= WIDTH / 2);
      assert.ok(Math.abs(b.y) <= HEIGHT / 2);
    }
    assert.equal(b.vx, 0);
    assert.equal(b.vy, 0);
  }
});
test("cushions reflect velocity", () => {
  const g = createGame();
  g.balls[0].x = WIDTH / 2 - RADIUS - 0.01;
  g.balls[0].y = 0.9;
  shoot(g, 0, 0.4);
  step(g, 1 / 60);
  assert.ok(g.balls[0].vx < 0);
});
test("scratched cue ball is respotted without overlap and turn changes", () => {
  const g = createGame();
  g.balls[0].x = 0;
  g.balls[0].y = -2.2;
  shoot(g, -Math.PI / 2, 0.3);
  settle(g);
  assert.equal(g.balls[0].pocketed, false);
  assert.ok(g.shotPocketed.includes(0));
  assert.equal(g.turn, 1);
  for (const b of g.balls.slice(1))
    if (!b.pocketed)
      assert.ok(
        Math.hypot(b.x - g.balls[0].x, b.y - g.balls[0].y) > RADIUS * 2,
      );
});
test("first legal pot assigns groups and retains the turn", () => {
  const g = createGame();
  shoot(g, 0, 0.1);
  g.balls.forEach((b) => {
    b.vx = b.vy = 0;
  });
  g.balls.find((b) => b.id === 1)!.pocketed = true;
  g.shotPocketed = [1];
  g.firstContact = 1;
  step(g, 1 / 120);
  assert.deepEqual(g.groups, ["solids", "stripes"]);
  assert.equal(g.turn, 0);
});
test("potting the last group ball is not incorrectly treated as a foul", () => {
  const g = createGame();
  g.groups = ["solids", "stripes"];
  g.balls
    .filter((b) => b.id > 1 && b.id < 8)
    .forEach((b) => (b.pocketed = true));
  shoot(g, 0, 0.1);
  g.balls.forEach((b) => {
    b.vx = b.vy = 0;
  });
  g.balls.find((b) => b.id === 1)!.pocketed = true;
  g.shotPocketed = [1];
  g.firstContact = 1;
  step(g, 1 / 120);
  assert.equal(g.turn, 0);
  assert.match(g.message, /Хороший удар/);
});
test("early black loses, legal final black wins", () => {
  for (const legal of [false, true]) {
    const g = createGame();
    g.groups = ["solids", "stripes"];
    if (legal)
      g.balls
        .filter((b) => b.id > 0 && b.id < 8)
        .forEach((b) => (b.pocketed = true));
    shoot(g, 0, 0.1);
    g.balls.forEach((b) => {
      b.vx = b.vy = 0;
    });
    g.balls.find((b) => b.id === 8)!.pocketed = true;
    g.shotPocketed = [8];
    g.firstContact = 8;
    step(g, 1 / 120);
    assert.equal(g.winner, legal ? 0 : 1);
  }
});
test("practice never hands control to a nonexistent second player", () => {
  const g = createGame(true);
  shoot(g, Math.PI, 0.1);
  settle(g);
  assert.equal(g.turn, 0);
});

test("shot power sets velocity immediately, without accelerating over subsequent frames", async () => {
  const { shotSpeedMps, UNITS_PER_METRE, advanceOnCloth } =
    await import("./game.ts");
  for (const power of [0.05, 0.25, 0.65, 1]) {
    const g = createGame();
    shoot(g, 0, power);
    const b = g.balls[0];
    assert.ok(Math.abs(b.vx - shotSpeedMps(power) * UNITS_PER_METRE) < 1e-10);
    assert.equal(b.wx, 0);
    assert.equal(b.wz, 0);
    let previous = b.vx;
    for (let i = 0; i < 3000; i++) {
      advanceOnCloth(b, 1 / 240);
      assert.ok(
        b.vx <= previous + 1e-10,
        "a freely moving centre-hit ball must not gain speed",
      );
      assert.ok(b.vx >= 0, "friction must not reverse the ball");
      previous = b.vx;
    }
  }
});
test("centre hit slides into rolling at 5/7 of its initial speed", async () => {
  const { advanceOnCloth, PHYSICS } = await import("./game.ts");
  const b = createGame().balls[0];
  b.vx = 7;
  const transitionTime =
    b.vx / (3.5 * PHYSICS.slidingFriction * PHYSICS.gravity);
  advanceOnCloth(b, transitionTime);
  assert.ok(Math.abs(b.vx - 5) < 1e-9);
  assert.ok(
    Math.abs(b.vx + RADIUS * b.wz) < 1e-9,
    "contact-point slip is zero when rolling",
  );
  const old = b.vx;
  advanceOnCloth(b, 0.1);
  assert.ok(
    Math.abs(b.vx - (old - PHYSICS.rollingFriction * PHYSICS.gravity * 0.1)) <
      1e-9,
  );
});
test("cloth friction never adds translational plus rotational energy", async () => {
  const { advanceOnCloth } = await import("./game.ts");
  const b = createGame().balls[0];
  b.vx = 5;
  b.vy = 2;
  b.wx = -8;
  b.wz = 11;
  const energy = () =>
    0.5 * (b.vx * b.vx + b.vy * b.vy) +
    0.2 * RADIUS * RADIUS * (b.wx * b.wx + b.wz * b.wz);
  let previous = energy();
  for (let i = 0; i < 2000; i++) {
    advanceOnCloth(b, 1 / 120);
    assert.ok(energy() <= previous + 1e-9);
    previous = energy();
  }
  assert.equal(energy(), 0);
});
test("free rolling distance is independent of the render or integration frame rate", async () => {
  const { advanceOnCloth } = await import("./game.ts");
  const a = createGame().balls[0],
    b = { ...a };
  a.vx = b.vx = 5;
  a.wz = b.wz = -5 / RADIUS;
  for (let i = 0; i < 120; i++) advanceOnCloth(a, 1 / 120);
  for (let i = 0; i < 240; i++) advanceOnCloth(b, 1 / 240);
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
  assert.ok(Math.abs(a.vx - b.vx) < 1e-9);
});
test("a maximum-power shot cannot tunnel through an object ball", () => {
  const g = createGame();
  g.balls.forEach((b) => {
    b.pocketed = b.id > 1;
  });
  const cue = g.balls[0],
    object = g.balls.find((b) => b.id === 1)!;
  cue.x = -1;
  cue.y = 0;
  object.x = 0;
  object.y = 0;
  shoot(g, 0, 1);
  for (let i = 0; i < 12; i++) step(g, 1 / 120);
  assert.equal(g.firstContact, 1);
  assert.ok(object.x > 0.2);
});
