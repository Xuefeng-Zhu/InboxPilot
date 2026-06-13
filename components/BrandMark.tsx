interface BrandMarkProps {
  size?: number;
  className?: string;
  variant?: 'auto' | 'light' | 'dark';
}

/**
 * InboxPilot brand mark — origami paper plane gliding along a trajectory arc.
 * Single-color; relies on `currentColor` for the fill/stroke and on a `currentColor`
 * accent for the trajectory. Pass `variant="light"` on dark surfaces, `"dark"` on light.
 * Defaults to `auto` (uses whatever color the parent sets).
 */
export function BrandMark({ size = 16, className, variant = 'auto' }: BrandMarkProps) {
  // On dark backgrounds, the inner fold line should be a dark stroke so it shows
  // through the white plane. On light backgrounds it's white.
  const foldStroke = variant === 'light' ? '#0a0a0a' : '#ffffff';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 12L22 4L13 22L11 14L2 12Z"
        fill="currentColor"
      />
      <path d="M11 14L22 4" stroke={foldStroke} strokeWidth="1.25" />
      <path
        d="M2 4C7 4 16 6 22 4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}
