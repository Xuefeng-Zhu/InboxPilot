'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  MESSAGE_PAGE_SIZE,
  useConversation,
  useInfiniteMessages,
  useAiDecision,
  queryKeys,
} from '@/lib/queries';
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

function getRealtimeConversationId(payload: Record<string, unknown>): string | null {
  const nestedMessage = payload.message;
  const message = nestedMessage && typeof nestedMessage === 'object'
    ? nestedMessage as Record<string, unknown>
    : null;

  const candidate =
    payload.conversation_id ??
    payload.conversationId ??
    message?.conversation_id ??
    message?.conversationId;

  return typeof candidate === 'string' ? candidate : null;
}

export function MessageThread({ conversationId }: MessageThreadProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [rightTab, setRightTab] = useState<'insight' | 'customer' | 'audit'>('insight');
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);
  const isPrependingRef = useRef(false);
  const nearBottomRef = useRef(true);
  const previousScrollHeightRef = useRef(0);
  const previousScrollTopRef = useRef(0);

  const { data: conversationData, isLoading: convoLoading, error: convoError } = useConversation(conversationId);
  const {
    items: messagesData,
    isInitialLoading: msgsLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    error: msgsError,
  } = useInfiniteMessages(conversationId);

  const conversation = conversationData as ConversationRow | undefined;
  const messages = (messagesData ?? []) as unknown as MessageRow[];

  useEffect(() => {
    hasInitialScrollRef.current = false;
    isPrependingRef.current = false;
    nearBottomRef.current = true;
    previousScrollHeightRef.current = 0;
    previousScrollTopRef.current = 0;
  }, [conversationId]);

  function isNearBottom(element: HTMLDivElement) {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }

  function handleScroll() {
    if (scrollRef.current) {
      nearBottomRef.current = isNearBottom(scrollRef.current);
    }
  }

  useEffect(() => {
    const scrollRoot = scrollRef.current;
    const sentinel = topSentinelRef.current;
    if (
      !scrollRoot ||
      !sentinel ||
      !hasNextPage ||
      isFetchNextPageError ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          previousScrollHeightRef.current = scrollRoot.scrollHeight;
          previousScrollTopRef.current = scrollRoot.scrollTop;
          isPrependingRef.current = true;
          void fetchNextPage();
        }
      },
      { root: scrollRoot, rootMargin: '160px 0px 0px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage]);

  // Preserve top position when older messages prepend, otherwise keep the user
  // at the bottom only on first load or when they were already near the bottom.
  useEffect(() => {
    if (msgsLoading || !scrollRef.current) return;

    const scrollRoot = scrollRef.current;

    if (isPrependingRef.current) {
      requestAnimationFrame(() => {
        const heightDelta = scrollRoot.scrollHeight - previousScrollHeightRef.current;
        scrollRoot.scrollTop = previousScrollTopRef.current + heightDelta;
        nearBottomRef.current = isNearBottom(scrollRoot);
        isPrependingRef.current = false;
      });
      return;
    }

    if (!hasInitialScrollRef.current || nearBottomRef.current) {
      requestAnimationFrame(() => {
        scrollRoot.scrollTop = scrollRoot.scrollHeight;
        nearBottomRef.current = true;
        hasInitialScrollRef.current = true;
      });
    }
  }, [conversationId, messages.length, msgsLoading]);

  // Realtime: invalidate queries on new messages
  useRealtime({
    onNewMessage: (payload) => {
      const realtimeConversationId = getRealtimeConversationId(payload);
      if (realtimeConversationId && realtimeConversationId !== conversationId) return;

      if (scrollRef.current) {
        nearBottomRef.current = isNearBottom(scrollRef.current);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.messagesInfinite(conversationId, MESSAGE_PAGE_SIZE) });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.aiDecision(conversationId) });
    },
    onConversationUpdated: (payload) => {
      const realtimeConversationId = getRealtimeConversationId(payload);
      if (realtimeConversationId && realtimeConversationId !== conversationId) return;

      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.aiDecision(conversationId) });
    },
    messageChannel: conversation ? `org:${conversation.organization_id}` : undefined,
    conversationChannel: conversation ? `org:${conversation.organization_id}` : undefined,
    enabled: !!user && !!conversation,
  });

  const isLoading = convoLoading || msgsLoading;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex items-center gap-2 text-body-sm text-gray-500">
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading messages…
        </div>
      </div>
    );
  }

  if (convoError || (msgsError && messages.length === 0)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div role="alert" className="rounded bg-red-50 p-4 text-body-sm text-red-700">
          {convoError?.message ?? msgsError?.message}
        </div>
      </div>
    );
  }

  if (!conversation) return null;

  const contactName = conversation.contacts?.name
    ?? conversation.contacts?.email
    ?? conversation.contacts?.phone
    ?? 'Conversation';

  const contactEmail = conversation.contacts?.email ?? '';
  const contactInitials = contactName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Center: messages + composer */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Thread header */}
        <header className="flex items-center gap-3 border-b border-surface-border bg-white px-4 py-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary-50 text-primary text-label-md font-semibold shrink-0">
            {contactInitials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-body-md font-semibold text-gray-900 truncate">{contactName}</h2>
              <StatusBadge status={conversation.status} />
            </div>
            <p className="text-label-sm text-gray-500 truncate">
              {contactEmail}
              {conversation.subject && ` • ID: #${conversation.id.slice(0, 5)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="inline-flex items-center gap-1.5 rounded border border-surface-border bg-white px-3 py-1.5 text-body-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Assign conversation">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="5" r="2.5" /><path d="M3 13c0-2.5 1.8-4 4-4s4 1.5 4 4" />
              </svg>
              Assign
            </button>
            <button className="p-1.5 rounded hover:bg-gray-50 text-gray-500 transition-colors" aria-label="More actions">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
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
              {hasNextPage && <div ref={topSentinelRef} className="h-1" aria-hidden="true" />}
              {isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 rounded border border-surface-border bg-white px-3 py-2 text-body-sm text-gray-500">
                  <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading older messages…
                </div>
              )}
              {isFetchNextPageError && (
                <div className="rounded border border-red-100 bg-red-50 px-3 py-2 text-center text-body-sm">
                  <p role="alert" className="mb-2 text-red-700">{msgsError?.message ?? 'Could not load older messages.'}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (scrollRef.current) {
                        previousScrollHeightRef.current = scrollRef.current.scrollHeight;
                        previousScrollTopRef.current = scrollRef.current.scrollTop;
                        isPrependingRef.current = true;
                      }
                      void fetchNextPage();
                    }}
                    className="rounded border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Retry
                  </button>
                </div>
              )}
              {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            </div>
          )}
        </div>

        {/* AI draft panel */}
        <AiDraftPanel conversationId={conversationId} aiState={conversation.ai_state} />

        {/* Reply composer */}
        <ReplyComposer conversationId={conversationId} />
      </div>

      {/* Right sidebar */}
      <aside className="hidden xl:flex w-72 shrink-0 flex-col border-l border-surface-border bg-white overflow-hidden">
        <div className="flex border-b border-surface-border">
          {(['insight', 'customer', 'audit'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 py-2.5 text-label-sm font-medium text-center transition-colors border-b-2 ${
                rightTab === tab ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'insight' ? 'AI Insight' : tab === 'customer' ? 'Customer' : 'Audit'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {rightTab === 'insight' && <AiInsightPanel conversationId={conversationId} aiState={conversation.ai_state} lastMessageAt={conversation.last_message_at} />}
          {rightTab === 'customer' && <ContactDetails conversation={conversation} />}
          {rightTab === 'audit' && <div className="text-body-sm text-gray-500"><p>Audit trail will appear here.</p></div>}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Insight Panel (right sidebar) — uses React Query
// ---------------------------------------------------------------------------

function AiInsightPanel({ conversationId, aiState, lastMessageAt }: { conversationId: string; aiState: string; lastMessageAt: string | null }) {
  const { data: decision, isLoading } = useAiDecision(aiState !== 'idle' ? conversationId : undefined);

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

  const confidencePercent = decision ? Math.round(Number(decision.confidence) * 100) : null;
  const confidenceBg = confidencePercent !== null
    ? confidencePercent >= 75 ? 'bg-green-50 text-green-700'
      : confidencePercent >= 50 ? 'bg-yellow-50 text-yellow-700'
      : 'bg-red-50 text-red-700'
    : '';

  if (aiState === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="7" /><path d="M9 6v3l2 1.5" />
          </svg>
        </div>
        <p className="text-body-sm text-gray-500">No AI activity yet</p>
        <p className="text-label-sm text-gray-400 mt-1">AI insights will appear once the agent processes this conversation.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-body-sm text-gray-500">
        <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading insights…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status + Confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={statusColor}>
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            {(aiState === 'drafted' || aiState === 'auto_replied') && <path d="M4.5 7l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
            {aiState === 'needs_human' && <path d="M7 5v3M7 10h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
          </svg>
          <span className={`text-body-sm font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        {confidencePercent !== null && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-sm font-medium ${confidenceBg}`}>{confidencePercent}%</span>
        )}
      </div>

      {decision?.decision_type && (
        <div>
          <h4 className="text-label-md text-gray-700 mb-1">Decision</h4>
          <span className="inline-flex items-center rounded border border-surface-border bg-gray-50 px-2 py-0.5 text-label-sm text-gray-600 capitalize">
            {(decision.decision_type as string).replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {decision?.reasoning_summary && (
        <div>
          <h4 className="text-label-md text-gray-700 mb-1.5">Reasoning</h4>
          <div className="rounded border border-surface-border bg-gray-50 p-3">
            <p className="text-body-sm text-gray-600">{decision.reasoning_summary as string}</p>
          </div>
        </div>
      )}

      {decision?.tags && (decision.tags as string[]).length > 0 && (
        <div>
          <h4 className="text-label-md text-gray-700 mb-1.5">Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {(decision.tags as string[]).map((tag) => (
              <span key={tag} className="inline-flex items-center rounded-full bg-ai-50 px-2 py-0.5 text-label-sm text-ai-700 font-medium">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {decision?.created_at && (
        <div>
          <h4 className="text-label-md text-gray-700 mb-1">Response Time</h4>
          <p className="text-body-sm text-gray-600 font-mono">{formatResponseTime(decision.created_at as string, lastMessageAt)}</p>
        </div>
      )}

      {decision?.requires_human && (
        <div className="rounded border border-orange-200 bg-orange-50 p-2.5">
          <p className="text-body-sm text-orange-700 font-medium flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M7 5v3M7 10h.01" /><circle cx="7" cy="7" r="6" />
            </svg>
            Human review recommended
          </p>
        </div>
      )}

      {decision?.tags && (decision.tags as string[]).length > 0 && (
        <div>
          <h4 className="text-label-md text-gray-700 mb-2">Suggested Actions</h4>
          <div className="space-y-2">
            {(decision.tags as string[]).slice(0, 3).map((tag) => (
              <button key={tag} className="flex items-center justify-between w-full rounded border border-surface-border bg-white px-3 py-2 text-body-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <span>Apply &apos;{tag}&apos; tag</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                  <circle cx="7" cy="7" r="5" /><path d="M7 5v4M5 7h4" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatResponseTime(decisionCreatedAt: string, lastMessageAt: string | null): string {
  if (!lastMessageAt) return '—';
  const diffMs = new Date(decisionCreatedAt).getTime() - new Date(lastMessageAt).getTime();
  if (diffMs < 0) return '—';
  if (diffMs < 1000) return `${Math.round(diffMs)}ms`;
  const seconds = diffMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
