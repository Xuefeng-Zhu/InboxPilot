/**
 * InboxPilot brand logo mark.
 *
 * Renders the stylized "ip" composition: an indigo circle with a vertical
 * stem (the "p") and a purple dot (the "i" tittle).
 *
 * Accepts a `size` prop to scale across contexts — sidebar, login cards,
 * landing page headers, etc.
 */
export function Logo({
  size = 'md',
  className = '',
}: {
  /** sm = 24px, md = 32px, lg = 40px, xl = 48px */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const dims = {
    sm: { box: 'h-6 w-6', ring: 'h-4 w-4 border-2', stem: 'h-5 w-0.5', dot: 'h-1.5 w-1.5', ringPos: 'left-0.5 top-0.5', stemPos: 'left-0.5 top-0.5', dotPos: 'right-0 top-0' },
    md: { box: 'h-8 w-8', ring: 'h-6 w-6 border-[3px]', stem: 'h-7 w-1', dot: 'h-2.5 w-2.5', ringPos: 'left-1 top-1', stemPos: 'left-1 top-1', dotPos: 'right-0.5 top-0' },
    lg: { box: 'h-10 w-10', ring: 'h-7 w-7 border-[3px]', stem: 'h-8 w-1', dot: 'h-3 w-3', ringPos: 'left-1 top-1.5', stemPos: 'left-1 top-1.5', dotPos: 'right-0.5 top-0' },
    xl: { box: 'h-12 w-12', ring: 'h-8 w-8 border-4', stem: 'h-10 w-1.5', dot: 'h-3 w-3', ringPos: 'left-2 top-2', stemPos: 'left-2 top-2', dotPos: 'right-1 top-0' },
  };

  const d = dims[size];

  return (
    <div
      className={`relative ${d.box} flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      {/* The "p" — circle */}
      <div
        className={`absolute ${d.ringPos} ${d.ring} rounded-full border-primary`}
      />
      {/* The "p" — vertical stem */}
      <div
        className={`absolute ${d.stemPos} ${d.stem} rounded-full bg-primary`}
      />
      {/* The "i" — dot / tittle */}
      <div
        className={`absolute ${d.dotPos} ${d.dot} rounded-full bg-primary-300`}
      />
    </div>
  );
}
