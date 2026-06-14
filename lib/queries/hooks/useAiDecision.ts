import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export function useAiDecision(conversationId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.aiDecision(conversationId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('ai_decisions')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return rows[0] ?? null;
    },
    enabled: authReady && !!conversationId,
  });
}

export function useAiDecisionsForConversation(conversationId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.aiDecisionsForConversation(conversationId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('ai_decisions')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : data ? [data] : [];
    },
    enabled: authReady && !!conversationId,
  });
}
