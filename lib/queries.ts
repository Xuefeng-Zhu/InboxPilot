import { useQuery } from '@tanstack/react-query';
import { insforge } from './insforge';
import { useAuth } from './auth-context';

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  conversations: (orgId: string, filters?: Record<string, unknown>) =>
    ['conversations', orgId, filters] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  conversation: (id: string) => ['conversation', id] as const,
  contacts: (filters?: Record<string, unknown>) => ['contacts', filters] as const,
  contact: (id: string) => ['contact', id] as const,
  knowledgeDocs: () => ['knowledge-documents'] as const,
  knowledgeDoc: (id: string) => ['knowledge-document', id] as const,
  teamMembers: () => ['team-members'] as const,
  aiDecision: (conversationId: string) => ['ai-decision', conversationId] as const,
  orgMembership: (userId: string) => ['org-membership', userId] as const,
};

// ---------------------------------------------------------------------------
// Auth-aware helper
// ---------------------------------------------------------------------------

/** Returns true when auth has finished loading and a user is present. */
function useAuthReady() {
  const { user, loading } = useAuth();
  return !loading && !!user;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useOrgMembership(userId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.orgMembership(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId!)
        .limit(1);

      if (error) throw new Error(error.message);
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      if (arr.length === 0) return null;
      return (arr[0] as { organization_id: string }).organization_id;
    },
    enabled: authReady && !!userId,
  });
}

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
      return Array.isArray(data) ? data : data ? [data] : [];
    },
    enabled: authReady && !!orgId,
  });
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

export function useContacts(filters?: { search?: string; channel?: string }) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.contacts(filters),
    queryFn: async () => {
      let query = insforge.database
        .from('contacts')
        .select('id,name,email,phone,created_at,updated_at')
        .order('created_at', { ascending: false });

      if (filters?.search?.trim()) {
        query = query.ilike('name', `%${filters.search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady,
  });
}

export function useContact(contactId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.contact(contactId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('contacts')
        .select('id,name,email,phone')
        .eq('id', contactId!)
        .limit(1);

      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return (rows[0] as { id: string; name: string | null; email: string | null; phone: string | null }) ?? null;
    },
    enabled: authReady && !!contactId,
  });
}

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

export function useTeamMembers() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.teamMembers(),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('organization_members')
        .select()
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady,
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
