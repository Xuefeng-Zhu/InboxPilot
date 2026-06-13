'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  CONVERSATION_PAGE_SIZE,
  queryKeys,
  useOrgMembership,
  useInfiniteConversations,
  type ConversationListItem,
} from '@/lib/queries';
import { useRealtime } from '@/lib/use-realtime';
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
  const queryClient = useQueryClient();
  const scrollRootRef = useRef<HTMLElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { data: orgId, isLoading: orgLoading } = useOrgMembership(user?.id);
  const filters = {
    status: statusFilter,
    channel: channelFilter,
    contactId: contactFilter,
    search: searchQuery,
  };

  const {
    items: conversations,
    isInitialLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteConversations(
    orgId ?? undefined,
    filters,
  );

  useRealtime({
    onNewMessage: () => {
      if (!orgId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversationsInfinite(orgId, filters, CONVERSATION_PAGE_SIZE),
      });
    },
    onConversationUpdated: () => {
      if (!orgId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversationsInfinite(orgId, filters, CONVERSATION_PAGE_SIZE),
      });
    },
    messageChannel: orgId ? `org:${orgId}` : undefined,
    conversationChannel: orgId ? `org:${orgId}` : undefined,
    enabled: !!user && !!orgId,
  });

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    const sentinel = loadMoreRef.current;
    if (!scrollRoot || !sentinel || !hasNextPage || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root: scrollRoot, rootMargin: '160px 0px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (orgLoading || isInitialLoading) {
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

  if (error && conversations.length === 0) {
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
    <nav ref={scrollRootRef} aria-label="Conversation list" className="h-full overflow-y-auto">
      {conversations.map((conversation: ConversationListItem) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation as unknown as ConversationRow}
          isSelected={selectedId === conversation.id}
          onSelect={onSelect}
        />
      ))}
      {hasNextPage && <div ref={loadMoreRef} className="h-1" aria-hidden="true" />}
      {isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 border-t border-surface-border px-4 py-3 text-sm text-gray-500">
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading more…
        </div>
      )}
      {isFetchNextPageError && (
        <div className="border-t border-surface-border px-4 py-3 text-center text-sm">
          <p role="alert" className="mb-2 text-red-600">{error?.message ?? 'Could not load more conversations.'}</p>
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            className="rounded border border-surface-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Retry
          </button>
        </div>
      )}
    </nav>
  );
}
