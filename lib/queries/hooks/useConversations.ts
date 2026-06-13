import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { CONVERSATION_PAGE_SIZE, queryKeys, type ConversationListItem, type ConversationListRow, type MessageListRow } from '../keys';
import {
  attachLatestMessages,
  attachLatestMessagesAndSortConversations,
  fetchLatestMessagesForConversations,
  getNextPageOffset,
  useAuthReady,
} from '../helpers';

export function useConversations(
  orgId: string | undefined,
  filters?: { status?: string; channel?: string; contactId?: string; search?: string },
) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.conversations(orgId ?? '', filters),
    queryFn: async () => {
      let query = insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('organization_id', orgId!);

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      } else {
        query = query.neq('status', 'resolved');
      }

      if (filters?.channel && filters.channel !== 'all') {
        query = query.eq('channel', filters.channel);
      }

      if (filters?.contactId) {
        query = query.eq('contact_id', filters.contactId);
      }

      if (filters?.search?.trim()) {
        query = query.ilike('subject', `%${filters.search.trim()}%`);
      }

      query = query.order('last_message_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const conversations = Array.isArray(data) ? data : data ? [data] : [];
      const conversationIds = conversations
        .map((conversation) => (conversation as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');

      if (conversationIds.length === 0) {
        return conversations;
      }

      const messageRows = await fetchLatestMessagesForConversations(conversationIds);

      return attachLatestMessagesAndSortConversations(
        conversations as ConversationListRow[],
        messageRows as MessageListRow[],
      );
    },
    enabled: authReady && !!orgId,
  });
}

export function useInfiniteConversations(
  orgId: string | undefined,
  filters?: { status?: string; channel?: string; contactId?: string; search?: string },
  pageSize = CONVERSATION_PAGE_SIZE,
) {
  const authReady = useAuthReady();
  const query = useInfiniteQuery({
    queryKey: queryKeys.conversationsInfinite(orgId ?? '', filters, pageSize),
    queryFn: async ({ pageParam }): Promise<ConversationListItem[]> => {
      const offset = pageParam;
      let dbQuery = insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('organization_id', orgId!);

      if (filters?.status && filters.status !== 'all') {
        dbQuery = dbQuery.eq('status', filters.status);
      } else {
        dbQuery = dbQuery.neq('status', 'resolved');
      }

      if (filters?.channel && filters.channel !== 'all') {
        dbQuery = dbQuery.eq('channel', filters.channel);
      }

      if (filters?.contactId) {
        dbQuery = dbQuery.eq('contact_id', filters.contactId);
      }

      if (filters?.search?.trim()) {
        dbQuery = dbQuery.ilike('subject', `%${filters.search.trim()}%`);
      }

      const { data, error } = await dbQuery
        .order('last_message_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(error.message);

      const conversations = Array.isArray(data) ? data : data ? [data] : [];
      const conversationIds = conversations
        .map((conversation) => (conversation as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');
      const messageRows = await fetchLatestMessagesForConversations(conversationIds);

      return attachLatestMessages(
        conversations as ConversationListRow[],
        messageRows as MessageListRow[],
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => getNextPageOffset(lastPage, allPages, pageSize),
    enabled: authReady && !!orgId,
  });

  return {
    ...query,
    items: query.data?.pages.flat() ?? [],
    isInitialLoading: query.isLoading,
  };
}

export function useConversation(conversationId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.conversation(conversationId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('conversations')
        .select('*, contacts(*)')
        .eq('id', conversationId!)
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    enabled: authReady && !!conversationId,
  });
}
