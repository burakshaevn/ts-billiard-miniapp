// 8 ft pool table: 2.24 × 1.12 m playing surface, standard 57.15 mm balls.
// World units are retained for the existing scene/rack; dynamics use explicit SI conversion.
export const WIDTH = 10.8;
export const HEIGHT = 5.4;
export const UNITS_PER_METRE = WIDTH / 2.24;
export const RADIUS = 0.028575 * UNITS_PER_METRE;
export const POCKET_RADIUS = 0.285;
export const POCKET_CAPTURE_RADIUS = 0.235;
export const CORNER_MOUTH = 0.39;
export const SIDE_MOUTH = 0.29;
export const POCKETS: readonly (readonly [number, number])[] = [
  [-WIDTH / 2, -HEIGHT / 2],
  [0, -HEIGHT / 2],
  [WIDTH / 2, -HEIGHT / 2],
  [-WIDTH / 2, HEIGHT / 2],
  [0, HEIGHT / 2],
  [WIDTH / 2, HEIGHT / 2],
];
export type Cushion = {
  a: [number, number];
  b: [number, number];
  backA: [number, number];
  backB: [number, number];
};
// The collision noses and rendered rail/jaw endpoints share the same geometry.
export const CUSHIONS: Cushion[] = [];
for (const z of [-1, 1])
  for (const x of [-1, 1]) {
    CUSHIONS.push({
      a: [x * SIDE_MOUTH, (z * HEIGHT) / 2],
      b: [x * (WIDTH / 2 - CORNER_MOUTH), (z * HEIGHT) / 2],
      backA: [x * 0.22, z * (HEIGHT / 2 + 0.27)],
      backB: [x * (WIDTH / 2 - 0.14), z * (HEIGHT / 2 + 0.27)],
    });
  }
for (const x of [-1, 1])
  CUSHIONS.push({
    a: [(x * WIDTH) / 2, -(HEIGHT / 2 - CORNER_MOUTH)],
    b: [(x * WIDTH) / 2, HEIGHT / 2 - CORNER_MOUTH],
    backA: [x * (WIDTH / 2 + 0.27), -(HEIGHT / 2 - 0.14)],
    backB: [x * (WIDTH / 2 + 0.27), HEIGHT / 2 - 0.14],
  });
export const CUSHION_SEGMENTS = CUSHIONS.flatMap(
  (c) =>
    [
      [c.a, c.b],
      [c.a, c.backA],
      [c.b, c.backB],
    ] as const,
);
