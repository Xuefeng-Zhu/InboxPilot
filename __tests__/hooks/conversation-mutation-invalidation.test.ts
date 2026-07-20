import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateConversationMutationCaches } from '@/lib/queries/invalidation';
import { queryKeys } from '@/lib/queries/keys';

describe('invalidateConversationMutationCaches', () => {
  it('invalidates the selected thread and every derived conversation view', async () => {
    const queryClient = new QueryClient();
    const conversationId = 'conversation-1';
    const affectedKeys = [
      queryKeys.conversation(conversationId),
      queryKeys.messages(conversationId),
      queryKeys.messagesInfinite(conversationId, 25),
      queryKeys.aiDecision(conversationId),
      queryKeys.aiDecisionsForConversation(conversationId),
      queryKeys.conversations('org-1'),
      queryKeys.conversationsInfinite('org-1'),
      queryKeys.conversationCounts('org-1'),
      queryKeys.inboxSublineCounts('org-1'),
      queryKeys.kanbanLanes('org-1', 'member-1'),
      queryKeys.symphonyConversations('org-1', 'day:0'),
      queryKeys.symphonyCounts('org-1', 'day:0'),
    ] as const;
    const unrelatedKey = queryKeys.contacts('org-1');

    for (const key of affectedKeys) {
      queryClient.setQueryData(key, { cached: true });
    }
    queryClient.setQueryData(unrelatedKey, { cached: true });

    await invalidateConversationMutationCaches(queryClient, conversationId);

    for (const key of affectedKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it('preserves a recovered AI decision while refreshing conversation state', async () => {
    const queryClient = new QueryClient();
    const conversationId = 'conversation-1';
    const conversationKey = queryKeys.conversation(conversationId);
    const decisionKey = queryKeys.aiDecision(conversationId);
    const decisionHistoryKey = queryKeys.aiDecisionsForConversation(conversationId);

    queryClient.setQueryData(conversationKey, { ai_state: 'thinking' });
    queryClient.setQueryData(decisionKey, { id: 'decision-2' });
    queryClient.setQueryData(decisionHistoryKey, [{ id: 'decision-2' }]);

    await invalidateConversationMutationCaches(queryClient, conversationId, {
      preserveAiDecisions: true,
    });

    expect(queryClient.getQueryState(conversationKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(decisionKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(decisionHistoryKey)?.isInvalidated).toBe(false);
  });
});
