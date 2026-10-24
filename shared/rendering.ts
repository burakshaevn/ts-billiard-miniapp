import type { Ball } from "./game";
export type VisualSnapshot = { time: number; balls: Ball[] };
/** Interpolate timestamped snapshots, never ease/chase a moving target.
 * A fixed network delay trades a little latency for constant-speed visual travel.
 * Practice uses the physics positions directly and doesn't go through this buffer.
 */
export function sampleSnapshots(
  snapshots: VisualSnapshot[],
  time: number,
): Ball[] {
  if (!snapshots.length) return [];
  if (time <= snapshots[0].time) return snapshots[0].balls;
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1],
      b = snapshots[i];
    if (time > b.time) continue;
    const t = Math.max(
      0,
      Math.min(1, (time - a.time) / Math.max(0.001, b.time - a.time)),
    );
    return b.balls.map((ball, j) => {
      const prev = a.balls[j];
      // A respotted cue teleports; don't animate it through the other balls.
      if (prev.pocketed && !ball.pocketed) return t < 1 ? prev : ball;
      return {
        ...ball,
        x: prev.x + (ball.x - prev.x) * t,
        y: prev.y + (ball.y - prev.y) * t,
        wx: prev.wx + (ball.wx - prev.wx) * t,
        wz: prev.wz + (ball.wz - prev.wz) * t,
        pocketed: t < 1 ? prev.pocketed : ball.pocketed,
      };
    });
  }
  return snapshots[snapshots.length - 1].balls;
}
export type CueStroke = {
  startedAt: number;
  angle: number;
  power: number;
  /** Released from a hand-pulled cue: the backswing already happened on screen. */
  pulled?: boolean;
};
/** Button shot: backswing, then thrust. */
export const STROKE_MS = 210;
/** Released pull: only the forward thrust is left to animate. */
export const RELEASE_MS = 95;
/** Resting distance between tip and cue ball. */
export const CUE_REST_GAP = 0.12;
/** How far back the tip travels for a given power, in table units. */
export function pullDistance(power: number) {
  return 0.18 + Math.max(0, Math.min(1, power)) * 1;
}
export function strokeDuration(stroke: CueStroke | null) {
  return stroke?.pulled ? RELEASE_MS : STROKE_MS;
}
/**
 * Tip-to-ball distance. `pull` is the live hand-drag (0..1) while the player
 * holds the cue back; it reaches 0 exactly at the impulse time.
 */
export function cueGap(
  stroke: CueStroke | null,
  now: number,
  power: number,
  pull = 0,
) {
  if (!stroke)
    return CUE_REST_GAP + (pull > 0 ? pullDistance(pull) - pullDistance(0) : 0);
  const t = Math.max(
    0,
    Math.min(1, (now - stroke.startedAt) / strokeDuration(stroke)),
  );
  if (stroke.pulled) {
    const back = CUE_REST_GAP + pullDistance(stroke.power) - pullDistance(0);
    return back * (1 - t) * (1 - t);
  }
  const pullback = pullDistance(power) - 0.07;
  if (t < 0.6)
    return CUE_REST_GAP + pullback * Math.sin(((t / 0.6) * Math.PI) / 2);
  const forward = (t - 0.6) / 0.4;
  return (CUE_REST_GAP + pullback) * (1 - forward * forward);
}
