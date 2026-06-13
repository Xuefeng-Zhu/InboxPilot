import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { insforge } from './insforge';
import { useAuth } from './auth-context';

export const CONVERSATION_PAGE_SIZE = 25;
export const MESSAGE_PAGE_SIZE = 50;

type ConversationListRow = Record<string, unknown> & {
  id?: unknown;
  last_message_at?: unknown;
  created_at?: unknown;
  latest_message?: unknown;
};

export type ConversationListItem = {
  id: string;
  organization_id: string;
  contact_id: string;
  channel: string;
  status: string;
  ai_state: string;
  subject: string | null;
  assigned_to: string | null;
  last_message_at: string | null;
  created_at: string;
  contacts: Record<string, unknown> | null;
  latest_message?: { conversation_id: string; body: string; subject: string | null; created_at: string } | null;
};

type MessageListRow = Record<string, unknown> & {
  conversation_id?: unknown;
  created_at?: unknown;
};

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  conversations: (orgId: string, filters?: Record<string, unknown>) =>
    ['conversations', orgId, filters] as const,
  conversationsInfinite: (orgId: string, filters?: Record<string, unknown>, pageSize = CONVERSATION_PAGE_SIZE) =>
    ['conversations', 'infinite', orgId, filters, pageSize] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  messagesInfinite: (conversationId: string, pageSize = MESSAGE_PAGE_SIZE) =>
    ['messages', 'infinite', conversationId, pageSize] as const,
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

function getTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getConversationActivityMs(conversation: ConversationListRow): number {
  const latestMessage =
    conversation.latest_message && typeof conversation.latest_message === 'object'
      ? conversation.latest_message as MessageListRow
      : null;

  return Math.max(
    getTimestampMs(conversation.last_message_at),
    getTimestampMs(latestMessage?.created_at),
    getTimestampMs(conversation.created_at),
  );
}

export function attachLatestMessagesAndSortConversations(
  conversations: ConversationListRow[],
  messages: MessageListRow[],
) {
  const latestByConversation = new Map<string, MessageListRow>();
  for (const message of messages) {
    const conversationId = message.conversation_id;
    if (typeof conversationId === 'string' && !latestByConversation.has(conversationId)) {
      latestByConversation.set(conversationId, message);
    }
  }

  return (conversations
    .map((conversation) => {
      const conversationId = conversation.id;
      return {
        ...conversation,
        latest_message:
          typeof conversationId === 'string'
            ? latestByConversation.get(conversationId) ?? null
            : null,
      };
    })
    .sort((first, second) => getConversationActivityMs(second) - getConversationActivityMs(first)) as unknown as ConversationListItem[]);
}

/**
 * Attaches latest_message previews to conversations without re-sorting. Use this
 * for paginated data already ordered server-side (e.g. infinite-scroll pages)
 * to avoid re-sorting partial pages with message timestamps unavailable for
 * other pages.
 */
export function attachLatestMessages(
  conversations: ConversationListRow[],
  messages: MessageListRow[],
) {
  const latestByConversation = new Map<string, MessageListRow>();
  for (const message of messages) {
    const conversationId = message.conversation_id;
    if (typeof conversationId === 'string' && !latestByConversation.has(conversationId)) {
      latestByConversation.set(conversationId, message);
    }
  }

  return conversations.map((conversation) => {
    const conversationId = conversation.id;
    return {
      ...conversation,
      latest_message:
        typeof conversationId === 'string'
          ? latestByConversation.get(conversationId) ?? null
          : null,
    };
  }) as unknown as ConversationListItem[];
}

export function flattenMessagesChronologically(messagePages: MessageListRow[][]) {
  return messagePages
    .flat()
    .sort((first, second) => getTimestampMs(first.created_at) - getTimestampMs(second.created_at));
}

export function getNextPageOffset<T>(lastPage: T[], allPages: T[][], pageSize: number) {
  return lastPage.length < pageSize ? undefined : allPages.length * pageSize;
}

async function fetchLatestMessagesForConversations(conversationIds: string[]) {
  if (conversationIds.length === 0) return [];

  const { data, error } = await insforge.database
    .from('messages')
    .select('conversation_id,body,subject,created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : data ? [data] : [];
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
