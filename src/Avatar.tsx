import { useState } from "react";

type Props = {
  /** Used for the fallback letter and for the accessible label. */
  name: string;
  /** Telegram profile photo; absent for guests and for blocked images. */
  src?: string;
  className?: string;
  size?: number;
};

/**
 * Round player portrait: the Telegram photo when there is one, the first
 * letter of the name when there is not (or when the image fails to load —
 * Telegram CDN links expire, and a broken image icon over the table would
 * look like a bug).
 */
export default function Avatar({ name, src, className = "", size }: Props) {
  const [broken, setBroken] = useState(false);
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  const style = size
    ? ({ "--avatar-size": `${size}px` } as React.CSSProperties)
    : undefined;
  return (
    <span className={`avatar ${className}`.trim()} style={style} title={name}>
      {src && !broken ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        letter
      )}
    </span>
  );
}
