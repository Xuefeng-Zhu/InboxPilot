import { useQuery } from '@tanstack/react-query';
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
  useAuthReady,
} from '../helpers';
import { routeToLane, type LaneId } from '../../../app/inbox/kanban/_lib/lane-filters';

const MESSAGE_LOOKUP_BATCH_SIZE = 100;

async function fetchAllActiveConversations(
  orgId: string,
  pageSize: number,
): Promise<ConversationListItem[]> {
  const rows: ConversationListRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await insforge.database
      .from('conversations')
      .select('*, contacts(*)')
      .eq('organization_id', orgId)
      .neq('status', 'resolved')
      .neq('status', 'closed')
      .order('last_message_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);

    const page = (Array.isArray(data) ? data : data ? [data] : []) as ConversationListRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  const conversationIds = rows
    .map((conversation) => conversation.id)
    .filter((id): id is string => typeof id === 'string');
  const messageBatches: string[][] = [];
  for (let index = 0; index < conversationIds.length; index += MESSAGE_LOOKUP_BATCH_SIZE) {
    messageBatches.push(conversationIds.slice(index, index + MESSAGE_LOOKUP_BATCH_SIZE));
  }

  const messageRows = (
    await Promise.all(messageBatches.map(fetchLatestMessagesForConversations))
  ).flat() as MessageListRow[];

  return attachLatestMessages(rows, messageRows);
}

/**
 * All five lane observers share one complete active-conversation query. This
 * avoids both the former first-page truncation and five duplicate broad reads;
 * each observer selects only the requested lane from the shared cache entry.
 */
export function useKanbanLane(
  orgId: string | undefined,
  userId: string | undefined,
  lane: LaneId,
  pageSize = CONVERSATION_PAGE_SIZE,
) {
  const authReady = useAuthReady();
  const query = useQuery({
    queryKey: queryKeys.kanbanLanes(orgId ?? '', userId ?? ''),
    queryFn: () => fetchAllActiveConversations(orgId!, pageSize),
    select: (items) => items.filter((conversation) => routeToLane(conversation, userId ?? null) === lane),
    enabled: authReady && !!orgId && !!userId,
    staleTime: 30_000,
  });

  return {
    items: query.data ?? [],
    isInitialLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
