'use client';

import { cn } from '@/components/ui/cn';
import { type BarTone } from '@/lib/queries/hooks/useSymphony';

export interface MiniMapBar {
  conversationId: string;
  leftPct: number;
  tone: BarTone;
  isActive: boolean;
}

interface MiniMapProps {
  bars: MiniMapBar[];
  windowStart: Date;
  windowEnd: Date;
  totalInWindow: number;
  autoRepliedCount: number;
  awaitingYouCount: number;
  onBarClick: (conversationId: string) => void;
}

const BAR_TONE_CLASSES: Record<BarTone, string> = {
  sent: 'border-[var(--m03-green)] bg-[rgba(0,170,85,0.10)]',
  drafting: 'border-[var(--m03-orange)] bg-[rgba(255,136,0,0.12)]',
  escalated: 'border-[var(--m03-red)] bg-[rgba(238,0,0,0.12)]',
  idle: 'border-[var(--m03-line)] bg-[var(--m03-bg)]',
};

const BAR_WIDTH_PCT = 1.6;

/**
 * MiniMap — one bar per real conversation in the window, positioned by
 * `last_message_at`. Click a bar to jump the river to that conversation.
 * Mirrors design-review/concept-04-symphony.html lines 265-291.
 */
export function MiniMap({
  bars,
  windowStart,
  windowEnd,
  totalInWindow,
  autoRepliedCount,
  awaitingYouCount,
  onBarClick,
}: MiniMapProps) {
  const startLabel = windowStart.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const endLabel = windowEnd.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <div
      className="border-t border-[var(--m03-line)] bg-[var(--m03-bg)] px-6 pt-3.5 pb-4.5"
      data-testid="minimap"
    >
      <div className="relative h-7 overflow-hidden rounded-full bg-[var(--m03-line-2)]">
        {bars.map((bar) => (
          <button
            key={bar.conversationId}
            type="button"
            onClick={() => onBarClick(bar.conversationId)}
            aria-label={`Jump to conversation at ${bar.leftPct.toFixed(0)}%`}
            className={cn(
              'absolute top-1 bottom-1 cursor-pointer rounded-md border transition-colors hover:opacity-80',
              BAR_TONE_CLASSES[bar.tone],
              bar.isActive && 'shadow-[0_0_0_2px_var(--m03-bg),0_0_0_3px_var(--m03-fg)]',
            )}
            style={{
              left: `${bar.leftPct}%`,
              width: `${BAR_WIDTH_PCT}%`,
            }}
            data-testid={`minimap-bar-${bar.conversationId}`}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--m03-fg-3)]">
        <span>{startLabel}</span>
        <span>
          <strong className="font-medium text-[var(--m03-fg)]">
            {totalInWindow} conversation{totalInWindow === 1 ? '' : 's'}
          </strong>
          {' · '}
          {autoRepliedCount} auto-replied
          {' · '}
          {awaitingYouCount} awaiting you
        </span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
