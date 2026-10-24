import { BALL_COLORS } from "./balls";

export default function BallIcon({
  n = 8,
  small = false,
}: {
  n?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`ball-icon ${small ? "small" : ""} ${n > 8 ? "striped" : ""}`}
      style={{ "--ball": BALL_COLORS[n] } as React.CSSProperties}
    >
      <span>{n}</span>
    </span>
  );
}
