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
export type CueStroke = { startedAt: number; angle: number; power: number };
export const STROKE_MS = 210;
export function cueGap(stroke: CueStroke | null, now: number, power: number) {
  if (!stroke) return 0.12;
  const t = Math.max(0, Math.min(1, (now - stroke.startedAt) / STROKE_MS));
  const pullback = 0.18 + power * 0.65;
  if (t < 0.6) return 0.12 + pullback * Math.sin(((t / 0.6) * Math.PI) / 2);
  const forward = (t - 0.6) / 0.4;
  return (0.12 + pullback) * (1 - forward * forward);
}
