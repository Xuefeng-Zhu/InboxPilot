import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';
import { useAuth } from '@/lib/auth-context';
import { useOrgMembership } from './useOrganization';

export function useKnowledgeDocs() {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  return useQuery({
    queryKey: queryKeys.knowledgeDocs(orgId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('knowledge_documents')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady && !!orgId,
    staleTime: 0,
  });
}

export function useKnowledgeDoc(docId: string | undefined) {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  return useQuery({
    queryKey: queryKeys.knowledgeDoc(orgId ?? '', docId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('knowledge_documents')
        .select('*')
        .eq('id', docId!)
        .eq('organization_id', orgId!)
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    enabled: authReady && !!orgId && !!docId,
  });
}
