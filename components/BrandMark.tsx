interface BrandMarkProps {
  size?: number;
  className?: string;
  accentColor?: string;
  variant?: 'auto' | 'light' | 'dark';
}

/**
 * InboxPilot brand mark — an origami paper plane lifting out of an inbox tray.
 * Uses `currentColor` for the main stroke and a small blue accent for the route.
 */
export function BrandMark({
  size = 16,
  className,
  accentColor = '#2563eb',
  variant = 'auto',
}: BrandMarkProps) {
  const strokeColor = variant === 'light' ? '#ffffff' : 'currentColor';

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
        d="M5.25 12.25H16.9L18.75 16.4V19.5H3.25V16.4L5.25 12.25Z"
        stroke={strokeColor}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M3.25 16.4H8.5C9.45 16.4 9.4 18 10.35 18H11.65C12.6 18 12.55 16.4 13.5 16.4H18.75"
        stroke={strokeColor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.35 13.2C8.05 10.55 8.85 8.45 10.75 6.95"
        stroke={accentColor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray="2.4 2.4"
      />
      <path
        d="M12.2 5.95L21 2.8L18.15 11.65L15.8 8.75L12.95 11.15L13.15 7.75L12.2 5.95Z"
        stroke={strokeColor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.15 7.75L21 2.8"
        stroke={strokeColor}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
