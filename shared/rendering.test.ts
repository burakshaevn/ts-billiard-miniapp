import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame } from "./game.ts";
import {
  sampleSnapshots,
  cueGap,
  CUE_REST_GAP,
  STROKE_MS,
} from "./rendering.ts";
test("network interpolation has constant velocity instead of ease-in acceleration", () => {
  const b = createGame().balls[0];
  const snapshots = [
    { time: 0, balls: [{ ...b, x: 0 }] },
    { time: 100, balls: [{ ...b, x: 1 }] },
  ];
  const xs = [0, 20, 40, 60, 80, 100].map(
    (t) => sampleSnapshots(snapshots, t)[0].x,
  );
  for (let i = 1; i < xs.length; i++)
    assert.ok(Math.abs(xs[i] - xs[i - 1] - 0.2) < 1e-10);
});
test("cue returns to exact contact at the impulse time", () => {
  const stroke = { startedAt: 100, angle: 0, power: 0.8 };
  assert.equal(cueGap(stroke, 100, 0.8), 0.12);
  assert.ok(cueGap(stroke, 100 + STROKE_MS * 0.6, 0.8) > 0.6);
  assert.equal(cueGap(stroke, 100 + STROKE_MS, 0.8), 0);
});
test("the cue rests at the ball and swings harder for a stronger shot", () => {
  assert.equal(cueGap(null, 0, 0.5), CUE_REST_GAP);
  const soft = { startedAt: 0, angle: 0, power: 0.2 },
    hard = { startedAt: 0, angle: 0, power: 1 };
  const top = (s: typeof soft) => cueGap(s, STROKE_MS * 0.6, s.power);
  assert.ok(top(hard) > top(soft) + 0.5, "more power means a longer backswing");
  assert.equal(cueGap(hard, STROKE_MS, 1), 0);
});
