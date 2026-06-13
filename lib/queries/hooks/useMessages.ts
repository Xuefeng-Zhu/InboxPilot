import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { MESSAGE_PAGE_SIZE, queryKeys, type MessageListRow } from '../keys';
import { flattenMessagesChronologically, getNextPageOffset, useAuthReady } from '../helpers';

export function useMessages(conversationId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.messages(conversationId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : data ? [data] : [];
    },
    enabled: authReady && !!conversationId,
  });
}

export function useInfiniteMessages(
  conversationId: string | undefined,
  pageSize = MESSAGE_PAGE_SIZE,
) {
  const authReady = useAuthReady();
  const query = useInfiniteQuery({
    queryKey: queryKeys.messagesInfinite(conversationId ?? '', pageSize),
    queryFn: async ({ pageParam }): Promise<MessageListRow[]> => {
      const offset = pageParam;
      const { data, error } = await insforge.database
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : data ? [data] : [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => getNextPageOffset(lastPage, allPages, pageSize),
    enabled: authReady && !!conversationId,
  });

  return {
    ...query,
    items: flattenMessagesChronologically(query.data?.pages ?? []),
    isInitialLoading: query.isLoading,
  };
}
