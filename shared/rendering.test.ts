import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame } from "./game.ts";
import {
  sampleSnapshots,
  cueGap,
  CUE_REST_GAP,
  RELEASE_MS,
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
test("a hand-pulled cue starts back where the player left it and reaches the ball on release", () => {
  const holding = cueGap(null, 0, 0.5, 0.9);
  assert.ok(
    holding > CUE_REST_GAP + 0.5,
    "holding the cue keeps it pulled back",
  );
  assert.equal(cueGap(null, 0, 0.5, 0), CUE_REST_GAP);
  const stroke = { startedAt: 50, angle: 0, power: 0.9, pulled: true };
  assert.ok(
    Math.abs(cueGap(stroke, 50, 0.9) - holding) < 0.02,
    "no jump on release",
  );
  assert.ok(cueGap(stroke, 50 + RELEASE_MS / 2, 0.9) < holding);
  assert.equal(cueGap(stroke, 50 + RELEASE_MS, 0.9), 0);
  assert.ok(RELEASE_MS < STROKE_MS);
});
