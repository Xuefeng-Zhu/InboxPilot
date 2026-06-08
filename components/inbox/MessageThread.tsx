'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { insforge } from '@/lib/insforge';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/use-realtime';
import { MessageBubble, type MessageRow } from './MessageBubble';
import { ReplyComposer } from './ReplyComposer';
import { AiDraftPanel } from './AiDraftPanel';
import { ContactDetails } from './ContactDetails';
import { StatusBadge } from './StatusBadge';
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
  const [rightTab, setRightTab] = useState<'insight' | 'customer' | 'audit'>('insight');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchData = useCallback(async (isBackground = false) => {
    if (!user) return;

    if (!isBackground) {
      setLoading(true);
    }
    setError(null);

    try {
      // Fetch conversation with contact details
      const { data: convoData, error: convoError } = await insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('id', conversationId)
        .single();

      if (convoError || !convoData) {
        setError(convoError?.message ?? 'Failed to load conversation');
        setLoading(false);
        return;
      }

      setConversation(convoData as ConversationRow);

      // Fetch messages in chronological order (oldest first)
      const { data: msgData, error: msgError } = await insforge.database
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (msgError) {
        setError(msgError.message);
        setLoading(false);
        return;
      }

      setMessages(Array.isArray(msgData) ? (msgData as MessageRow[]) : msgData ? [msgData as MessageRow] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [user, conversationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to realtime messages for this conversation
  useRealtime({
    onNewMessage: () => fetchData(true),
    messageChannel: `inbox:messages:${conversationId}`,
    enabled: !!user,
  });

  // ---- Loading state -----------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex items-center gap-2 text-body-sm text-gray-500">
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading messages…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div role="alert" className="rounded bg-red-50 p-4 text-body-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  const contactName = conversation?.contacts?.name
    ?? conversation?.contacts?.email
    ?? conversation?.contacts?.phone
    ?? 'Conversation';

  const contactEmail = conversation?.contacts?.email ?? '';
  const contactInitials = contactName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // ---- Render ------------------------------------------------------------

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Center: messages + composer */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Thread header — contact info + actions */}
        <header className="flex items-center gap-3 border-b border-surface-border bg-white px-4 py-3">
          {/* Contact avatar */}
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary-50 text-primary text-label-md font-semibold shrink-0">
            {contactInitials}
          </div>

          {/* Contact name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-body-md font-semibold text-gray-900 truncate">
                {contactName}
              </h2>
              {conversation && (
                <StatusBadge status={conversation.status} />
              )}
            </div>
            <p className="text-label-sm text-gray-500 truncate">
              {contactEmail}
              {conversation?.subject && ` • ID: #${conversation.id.slice(0, 5)}`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="inline-flex items-center gap-1.5 rounded border border-surface-border bg-white px-3 py-1.5 text-body-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              aria-label="Assign conversation"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="5" r="2.5" />
                <path d="M3 13c0-2.5 1.8-4 4-4s4 1.5 4 4" />
              </svg>
              Assign
            </button>
            <button
              className="p-1.5 rounded hover:bg-gray-50 text-gray-500 transition-colors"
              aria-label="More actions"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 bg-surface-background"
          role="log"
          aria-label="Message history"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-body-sm text-gray-400">No messages yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            </div>
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

      {/* Right sidebar — AI Insight / Customer / Audit tabs */}
      <aside className="hidden xl:flex w-72 shrink-0 flex-col border-l border-surface-border bg-white overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-surface-border">
          {(['insight', 'customer', 'audit'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 py-2.5 text-label-sm font-medium text-center transition-colors border-b-2 ${
                rightTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'insight' ? 'AI Insight' : tab === 'customer' ? 'Customer' : 'Audit'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {rightTab === 'insight' && conversation && (
            <AiInsightPanel conversation={conversation} />
          )}
          {rightTab === 'customer' && conversation && (
            <ContactDetails conversation={conversation} />
          )}
          {rightTab === 'audit' && (
            <div className="text-body-sm text-gray-500">
              <p>Audit trail will appear here.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Insight Panel (right sidebar)
// ---------------------------------------------------------------------------

function AiInsightPanel({ conversation }: { conversation: ConversationRow }) {
  const aiState = conversation.ai_state;

  const statusLabel = aiState === 'drafted' ? 'Draft Ready' :
    aiState === 'thinking' ? 'Analyzing...' :
    aiState === 'auto_replied' ? 'Auto Replied' :
    aiState === 'needs_human' ? 'Needs Human' :
    aiState === 'failed' ? 'Failed' : 'Idle';

  const statusColor = aiState === 'drafted' ? 'text-green-600' :
    aiState === 'thinking' ? 'text-ai' :
    aiState === 'auto_replied' ? 'text-green-600' :
    aiState === 'needs_human' ? 'text-orange-600' :
    aiState === 'failed' ? 'text-red-600' : 'text-gray-400';

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={statusColor}>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            {aiState === 'drafted' && <path d="M4.5 7l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
          <span className={`text-body-sm font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        {aiState === 'drafted' && (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-label-sm font-medium text-green-700">
            94%
          </span>
        )}
      </div>

      {/* Reasoning */}
      {aiState === 'drafted' && (
        <>
          <div>
            <h4 className="text-label-md text-gray-700 mb-1.5">Reasoning</h4>
            <div className="rounded border border-surface-border bg-gray-50 p-3">
              <p className="text-body-sm text-gray-600">
                AI analyzed the conversation context and knowledge base to generate a response.
              </p>
            </div>
          </div>

          {/* Sources */}
          <div>
            <h4 className="text-label-md text-gray-700 mb-1.5">Sources</h4>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded border border-surface-border bg-white px-2 py-1 text-label-sm text-gray-600">
                Knowledge Base
              </span>
            </div>
          </div>

          {/* Regenerate */}
          <button className="w-full rounded border border-surface-border bg-white px-3 py-2 text-body-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Regenerate
          </button>
        </>
      )}

      {/* Suggested Actions */}
      {aiState === 'drafted' && (
        <div>
          <h4 className="text-label-md text-gray-700 mb-2">Suggested Actions</h4>
          <div className="space-y-2">
            <button className="flex items-center justify-between w-full rounded border border-surface-border bg-white px-3 py-2 text-body-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span>Apply tag</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                <circle cx="7" cy="7" r="5" />
                <path d="M7 5v4M5 7h4" />
              </svg>
            </button>
            <button className="flex items-center justify-between w-full rounded border border-surface-border bg-white px-3 py-2 text-body-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span>Create Ticket</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                <circle cx="7" cy="7" r="5" />
                <path d="M7 5v4M5 7h4" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
