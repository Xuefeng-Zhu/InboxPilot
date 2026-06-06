'use client';

import { useCallback, useEffect, useState } from 'react';
import { insforge } from '@/lib/insforge';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/use-realtime';
import { ConversationItem, type ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationList({ selectedId, onSelect }: ConversationListProps) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // First get the user's organization membership to find their org
      const { data: members, error: memberError } = await insforge.database
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1);

      if (memberError || !members) {
        setError('No organization found. Please join an organization first.');
        setLoading(false);
        return;
      }

      const memberArr = Array.isArray(members) ? members : [members];
      if (memberArr.length === 0) {
        setError('No organization found. Please join an organization first.');
        setLoading(false);
        return;
      }

      const orgId = (memberArr[0] as { organization_id: string }).organization_id;

      // Fetch conversations with joined contact data, sorted by last_message_at desc
      const { data, error: fetchError } = await insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('organization_id', orgId)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setConversations(Array.isArray(data) ? (data as ConversationRow[]) : data ? [data as ConversationRow] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Poll for new messages and conversation updates every 5 seconds
  useRealtime({
    onNewMessage: fetchConversations,
    onConversationUpdated: fetchConversations,
    enabled: !!user,
  });

  // ---- Render ------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
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
          {error}
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-gray-500">No conversations yet.</p>
      </div>
    );
  }

  return (
    <nav aria-label="Conversation list" className="overflow-y-auto">
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          isSelected={selectedId === conversation.id}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
