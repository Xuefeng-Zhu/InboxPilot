'use client';

import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import {
  conversationInitial,
  pillForAiState,
  relativeTimeLabel,
  truncate,
  type PillDescriptor,
} from '@/lib/queries/hooks/useSymphony';
import { RiverExpandedPanel } from './RiverExpandedPanel';

export interface RiverCardData {
  id: string;
  contactName: string;
  contactInitial: string;
  channel: string;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  aiState: string;
  status: string;
  /** When true, the card is rendered in the "streaming in" placeholder state. */
  isStreaming?: boolean;
  /** When true, the card is rendered in the "scheduled follow-up" placeholder state. */
  isScheduled?: boolean;
  /** For scheduled cards, a label like "+1h" or "tomorrow". */
  scheduledLabel?: string;
}

interface RiverCardProps {
  data: RiverCardData;
  isActive: boolean;
  onSelect: (id: string) => void;
  onApproved?: (id: string) => void;
}

const PILL_TONE_CLASSES: Record<PillDescriptor['tone'], string> = {
  sent: 'border-[var(--m03-green)] text-[var(--m03-green)]',
  drafting: 'border-[var(--m03-orange)] text-[var(--m03-orange)]',
  thinking: 'border-[var(--m03-blue)] text-[var(--m03-blue)]',
  escalated: 'border-[var(--m03-red)] text-[var(--m03-red)]',
  failed: 'border-[var(--m03-red)] text-[var(--m03-red)]',
  resolved: 'border-[var(--m03-line)] text-[var(--m03-fg-2)]',
  idle: 'border-[var(--m03-line)] text-[var(--m03-fg-2)]',
};

const PILL_DOT_CLASSES: Record<PillDescriptor['tone'], string> = {
  sent: 'bg-[var(--m03-green)]',
  drafting: 'bg-[var(--m03-orange)]',
  thinking: 'bg-[var(--m03-blue)]',
  escalated: 'bg-[var(--m03-red)]',
  failed: 'bg-[var(--m03-red)]',
  resolved: 'bg-[var(--m03-fg-3)]',
  idle: 'bg-[var(--m03-fg-3)]',
};

/**
 * RiverCard — collapsed by default, expands into the active card when
 * `isActive` is true. Implements the visual treatment from
 * design-review/concept-04-symphony.html (lines 142-262) using the M03
 * design tokens defined in app/globals.css.
 */
export function RiverCard({ data, isActive, onSelect, onApproved }: RiverCardProps) {
  const [editMode, setEditMode] = useState(false);

  const pill = pillForAiState(data.aiState, data.status);
  const initial = conversationInitial(data.contactName, data.contactInitial);

  const channelLabel = data.isScheduled
    ? `${data.channel} · ${data.scheduledLabel ?? 'upcoming'}`
    : data.isStreaming
      ? `${data.channel} · incoming`
      : `${data.channel} · ${relativeTimeLabel(data.lastMessageAt)}`;

  return (
    <article
      className={cn(
        'relative flex shrink-0 cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-all duration-200',
        isActive
          ? 'w-[380px] min-h-[440px] border-[var(--m03-fg)] opacity-100'
          : 'h-[280px] w-[220px] border-[var(--m03-line)] opacity-55 hover:translate-y-[-2px] hover:opacity-85',
      )}
      aria-current={isActive ? 'true' : undefined}
      aria-expanded={isActive}
      role={isActive ? undefined : 'button'}
      tabIndex={isActive ? undefined : 0}
      onClick={() => onSelect(data.id)}
      onKeyDown={(event) => {
        if (!isActive && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSelect(data.id);
        }
      }}
      data-testid={`river-card-${data.id}`}
    >
      {/* Header */}
      <header className="flex items-center gap-2">
        <div
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--m03-line)] bg-[var(--m03-line-2)] text-[11px] font-semibold text-[var(--m03-fg)]"
          aria-hidden="true"
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-[var(--m03-fg)]">
            {data.contactName}
          </div>
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--m03-fg-3)]">
            {channelLabel}
          </div>
        </div>
        <div className="ml-auto font-mono text-[10px] text-[var(--m03-fg-3)]">
          {data.isScheduled
            ? data.scheduledLabel ?? '+1h'
            : data.isStreaming
              ? 'now'
              : relativeTimeLabel(data.lastMessageAt)}
        </div>
      </header>

      {/* Preview (clamped when collapsed) */}
      {data.isScheduled ? (
        <p
          className="text-[12px] leading-[1.5] text-[var(--m03-fg-3)] italic"
          style={{ fontStyle: 'italic' }}
        >
          scheduled follow-up
        </p>
      ) : data.isStreaming ? (
        <p
          className="text-[12px] leading-[1.5] text-[var(--m03-fg-3)] italic"
          style={{ fontStyle: 'italic' }}
        >
          streaming in…
        </p>
      ) : (
        <p
          className={cn(
            'overflow-hidden text-[12px] leading-[1.5] text-[var(--m03-fg-2)]',
            isActive ? '' : 'line-clamp-3',
          )}
        >
          &ldquo;{truncate(data.lastMessagePreview, 200)}&rdquo;
        </p>
      )}

      {/* State pill (collapsed) */}
      {!isActive && (
        <div
          className={cn(
            'mt-auto inline-flex w-fit items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em]',
            PILL_TONE_CLASSES[pill.tone],
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              PILL_DOT_CLASSES[pill.tone],
              pill.tone === 'thinking' ? 'animate-pulse' : '',
            )}
            aria-hidden="true"
          />
          {pill.text}
        </div>
      )}

      {/* Expanded panel (active card only) */}
      {isActive && (
        <RiverExpandedPanel
          conversationId={data.id}
          contactName={data.contactName}
          pill={pill}
          editMode={editMode}
          onStartEdit={() => setEditMode(true)}
          onCancelEdit={() => setEditMode(false)}
          onApproved={() => {
            setEditMode(false);
            onApproved?.(data.id);
          }}
        />
      )}
    </article>
  );
}
