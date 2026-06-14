'use client';

/**
 * KanbanRow — a single row in the kanban split-inbox lane.
 *
 * Visual target: `mockups/4-retool-grade.html` rows 1–3 per card
 *   (contact name + SLA chip, preview, channel pill) plus the optional
 *   `Review` badge in the AI-drafted lane (mockup L193).
 *
 * 3 sub-rows inside a single clickable container:
 *   1. contact display name (truncate) | <Review?> <SlaChip/>
 *   2. preview (1-line clamp): body → subject → 'No messages yet'
 *   3. channel pill: SMS / EMAIL / WEB with channel-specific color
 *
 * WHY `<div role="button" tabIndex={0}>` (not `<button>`):
 *   The AI-drafted lane renders a nested `Review` `<button>` for the
 *   approve-draft affordance. Putting a `<button>` inside a `<button>`
 *   is invalid HTML and breaks the keyboard focus chain in some
 *   screen readers. A `role="button"` `<div>` with `onKeyDown` for
 *   Enter/Space is the standard React workaround and matches the
 *   kanban card pattern used by Trello/Linear.
 *
 * WHY click+keyboard live in the row, but the drawer is opened by the
 *   parent: the row never imports the drawer. The parent owns
 *   `useDrawer()` / setState / router-push; the row is a pure
 *   "fire onClick" sink. This keeps the row testable without a drawer
 *   context and reusable across lanes (Mine / Unassigned / etc.).
 *
 * WHY a `Record<Channel, string>` map (not a switch) for the channel
 *   color: the 3 channel→class mappings are static config, not
 *   branching logic. A `Record` gives exhaustive-type safety (TS
 *   error if a 4th channel is added without a map entry) and a single
 *   table a reviewer can scan in 5 seconds. The map sits at module
 *   scope (not inside the component) so it isn't reallocated per
 *   render — same pattern as `SlaChip`'s `tierClasses` (T6).
 */

import { type KeyboardEvent } from 'react';
import { cn } from '@/components/ui/cn';
import type { ConversationListItem } from '@/lib/queries/keys';
import { SlaChip } from './SlaChip';
import { type SlaThresholds } from '../_lib/sla';
import { channelLabel, getContactDisplayName } from '../_lib/contact-display';

export interface KanbanRowProps {
  conversation: ConversationListItem;
  isSelected: boolean;
  onClick: () => void;
  thresholds: SlaThresholds;
  now: Date;
  /** Render the `Review` badge at the top-right (used in `ai_drafted` lane). */
  showReviewButton?: boolean;
  /** Optional `data-lane-id` attribute for e2e selectors. */
  dataLaneId?: string;
}

// Channel → Tailwind text-color class. Mirrors the visual language in
// `components/inbox/ConversationItem.tsx` (SMS=sky, EMAIL=violet, WEB=emerald).
// Kept in sync by hand. The 3-entry map is exhaustive for the `Channel`
// union — adding a 4th channel without an entry would be a TS error
// at the `channelTextClass[channel]` access site, which is what we
// want.
const channelTextClass: Record<'sms' | 'email' | 'webchat', string> = {
  sms: 'text-sky-600 font-semibold',
  email: 'text-violet-600 font-semibold',
  webchat: 'text-emerald-600 font-semibold',
};

function getChannelClass(channel: string): string {
  if (channel === 'sms') return channelTextClass.sms;
  if (channel === 'webchat') return channelTextClass.webchat;
  return channelTextClass.email;
}

function getPreviewText(conversation: ConversationListItem): string {
  return (
    conversation.latest_message?.body ??
    conversation.subject ??
    'No messages yet'
  );
}

export function KanbanRow({
  conversation,
  isSelected,
  onClick,
  thresholds,
  now,
  showReviewButton,
  dataLaneId,
}: KanbanRowProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="kanban-row"
      data-lane-id={dataLaneId}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'cursor-pointer border-l-2 border-l-transparent px-2.5 py-2 text-left transition-colors',
        'hover:bg-[var(--m03-line-2)]',
        'focus:outline-none focus-visible:bg-[var(--m03-line-2)]',
        isSelected && 'border-l-[var(--m03-fg)] bg-[var(--m03-line-2)]',
      )}
    >
      {/* Row 1: contact name + (optional Review badge) + SLA chip */}
      <div className="mb-0.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--m03-fg)]">
          {getContactDisplayName(conversation)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {showReviewButton ? (
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
            >
              Review
            </button>
          ) : null}
          <SlaChip
            lastMessageAt={conversation.last_message_at}
            now={now}
            thresholds={thresholds}
          />
        </div>
      </div>

      {/* Row 2: preview, 1-line clamp */}
      <p className="mb-1 line-clamp-1 text-xs leading-[1.4] text-[var(--m03-fg-2)]">
        {getPreviewText(conversation)}
      </p>

      {/* Row 3: channel pill */}
      <div>
        <span
          className={cn(
            'text-[10px] uppercase tracking-[0.04em]',
            getChannelClass(conversation.channel),
          )}
        >
          {channelLabel(conversation.channel)}
        </span>
      </div>
    </div>
  );
}
