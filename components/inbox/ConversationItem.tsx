'use client';

import { StatusBadge, AiStateIndicator } from './StatusBadge';
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

function channelIcon(channel: Channel): string {
  return channel === 'sms' ? '💬' : '✉️';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConversationItemProps {
  conversation: ConversationRow;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function ConversationItem({ conversation, isSelected, onSelect }: ConversationItemProps) {
  const displayName = getContactDisplayName(conversation.contacts, conversation.channel);

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-600'
          : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm" aria-label={`Channel: ${conversation.channel}`}>
              {channelIcon(conversation.channel)}
            </span>
            <span className="truncate text-sm font-medium text-gray-900">
              {displayName}
            </span>
          </div>

          {conversation.subject && (
            <p className="mt-0.5 truncate text-xs text-gray-600">
              {conversation.subject}
            </p>
          )}
        </div>

        <span className="shrink-0 text-xs text-gray-400">
          {formatTimestamp(conversation.last_message_at)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <StatusBadge status={conversation.status} />
        <AiStateIndicator aiState={conversation.ai_state} />
      </div>
    </button>
  );
}
