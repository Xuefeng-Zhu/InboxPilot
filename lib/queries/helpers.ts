import { insforge } from '../insforge';
import { useAuth } from '../auth-context';
import type { ConversationListItem, ConversationListRow, MessageListRow } from './keys';

export function useAuthReady() {
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
      ? (conversation.latest_message as MessageListRow)
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
    .sort(
      (first, second) => getConversationActivityMs(second) - getConversationActivityMs(first),
    ) as unknown as ConversationListItem[]);
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

export async function fetchLatestMessagesForConversations(conversationIds: string[]) {
  if (conversationIds.length === 0) return [];

  const { data, error } = await insforge.database
    .from('messages')
    .select('conversation_id,body,subject,created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : data ? [data] : [];
}
