'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  MESSAGE_PAGE_SIZE,
  useConversation,
  useInfiniteMessages,
  queryKeys,
} from '@/lib/queries';
import { useRealtime } from '@/lib/use-realtime';
import { MessageBubble, type MessageRow } from './MessageBubble';
import { ReplyComposer } from './ReplyComposer';
import { AiDraftPanel } from './AiDraftPanel';
import { StatusBadge, AiStateIndicator } from '@/components/ui';
import type { ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MessageThreadProps {
  conversationId: string;
  /** Returns to the conversation list on narrow layouts. */
  onBack?: () => void;
  /** Right-panel trigger — wires an external "Approve & send" to pre-fill composer. */
  onApproveAiDraft?: (text: string) => void;
  /** Toggles the right-panel drawer on <xl. */
  onToggleRightPanel?: () => void;
}

function ThreadUnavailable({
  message,
  onBack,
}: {
  message: string;
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] font-medium text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] lg:hidden"
            aria-label="Back to conversations"
          >
            <span aria-hidden="true">←</span>
            Back to conversations
          </button>
        ) : null}
        <div
          role="alert"
          className="rounded bg-[var(--m03-red-fill)] p-4 text-[13px] text-[var(--m03-red)]"
        >
          {message}
        </div>
      </div>
    </div>
  );
}

function getRealtimeConversationId(payload: Record<string, unknown>): string | null {
  const nestedMessage = payload.message;
  const message =
    nestedMessage && typeof nestedMessage === 'object'
      ? (nestedMessage as Record<string, unknown>)
      : null;

  const candidate =
    payload.conversation_id ??
    payload.conversationId ??
    message?.conversation_id ??
    message?.conversationId;

  return typeof candidate === 'string' ? candidate : null;
}

export function MessageThread({
  conversationId,
  onBack,
  onApproveAiDraft,
  onToggleRightPanel,
}: MessageThreadProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [prefillBody, setPrefillBody] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);
  const isPrependingRef = useRef(false);
  const nearBottomRef = useRef(true);
  const previousScrollHeightRef = useRef(0);
  const previousScrollTopRef = useRef(0);

  const { data: conversationData, isLoading: convoLoading, error: convoError } =
    useConversation(conversationId);
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

  // If the parent exposes an approve handler, give AiDraftPanel a way to pre-fill
  // the composer through it.
  const handlePrefillFromDraft = (text: string) => {
    if (onApproveAiDraft) {
      onApproveAiDraft(text);
    } else {
      setPrefillBody(text);
    }
  };

  useEffect(() => {
    setPrefillBody(null);
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

  useRealtime({
    onNewMessage: (payload) => {
      const realtimeConversationId = getRealtimeConversationId(payload);
      if (realtimeConversationId && realtimeConversationId !== conversationId) return;

      if (scrollRef.current) {
        nearBottomRef.current = isNearBottom(scrollRef.current);
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.messagesInfinite(conversationId, MESSAGE_PAGE_SIZE),
      });
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
        <div className="flex items-center gap-2 text-[13px] text-[var(--m03-fg-2)]">
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
      <ThreadUnavailable
        message={convoError?.message ?? msgsError?.message ?? 'Could not load conversation.'}
        onBack={onBack}
      />
    );
  }

  if (!conversation) {
    return (
      <ThreadUnavailable
        message="Conversation not found."
        onBack={onBack}
      />
    );
  }

  const contactName = conversation.contacts?.name ?? 'Conversation';
  const subject = conversation.subject ?? `${conversation.channel} conversation`;
  const channelPhone =
    conversation.channel === 'sms'
      ? conversation.contacts?.phone ?? ''
      : conversation.channel === 'email'
        ? conversation.contacts?.email ?? ''
        : conversation.channel;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Thread header */}
      <header className="flex items-center gap-2 border-b border-[var(--m03-line)] bg-white px-3 py-3 sm:gap-3 sm:px-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--m03-line)] bg-white text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] lg:hidden"
            aria-label="Back to conversations"
          >
            <span aria-hidden="true">←</span>
          </button>
        )}

        <h2 className="min-w-0 truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--m03-fg)]">
          {subject}
        </h2>

        <div className="ml-auto hidden items-center gap-3.5 font-mono text-[11px] text-[var(--m03-fg-3)] md:flex">
          <span>
            {conversation.channel.toUpperCase()}
            {channelPhone ? ` · ${channelPhone}` : ''}
          </span>
          <span>{messages.length} {messages.length === 1 ? 'message' : 'messages'}</span>
          <AiStateIndicator aiState={conversation.ai_state} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:pl-3">
          <span className="hidden sm:inline-flex">
            <StatusBadge status={conversation.status} />
          </span>
          {onToggleRightPanel && (
            <button
              type="button"
              onClick={onToggleRightPanel}
              className="ml-1 inline-flex h-7 items-center gap-1.5 rounded border border-[var(--m03-line)] bg-white px-2.5 text-[12px] font-medium text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)] xl:hidden"
              aria-label="Open contact details"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="4.5" r="2" />
                <path d="M2 11c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5" />
              </svg>
              <span className="hidden sm:inline">Contact</span>
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-white px-6 py-5"
        role="log"
        aria-label="Message history"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[var(--m03-fg-3)]">No messages yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {hasNextPage && <div ref={topSentinelRef} className="h-1" aria-hidden="true" />}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center gap-2 rounded border border-[var(--m03-line)] bg-white px-3 py-2 text-[12px] text-[var(--m03-fg-2)]">
                <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading older messages…
              </div>
            )}
            {isFetchNextPageError && (
              <div className="rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-3 py-2 text-center text-[12px]">
                <p role="alert" className="mb-2 text-[var(--m03-red)]">
                  {msgsError?.message ?? 'Could not load older messages.'}
                </p>
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
                  className="rounded border border-[var(--m03-red-line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[var(--m03-red)] hover:bg-[var(--m03-red-fill)]"
                >
                  Retry
                </button>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                contactName={conversation.contacts?.name ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inline AI draft panel */}
      <AiDraftPanel
        conversationId={conversationId}
        aiState={conversation.ai_state}
        onPrefillComposer={handlePrefillFromDraft}
      />

      {/* Reply composer */}
      <ReplyComposer
        key={conversationId}
        conversationId={conversationId}
        prefillBody={prefillBody}
        onPrefillConsumed={() => setPrefillBody(null)}
      />
    </div>
  );
}
