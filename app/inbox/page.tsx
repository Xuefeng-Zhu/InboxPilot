'use client';

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { InboxFilters, type InboxFilterState } from '@/components/inbox/InboxFilters';
import type { ConversationStatus, Channel } from '@support-core/types';

export default function InboxPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <p className="text-body-sm text-gray-500">Loading inbox…</p>
        </div>
      </AppShell>
    }>
      <InboxContent />
    </Suspense>
  );
}

function InboxContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [filters, setFilters] = useState<InboxFilterState>({
    status: (searchParams.get('status') ?? 'all') as ConversationStatus | 'all',
    channel: (searchParams.get('channel') ?? 'all') as Channel | 'all',
    search: searchParams.get('q') ?? '',
    customerId: searchParams.get('contact') ?? null,
  });

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const syncToUrl = useCallback((state: InboxFilterState) => {
    const params = new URLSearchParams();
    if (state.status !== 'all') params.set('status', state.status);
    if (state.channel !== 'all') params.set('channel', state.channel);
    if (state.search.trim()) params.set('q', state.search.trim());
    if (state.customerId) params.set('contact', state.customerId);
    const qs = params.toString();
    router.replace(`/inbox${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router]);

  const handleFilterChange = (newFilters: InboxFilterState) => {
    setFilters(newFilters);
    if (newFilters.search === filters.search) {
      syncToUrl(newFilters);
    }
  };

  const handleSearchCommit = () => {
    syncToUrl(filters);
  };

  const handleClearAll = () => {
    const cleared: InboxFilterState = {
      status: 'all',
      channel: 'all',
      search: '',
      customerId: null,
    };
    setFilters(cleared);
    router.replace('/inbox', { scroll: false });
  };

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row h-full">
        {/* Conversation List panel */}
        <div className="w-full lg:w-inbox-list-w border-b lg:border-b-0 lg:border-r border-surface-border overflow-hidden shrink-0 flex flex-col">
          <InboxFilters
            filters={filters}
            onChange={handleFilterChange}
            onSearchCommit={handleSearchCommit}
            onClearAll={handleClearAll}
          />

          <div className="flex-1 overflow-hidden">
            <ConversationList
              selectedId={selectedConversationId}
              onSelect={setSelectedConversationId}
              statusFilter={filters.status}
              channelFilter={filters.channel}
              contactFilter={filters.customerId ?? undefined}
              searchQuery={filters.search}
            />
          </div>
        </div>

        {/* Detail View */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedConversationId ? (
            <MessageThread conversationId={selectedConversationId} />
          ) : (
            <div className="flex flex-1 h-full items-center justify-center p-8">
              <div className="text-center">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg
                    className="h-6 w-6 text-gray-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                    />
                  </svg>
                </div>
                <p className="mt-3 text-body-md font-medium text-gray-500">
                  Select a conversation
                </p>
                <p className="mt-1 text-body-sm text-gray-400">
                  Choose a conversation from the list to view messages.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
