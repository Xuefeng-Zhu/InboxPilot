'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { insforge } from '@/lib/insforge';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/use-realtime';
import { MessageBubble, type MessageRow } from './MessageBubble';
import { ReplyComposer } from './ReplyComposer';
import { AiDraftPanel } from './AiDraftPanel';
import { ContactDetails } from './ContactDetails';
import type { ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MessageThreadProps {
  conversationId: string;
}

export function MessageThread({ conversationId }: MessageThreadProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch conversation with contact details
      const { data: convoData, error: convoError } = await insforge.from<ConversationRow>(
        'conversations',
        {
          select: '*, contacts(*)',
          filter: { id: `eq.${conversationId}` },
          single: true,
        },
      );

      if (convoError || !convoData) {
        setError(convoError?.message ?? 'Failed to load conversation');
        setLoading(false);
        return;
      }

      setConversation(convoData as ConversationRow);

      // Fetch messages in chronological order (oldest first)
      const { data: msgData, error: msgError } = await insforge.from<MessageRow>(
        'messages',
        {
          select: '*',
          filter: { conversation_id: `eq.${conversationId}` },
          order: 'created_at.asc',
        },
      );

      if (msgError) {
        setError(msgError.message);
        setLoading(false);
        return;
      }

      setMessages(Array.isArray(msgData) ? msgData : msgData ? [msgData] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [user, conversationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for new messages every 5 seconds
  useRealtime({
    onNewMessage: fetchData,
    enabled: !!user,
  });

  // ---- Loading state -----------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
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
          Loading messages…
        </div>
      </div>
    );
  }

  // ---- Error state -------------------------------------------------------

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  // ---- Render ------------------------------------------------------------

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Message thread + composer */}
      <div className="flex flex-1 flex-col">
        {/* Thread header */}
        <header className="flex items-center border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            {conversation?.contacts?.name ??
              conversation?.contacts?.email ??
              conversation?.contacts?.phone ??
              'Conversation'}
          </h2>
          {conversation?.subject && (
            <span className="ml-2 truncate text-xs text-gray-500">
              — {conversation.subject}
            </span>
          )}
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto py-4"
          role="log"
          aria-label="Message history"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-400">No messages yet.</p>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>

        {/* AI draft panel — shown between messages and composer */}
        {conversation && (
          <AiDraftPanel
            conversationId={conversationId}
            aiState={conversation.ai_state}
          />
        )}

        {/* Reply composer */}
        <ReplyComposer conversationId={conversationId} />
      </div>

      {/* Contact details sidebar */}
      {conversation && <ContactDetails conversation={conversation} />}
    </div>
  );
}
