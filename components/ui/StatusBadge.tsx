import React from 'react';
import { cn } from './cn';

// ---------------------------------------------------------------------------
// StatusBadge — M03 Vercel-monochrome square mono badge (canonical).
//
// Variants:
//   open         → outlined gray
//   pending      → light orange fill, orange text
//   resolved     → light green fill, green text
//   escalated    → light red fill, red text
//   ai_draft     → light orange fill, orange text
//   connected    → light green fill, green text
//   disconnected → light red fill, red text
// ---------------------------------------------------------------------------

type Status =
  | 'open'
  | 'pending'
  | 'resolved'
  | 'escalated'
  | 'ai_draft'
  | 'connected'
  | 'disconnected';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const colorMap: Record<Status, string> = {
  open: 'bg-white text-[var(--m03-fg-2)] border border-[var(--m03-line)]',
  pending: 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]',
  resolved: 'bg-[var(--m03-green-fill)] text-[var(--m03-green)] border border-[var(--m03-green-line)]',
  escalated: 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]',
  ai_draft: 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]',
  connected: 'bg-[var(--m03-green-fill)] text-[var(--m03-green)] border border-[var(--m03-green-line)]',
  disconnected: 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]',
};

const labelMap: Record<Status, string> = {
  open: 'Open',
  pending: 'Pending',
  resolved: 'Resolved',
  escalated: 'Escalated',
  ai_draft: 'AI draft',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.04em]',
        colorMap[status],
        className,
      )}
    >
      {labelMap[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AiStateIndicator — M03 mono state pill (used in conversation items,
// thread headers, and the inbox right panel).
// ---------------------------------------------------------------------------

export type AiState =
  | 'idle'
  | 'thinking'
  | 'drafted'
  | 'auto_replied'
  | 'needs_human'
  | 'failed';

const aiStateConfig: Record<
  AiState,
  { label: string; className: string; show: boolean; dot?: boolean }
> = {
  idle: { label: '', className: '', show: false },
  thinking: {
    label: 'Thinking',
    className: 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]',
    show: true,
    dot: true,
  },
  drafted: {
    label: 'Drafted',
    className: 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]',
    show: true,
    dot: true,
  },
  auto_replied: {
    label: 'Auto-replied',
    className: 'bg-[var(--m03-green-fill)] text-[var(--m03-green)] border border-[var(--m03-green-line)]',
    show: true,
    dot: true,
  },
  needs_human: {
    label: 'Needs human',
    className: 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]',
    show: true,
    dot: true,
  },
  failed: {
    label: 'Failed',
    className: 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]',
    show: true,
    dot: true,
  },
};

export function AiStateIndicator({ aiState }: { aiState: AiState }) {
  const config = aiStateConfig[aiState];
  if (!config.show) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.04em]',
        config.className,
      )}
    >
      {config.dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            aiState === 'drafted' || aiState === 'thinking'
              ? 'bg-[var(--m03-orange)]'
              : aiState === 'auto_replied'
                ? 'bg-[var(--m03-green)]'
                : 'bg-[var(--m03-red)]',
          )}
          aria-hidden="true"
        />
      )}
      {config.label}
    </span>
  );
}
