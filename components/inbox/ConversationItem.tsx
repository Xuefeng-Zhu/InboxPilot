'use client';

import { StatusBadge, cn } from '@/components/ui';
import { AiStateIndicator } from './StatusBadge';
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
  if (channel === 'webchat') return contact.email ?? `Visitor #${getShortIdentifier(contact.id)}`;
  return contact.phone ?? contact.email ?? 'Unknown Contact';
}

function getConversationTitle(conversation: ConversationRow): string {
  const subject = conversation.subject ?? conversation.latest_message?.subject;
  if (subject?.trim()) return subject.trim();
  if (conversation.channel === 'webchat') return 'Web chat conversation';
  if (conversation.channel === 'sms') return 'SMS conversation';
  return 'Email conversation';
}

function getConversationPreview(conversation: ConversationRow): string {
  const body = conversation.latest_message?.body;
  if (body?.trim()) return body.trim();
  return 'No messages yet';
}

function getConversationTimestamp(conversation: ConversationRow): string | null {
  return conversation.last_message_at ?? conversation.latest_message?.created_at ?? conversation.created_at;
}

function formatTimestamp(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function channelLabel(channel: Channel): string {
  if (channel === 'sms') return 'SMS';
  if (channel === 'webchat') return 'Web';
  return 'Email';
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
  const title = getConversationTitle(conversation);
  const preview = getConversationPreview(conversation);
  const timestamp = getConversationTimestamp(conversation);

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-surface-border/50 transition-colors cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary',
        isSelected
          ? 'bg-surface-container border-l-[3px] border-l-primary'
          : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
      )}
    >
      <div className="flex items-start gap-2">
        {/* Unread dot */}
        {isUnread && (
          <span
            className="mt-2 w-[6px] h-[6px] rounded-full bg-primary shrink-0"
            aria-label="Unread"
          />
        )}

        <div className="min-w-0 flex-1">
          {/* Row 1: Contact name + timestamp */}
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate text-body-md text-gray-900',
                isUnread && 'font-semibold'
              )}
            >
              {displayName}
            </span>
            <span className="shrink-0 text-label-sm text-gray-400">
              {formatTimestamp(timestamp)}
            </span>
          </div>

          {/* Row 2: Subject / preview (bold if unread) */}
          <p className={cn(
            'mt-0.5 text-body-sm text-gray-700 truncate',
            isUnread && 'font-medium'
          )}>
            {title}
          </p>

          {/* Row 3: Preview text */}
          <p className="mt-0.5 text-body-sm text-gray-500 line-clamp-1">
            {preview}
          </p>

          {/* Row 4: Channel badge + Status badge */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-label-sm text-gray-600">
              {channelLabel(conversation.channel)}
            </span>
            <StatusBadge status={conversation.status} />
            <AiStateIndicator aiState={conversation.ai_state} />
          </div>
        </div>
      </div>
    </button>
  );
}
