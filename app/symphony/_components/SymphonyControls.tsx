'use client';

import { cn } from '@/components/ui/cn';
import { type Zoom, computeSymphonyWindow } from '@/lib/queries/hooks/useSymphony';

interface SymphonyControlsProps {
  zoom: Zoom;
  step: number;
  onZoomChange: (zoom: Zoom) => void;
  onStep: (delta: number) => void;
  onReset: () => void;
  conversationCount: number;
}

const ZOOM_OPTIONS: { id: Zoom; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
];

/**
 * SymphonyControls — zoom pills (Today / This week / Month / All), the
 * human-readable window label, and the prev/dot/next nav arrows. Matches
 * design-review/concept-04-symphony.html lines 74-105.
 */
export function SymphonyControls({
  zoom,
  step,
  onZoomChange,
  onStep,
  onReset,
  conversationCount,
}: SymphonyControlsProps) {
  const windowInfo = computeSymphonyWindow(zoom, step);

  return (
    <div className="flex items-center gap-3.5 border-b border-[var(--m03-line)] px-6 py-2.5">
      {/* Zoom pill group */}
      <div
        className="flex rounded-md border border-[var(--m03-line)] p-0.5"
        role="tablist"
        aria-label="Zoom window"
      >
        {ZOOM_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            role="tab"
            aria-selected={zoom === opt.id}
            onClick={() => onZoomChange(opt.id)}
            className={cn(
              'rounded-[4px] px-3 py-1 text-[11px] font-medium transition-colors',
              zoom === opt.id
                ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)]'
                : 'text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* View label + range */}
      <div className="ml-2 flex items-baseline gap-1">
        <span className="font-mono text-[11px] text-[var(--m03-fg-2)]">
          {zoom === 'today'
            ? 'Today'
            : zoom === 'week'
              ? 'A week in your inbox'
              : zoom === 'month'
                ? 'A month in your inbox'
                : 'All time'}
        </span>
        <span className="font-mono text-[11px] text-[var(--m03-fg)]">
          {zoom === 'all' ? '' : `· ${windowInfo.label}`} · {conversationCount} conversation{conversationCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Nav arrows */}
      <div className="ml-auto flex gap-1" role="group" aria-label="Window navigation">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={zoom === 'all'}
          className="flex h-7 w-7 items-center justify-center rounded border border-[var(--m03-line)] bg-[var(--m03-bg)] text-[13px] text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)] disabled:opacity-40"
          aria-label="Previous window"
        >
          ←
        </button>
        <button
          type="button"
          onClick={onReset}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded border text-[13px] transition-colors',
            step === 0
              ? 'border-[var(--m03-fg)] bg-[var(--m03-fg)] text-[var(--m03-bg)]'
              : 'border-[var(--m03-line)] bg-[var(--m03-bg)] text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)]',
          )}
          aria-label="Jump to current window"
          aria-pressed={step === 0}
        >
          •
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={zoom === 'all'}
          className="flex h-7 w-7 items-center justify-center rounded border border-[var(--m03-line)] bg-[var(--m03-bg)] text-[13px] text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)] disabled:opacity-40"
          aria-label="Next window"
        >
          →
        </button>
      </div>
    </div>
  );
}
