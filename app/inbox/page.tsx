'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import { RightPanel } from '@/components/inbox/RightPanel';
import { InboxFilters, type InboxFilterState } from '@/components/inbox/InboxFilters';
import { useOrgMembership, queryKeys } from '@/lib/queries';
import { useAuth } from '@/lib/auth-context';
import { insforge } from '@/lib/insforge';
import type { ConversationStatus, Channel } from '@support-core/types';

export default function InboxPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[var(--m03-fg-2)]">Loading inbox…</p>
          </div>
        </AppShell>
      }
    >
      <InboxContent />
    </Suspense>
  );
}

function InboxContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const statusFromUrl = (searchParams.get('status') ?? 'all') as ConversationStatus | 'all';
  const channelFromUrl = (searchParams.get('channel') ?? 'all') as Channel | 'all';
  const searchFromUrl = searchParams.get('q') ?? '';
  const customerFromUrl = searchParams.get('contact');

  const [filters, setFilters] = useState<InboxFilterState>({
    status: statusFromUrl,
    channel: channelFromUrl,
    search: searchFromUrl,
    customerId: customerFromUrl,
  });

  const selectedConversationFromUrl = searchParams.get('conversation');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    selectedConversationFromUrl,
  );
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);

  const { data: orgId } = useOrgMembership(user?.id);

  // Counts shown in the inbox filters subline
  const { data: counts } = useQuery({
    // Use a distinct cache key from the Sidebar's `conversationCounts` so the
    // Sidebar's `{ inbox, mentions, escalated }` payload does not bleed into
    // this query's `{ total, escalated, drafted }` shape (the prior collision
    // produced "undefined conversations · N escalated · undefined AI drafted").
    queryKey: queryKeys.inboxSublineCounts(orgId ?? ''),
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return { total: 0, escalated: 0, drafted: 0 };
      const build = () =>
        insforge.database
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId);
      const [r1, r2, r3] = await Promise.all([
        build(),
        build().eq('status', 'escalated'),
        build().eq('ai_state', 'drafted'),
      ]);
      // Defensive: `count` is typed `number | null` by the SDK but defensive
      // coercion handles any future shape change. Falls back to data.length
      // when the SDK does not populate `count` (matches the precedent in
      // app/knowledge/[id]/page.tsx:53-57).
      const readCount = (
        r: { count: number | null; data: unknown },
      ): number => {
        if (typeof r.count === 'number') return r.count;
        return Array.isArray(r.data) ? r.data.length : 0;
      };
      return {
        total: readCount(r1),
        escalated: readCount(r2),
        drafted: readCount(r3),
      };
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    setSelectedConversationId(selectedConversationFromUrl);
    setRightDrawerOpen(false);
  }, [selectedConversationFromUrl]);

  useEffect(() => {
    setFilters({
      status: statusFromUrl,
      channel: channelFromUrl,
      search: searchFromUrl,
      customerId: customerFromUrl,
    });
  }, [channelFromUrl, customerFromUrl, searchFromUrl, statusFromUrl]);

  const syncToUrl = useCallback(
    (state: InboxFilterState, conversationId: string | null) => {
      const params = new URLSearchParams();
      if (state.status !== 'all') params.set('status', state.status);
      if (state.channel !== 'all') params.set('channel', state.channel);
      if (state.search.trim()) params.set('q', state.search.trim());
      if (state.customerId) params.set('contact', state.customerId);
      if (conversationId) params.set('conversation', conversationId);
      const qs = params.toString();
      router.replace(`/inbox${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [router],
  );

  const handleFilterChange = (newFilters: InboxFilterState) => {
    setFilters(newFilters);
    if (newFilters.search === filters.search) {
      syncToUrl(newFilters, selectedConversationId);
    }
  };

  const handleSearchCommit = () => {
    syncToUrl(filters, selectedConversationId);
  };

  const handleClearAll = () => {
    const cleared: InboxFilterState = {
      status: 'all',
      channel: 'all',
      search: '',
      customerId: null,
    };
    setFilters(cleared);
    syncToUrl(cleared, selectedConversationId);
  };

  const handleConversationSelect = (conversationId: string | null) => {
    setSelectedConversationId(conversationId);
    setRightDrawerOpen(false);
    syncToUrl(filters, conversationId);
  };

  return (
    <AppShell noPadding>
      <div className="flex h-full min-h-0 flex-1">
        {/* Conversation List panel — 340px per mock */}
        <div
          className={`${
            selectedConversationId ? 'hidden lg:flex' : 'flex'
          } w-full shrink-0 flex-col overflow-hidden border-r border-[var(--m03-line)] lg:w-inbox-list-w`}
        >
          <InboxFilters
            filters={filters}
            counts={counts}
            onChange={handleFilterChange}
            onSearchCommit={handleSearchCommit}
            onClearAll={handleClearAll}
          />

          <div className="min-h-0 flex-1 overflow-hidden">
            <ConversationList
              selectedId={selectedConversationId}
              onSelect={handleConversationSelect}
              statusFilter={filters.status}
              channelFilter={filters.channel}
              contactFilter={filters.customerId ?? undefined}
              searchQuery={filters.search}
            />
          </div>
        </div>

        {/* Detail View */}
        <div
          className={`${
            selectedConversationId ? 'flex' : 'hidden lg:flex'
          } min-w-0 flex-1 flex-col overflow-hidden`}
        >
          {selectedConversationId ? (
            <MessageThread
              key={selectedConversationId}
              conversationId={selectedConversationId}
              onBack={() => handleConversationSelect(null)}
              onToggleRightPanel={() => setRightDrawerOpen((v) => !v)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--m03-line-2)]">
                  <svg
                    className="h-6 w-6 text-[var(--m03-fg-3)]"
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
                <p className="mt-3 text-[14px] font-medium text-[var(--m03-fg-2)]">
                  Select a conversation
                </p>
                <p className="mt-1 text-[12px] text-[var(--m03-fg-3)]">
                  Choose a conversation from the list to view messages.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right panel (inline at >=xl) */}
        {selectedConversationId && (
          <div className="hidden xl:block">
            <RightPanel conversationId={selectedConversationId} />
          </div>
        )}

        {/* Right panel drawer (<xl) */}
        {selectedConversationId && (
          <div className="xl:hidden">
            <RightPanel
              conversationId={selectedConversationId}
              open={rightDrawerOpen}
              onClose={() => setRightDrawerOpen(false)}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
