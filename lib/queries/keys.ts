export const CONVERSATION_PAGE_SIZE = 25;
export const MESSAGE_PAGE_SIZE = 50;

export type ConversationListRow = Record<string, unknown> & {
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
  last_message_direction: string | null;
  created_at: string;
  contacts: Record<string, unknown> | null;
  latest_message?: { conversation_id: string; body: string; subject: string | null; created_at: string } | null;
};

export type MessageListRow = Record<string, unknown> & {
  conversation_id?: unknown;
  created_at?: unknown;
};

export const queryKeys = {
  conversations: (orgId: string, filters?: Record<string, unknown>) =>
    ['conversations', orgId, filters] as const,
  conversationsInfinite: (orgId: string, filters?: Record<string, unknown>, pageSize = CONVERSATION_PAGE_SIZE) =>
    ['conversations', 'infinite', orgId, filters, pageSize] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  messagesInfinite: (conversationId: string, pageSize = MESSAGE_PAGE_SIZE) =>
    ['messages', 'infinite', conversationId, pageSize] as const,
  conversation: (id: string) => ['conversation', id] as const,
  contacts: (orgId: string, filters?: Record<string, unknown>) =>
    ['contacts', orgId, filters] as const,
  contact: (orgId: string, id: string) => ['contact', orgId, id] as const,
  knowledgeDocs: (orgId: string) => ['knowledge-documents', orgId] as const,
  knowledgeDoc: (orgId: string, id: string) =>
    ['knowledge-document', orgId, id] as const,
  teamMembers: (orgId: string) => ['team-members', orgId] as const,
  teamMemberInfo: (orgId: string) => ['team-member-info', orgId] as const,
  organization: (orgId: string) => ['organization', orgId] as const,
  aiDecision: (conversationId: string) => ['ai-decision', conversationId] as const,
  aiDecisionsForConversation: (conversationId: string) =>
    ['ai-decisions', conversationId] as const,
  orgMembership: (userId: string) => ['org-membership', userId] as const,
  conversationCounts: (orgId: string) => ['conversation-counts', orgId] as const,
  inboxSublineCounts: (orgId: string) => ['inbox-sublime-counts', orgId] as const,
  symphonyConversations: (orgId: string, zoom: string) =>
    ['symphony-conversations', orgId, zoom] as const,
  symphonyCounts: (orgId: string, zoom: string) =>
    ['symphony-counts', orgId, zoom] as const,
  kanbanLanes: (orgId: string, userId: string) =>
    ['kanban-lanes', orgId, userId] as const,
  auditLogs: (orgId: string, filters?: Record<string, unknown>) =>
    ['audit-logs', orgId, filters] as const,
};
