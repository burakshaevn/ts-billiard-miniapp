/**
 * Ягодка — the currency mark, drawn to match the cherries of the logo.
 *
 * It is a drawing, not the 🍒 emoji: emoji look different on every platform
 * and turn into a hollow box wherever the colour font is missing, while the
 * balance sits next to the lime text of the interface and has to match it.
 */
export default function Berry({
  size = 13,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Two stalks meeting at the leaf. */}
      <path
        d="M5.4 10.1C5.1 7.6 6.6 4.9 9.5 3.2M10.9 10.4C10.9 8.4 10.4 5.4 9.5 3.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M9.6 3.3c1-1.2 2.3-1.6 3.9-1.3-.2 1.6-1.1 2.6-2.7 2.9"
        fill="currentColor"
        opacity="0.75"
      />
      <circle cx="4.6" cy="11.9" r="3" fill="currentColor" />
      <circle cx="11.3" cy="12.2" r="2.7" fill="currentColor" />
    </svg>
  );
}
