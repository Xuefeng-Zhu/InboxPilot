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
  options: {
    preserveAiDecisions?: boolean;
    throwOnConversationError?: boolean;
  } = {},
): Promise<void> {
  const queryKeysToInvalidate: QueryKey[] = [
    queryKeys.messages(conversationId),
    queryKeys.messagesInfinite(conversationId).slice(0, 3),
    rootPrefix(queryKeys.conversations('')),
    rootPrefix(queryKeys.conversationCounts('')),
    rootPrefix(queryKeys.inboxSublineCounts('')),
    rootPrefix(queryKeys.kanbanLanes('', '')),
    rootPrefix(queryKeys.symphonyConversations('', '')),
    rootPrefix(queryKeys.symphonyCounts('', '')),
  ];

  if (!options.preserveAiDecisions) {
    queryKeysToInvalidate.push(
      queryKeys.aiDecision(conversationId),
      queryKeys.aiDecisionsForConversation(conversationId),
    );
  }

  await Promise.all(
    [
      queryClient.invalidateQueries(
        { queryKey: queryKeys.conversation(conversationId) },
        { throwOnError: options.throwOnConversationError },
      ),
      ...queryKeysToInvalidate.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    ],
  );
}
