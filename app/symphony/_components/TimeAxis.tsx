'use client';

import { useMemo } from 'react';
import { getAxisTicks, computeSymphonyWindow, type Zoom } from '@/lib/queries/hooks/useSymphony';

interface TimeAxisProps {
  zoom: Zoom;
  step: number;
}

/**
 * TimeAxis — mono-spaced tick labels with a "NOW" pin (when on the current
 * window) or the rightmost tick (when on a past window). Matches
 * design-review/concept-04-symphony.html lines 107-125.
 */
export function TimeAxis({ zoom, step }: TimeAxisProps) {
  const ticks = useMemo(() => getAxisTicks(zoom, step), [zoom, step]);
  const windowInfo = useMemo(() => computeSymphonyWindow(zoom, step), [zoom, step]);

  // For "today" zoom, the NOW pin floats at the actual wall-clock position.
  // For other zooms, NOW sits at the rightmost tick.
  const nowLabel = useMemo(() => {
    if (windowInfo.isCurrent) {
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');
      return `NOW · ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${hh}:${mm}`;
    }
    return undefined;
  }, [windowInfo.isCurrent]);

  return (
    <div
      className="relative flex items-end justify-between border-b border-[var(--m03-line)] px-6 pb-4 pt-2"
      aria-label="Time axis"
    >
      {ticks.map((tick, i) => (
        <span
          key={`${tick.label}-${i}`}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--m03-fg-3)]"
        >
          {tick.label}
        </span>
      ))}

      {nowLabel && (
        <span
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-[3px] bg-[var(--m03-fg)] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--m03-bg)]"
        >
          {nowLabel}
        </span>
      )}
    </div>
  );
}
