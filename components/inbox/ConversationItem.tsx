'use client';

import { StatusBadge, AiStateIndicator } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import type { ConversationStatus, AiState, Channel } from '@support-core/types';

// ---------------------------------------------------------------------------
// Types — PostgREST row shape (snake_case from the database)
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string;
  organization_id: string;
  contact_id: string;
  channel: Channel;
  status: ConversationStatus;
  ai_state: AiState;
  subject: string | null;
  assigned_to: string | null;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  contacts: ContactRow | null;
  latest_message?: MessagePreviewRow | null;
}

export interface ContactRow {
  id: string;
  organization_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MessagePreviewRow {
  conversation_id: string;
  body: string;
  subject: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getShortIdentifier(id: string): string {
  return id.slice(0, 8);
}

function getContactDisplayName(conversation: ConversationRow): string {
  const { contacts: contact, channel } = conversation;
  if (!contact) return 'Unknown Contact';
  if (contact.name) return contact.name;
  if (channel === 'sms' && contact.phone) return contact.phone;
  if (channel === 'email' && contact.email) return contact.email;
  if (channel === 'webchat')
    return contact.email ?? `Visitor #${getShortIdentifier(contact.id)}`;
  return contact.phone ?? contact.email ?? 'Unknown Contact';
}

function getConversationPreview(conversation: ConversationRow): string {
  const body = conversation.latest_message?.body;
  if (body?.trim()) return body.trim();
  return 'No messages yet';
}

function getConversationTimestamp(conversation: ConversationRow): string | null {
  return (
    conversation.last_message_at ??
    conversation.latest_message?.created_at ??
    conversation.created_at
  );
}

function formatTimestamp(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Future timestamps and timestamps older than 7 days fall through to a
  // localized "Mon DD" form so the UI never shows blank.
  if (diffMs < 0) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function channelLabel(channel: Channel): string {
  if (channel === 'sms') return 'SMS';
  if (channel === 'webchat') return 'WEB';
  return 'EMAIL';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConversationItemProps {
  conversation: ConversationRow;
  isSelected: boolean;
  isUnread?: boolean;
  onSelect: (id: string) => void;
}

export function ConversationItem({
  conversation,
  isSelected,
  isUnread = false,
  onSelect,
}: ConversationItemProps) {
  const displayName = getContactDisplayName(conversation);
  const preview = getConversationPreview(conversation);
  const timestamp = getConversationTimestamp(conversation);
  const showAiDraftBadge = conversation.ai_state === 'drafted';

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'block w-full cursor-pointer border-b border-[var(--m03-line)] px-4 py-3 text-left transition-colors',
        'focus:outline-none',
        isSelected
          ? 'border-l-2 border-l-[var(--m03-fg)] bg-[var(--m03-line-2)] pl-[14px]'
          : 'border-l-2 border-l-transparent hover:bg-[var(--m03-line-2)]',
      )}
    >
      {/* Row 1: Contact name + timestamp */}
      <div className="mb-1 flex items-baseline gap-2">
        <span
          className={cn(
            'truncate text-[13px] font-semibold text-[var(--m03-fg)]',
            'max-w-[180px]',
          )}
        >
          {displayName}
        </span>
        <time
          dateTime={timestamp ?? undefined}
          className="ml-auto font-mono text-[10px] text-[var(--m03-fg-3)]"
        >
          {formatTimestamp(timestamp)}
        </time>
      </div>

      {/* Row 2: Preview (1-line clamp) */}
      <p className="mb-1.5 line-clamp-1 text-[12px] leading-[1.4] text-[var(--m03-fg-2)]">
        {preview}
      </p>

      {/* Row 3: Status badge + channel + AI draft badge */}
      <div className="flex items-center gap-1.5">
        <StatusBadge status={conversation.status} />
        <span className="font-mono text-[9px] uppercase tracking-[0.04em] text-[var(--m03-fg-3)]">
          {channelLabel(conversation.channel)}
        </span>
        {showAiDraftBadge && (
          <span className="font-mono text-[9px] uppercase tracking-[0.04em] text-[var(--m03-orange)]">
            AI draft
          </span>
        )}
        {isUnread && (
          <span
            className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--m03-fg)]"
            aria-label="Unread"
          />
        )}
        {/* Hidden helper for the AI state indicator (still exported & used elsewhere) */}
        <span className="hidden">
          <AiStateIndicator aiState={conversation.ai_state} />
        </span>
      </div>
    </button>
  );
}
