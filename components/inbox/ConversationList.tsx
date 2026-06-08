'use client';

import { useAuth } from '@/lib/auth-context';
import { useOrgMembership, useConversations } from '@/lib/queries';
import { ConversationItem, type ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter?: string;
  channelFilter?: string;
  contactFilter?: string;
  searchQuery?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationList({ selectedId, onSelect, statusFilter, channelFilter, contactFilter, searchQuery }: ConversationListProps) {
  const { user } = useAuth();

  const { data: orgId } = useOrgMembership(user?.id);

  const { data: conversations, isLoading, error } = useConversations(
    orgId ?? undefined,
    {
      status: statusFilter,
      channel: channelFilter,
      contactId: contactFilter,
      search: searchQuery,
    },
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading conversations…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </div>
      </div>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-gray-500">No conversations found.</p>
      </div>
    );
  }

  return (
    <nav aria-label="Conversation list" className="overflow-y-auto">
      {conversations.map((conversation) => (
        <ConversationItem
          key={(conversation as ConversationRow).id}
          conversation={conversation as ConversationRow}
          isSelected={selectedId === (conversation as ConversationRow).id}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
