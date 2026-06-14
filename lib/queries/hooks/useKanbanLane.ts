/**
 * useKanbanLane — per-lane React Query data hook for the 5-column kanban
 * split-inbox. One of 5 sibling hooks (one per LaneId) is mounted by the
 * `/inbox/kanban` page (Task 10).
 *
 * Perf trade-off (v1, deferred optimization for v2):
 *   We deliberately OVER-FETCH by pulling a BROADER set (status != 'resolved'
 *   AND status != 'closed', pageSize-wide window) and then filter to the
 *   single requested lane client-side via `routeToLane(c, userId) === lane`.
 *   This keeps v1 simple — no server-side lane-aware query, no 5 separate
 *   indexes on different status enums, no RPC. The cost is over-fetch when
 *   the lane distribution is skewed (e.g., a busy day mostly fills
 *   'awaiting_reply' and 'mine' but the 'escalated' lane still pays for a
 *   full page of DB reads to find a few matching rows). Acceptable for v1
 *   (≤ a few hundred active conversations per org); v2 should add a server-
 *   side lane-aware query keyed off `last_message_direction`, `ai_state`,
 *   and `status` so each lane is fetched at its natural page size.
 *
 * Cache key shape (Task 4):
 *   - Per-lane child key: ['kanban-lane', orgId, userId, lane, pageSize]
 *   - Parent key:        ['kanban-lanes', orgId, userId]
 *   React Query matches by prefix tuple, so invalidating the parent key
 *   matches all 5 lane children in a single call. Task 12's realtime wiring
 *   uses this to refresh the whole board on `conversations` channel events:
 *     queryClient.invalidateQueries({ queryKey: queryKeys.kanbanLanes(orgId, userId) })
 *   This is why `userId` is part of the child key — a user switch (or
 *   logout→login as a different user) must invalidate the lane cache
 *   automatically via the prefix match.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import {
  CONVERSATION_PAGE_SIZE,
  queryKeys,
  type ConversationListItem,
  type ConversationListRow,
  type MessageListRow,
} from '../keys';
import {
  attachLatestMessages,
  fetchLatestMessagesForConversations,
  getNextPageOffset,
  useAuthReady,
} from '../helpers';
import { routeToLane, type LaneId } from '../../../app/inbox/kanban/_lib/lane-filters';

export function useKanbanLane(
  orgId: string | undefined,
  userId: string | undefined,
  lane: LaneId,
  pageSize = CONVERSATION_PAGE_SIZE,
) {
  const authReady = useAuthReady();
  const query = useInfiniteQuery({
    queryKey: queryKeys.kanbanLane(orgId ?? '', userId ?? '', lane, pageSize),
    queryFn: async ({ pageParam }): Promise<ConversationListItem[]> => {
      const offset = pageParam;
      const { data, error } = await insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('organization_id', orgId!)
        .neq('status', 'resolved')
        .neq('status', 'closed')
        .order('last_message_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(error.message);

      const conversations = Array.isArray(data) ? data : data ? [data] : [];
      const conversationIds = conversations
        .map((conversation) => (conversation as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');
      const messageRows = await fetchLatestMessagesForConversations(conversationIds);
      const attached = attachLatestMessages(
        conversations as ConversationListRow[],
        messageRows as MessageListRow[],
      );

      // Client-side lane filter — see file header for the v1 trade-off.
      // `userId` is non-null at runtime (enabled gate below), but we
      // coalesce to `null` to match routeToLane's `string | null` contract
      // rather than lean on a non-null assertion.
      return attached.filter((c) => routeToLane(c, userId ?? null) === lane);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => getNextPageOffset(lastPage, allPages, pageSize),
    enabled: authReady && !!orgId && !!userId,
    staleTime: 30_000,
  });

  return {
    items: query.data?.pages.flat() ?? [],
    isInitialLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error as Error | null,
  };
}
