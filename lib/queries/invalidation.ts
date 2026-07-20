import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { queryKeys } from './keys';

function rootPrefix(key: readonly unknown[]): QueryKey {
  return key.slice(0, 1);
}

/**
 * Invalidate direct thread data plus every derived view affected by an
 * outbound reply or approved AI draft.
 */
export async function invalidateConversationMutationCaches(
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  const queryKeysToInvalidate: QueryKey[] = [
    queryKeys.conversation(conversationId),
    queryKeys.messages(conversationId),
    queryKeys.messagesInfinite(conversationId).slice(0, 3),
    queryKeys.aiDecision(conversationId),
    queryKeys.aiDecisionsForConversation(conversationId),
    rootPrefix(queryKeys.conversations('')),
    rootPrefix(queryKeys.conversationCounts('')),
    rootPrefix(queryKeys.inboxSublineCounts('')),
    rootPrefix(queryKeys.kanbanLanes('', '')),
    rootPrefix(queryKeys.symphonyConversations('', '')),
    rootPrefix(queryKeys.symphonyCounts('', '')),
  ];

  await Promise.all(
    queryKeysToInvalidate.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
