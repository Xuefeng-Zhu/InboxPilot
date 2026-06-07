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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContactDisplayName(contact: ContactRow | null, channel: Channel): string {
  if (!contact) return 'Unknown Contact';
  if (contact.name) return contact.name;
  if (channel === 'sms' && contact.phone) return contact.phone;
  if (channel === 'email' && contact.email) return contact.email;
  return contact.phone ?? contact.email ?? 'Unknown Contact';
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
  return channel === 'sms' ? 'SMS' : 'Email';
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
  const displayName = getContactDisplayName(conversation.contacts, conversation.channel);

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-gray-100 transition-colors cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary',
        isSelected
          ? 'bg-surface-container border-l-2 border-l-primary'
          : 'hover:bg-gray-50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Unread indicator + content */}
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {/* Unread dot */}
          {isUnread && (
            <span
              className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0"
              aria-label="Unread"
            />
          )}

          <div className="min-w-0 flex-1">
            {/* Top row: subject + timestamp */}
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'truncate text-body-md text-gray-900',
                  isUnread && 'font-semibold'
                )}
              >
                {conversation.subject ?? displayName}
              </span>
              <span className="shrink-0 text-label-sm text-gray-400">
                {formatTimestamp(conversation.last_message_at)}
              </span>
            </div>

            {/* Second row: 2-line message preview */}
            {conversation.subject && (
              <p className="mt-0.5 text-body-sm text-gray-500 line-clamp-2">
                {displayName}
              </p>
            )}
            {!conversation.subject && (
              <p className="mt-0.5 text-body-sm text-gray-500 line-clamp-2">
                No subject
              </p>
            )}

            {/* Third row: channel badge + status badge + AI state */}
            <div className="mt-1.5 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-label-sm text-gray-600">
                {channelLabel(conversation.channel)}
              </span>
              <StatusBadge status={conversation.status} />
              <AiStateIndicator aiState={conversation.ai_state} />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
