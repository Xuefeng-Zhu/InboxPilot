import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export function useKnowledgeDocs() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.knowledgeDocs(),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('knowledge_documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady,
    staleTime: 0,
  });
}

export function useKnowledgeDoc(docId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.knowledgeDoc(docId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('knowledge_documents')
        .select('*')
        .eq('id', docId!)
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    enabled: authReady && !!docId,
  });
}
