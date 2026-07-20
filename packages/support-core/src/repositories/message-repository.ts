/**
 * MessageRepository — data access for the messages table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  Channel,
  CreateMessageInput,
  DeliveryStatus,
  Message,
  MessageDirection,
  SenderType,
} from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  direction: MessageDirection;
  channel: Channel;
  body: string;
  subject: string | null;
  raw_payload: Record<string, unknown>;
  provider: string | null;
  provider_account_id: string | null;
  external_message_id: string | null;
  delivery_status: DeliveryStatus;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to a Message entity. */
function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    direction: row.direction,
    channel: row.channel,
    body: row.body,
    subject: row.subject,
    rawPayload: row.raw_payload,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    externalMessageId: row.external_message_id,
    deliveryStatus: row.delivery_status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Restore chronological order after a newest-first limited database query. */
export function chronologicalFromNewest<T>(items: ReadonlyArray<T>): T[] {
  return [...items].reverse();
}

export class MessageRepository {
  constructor(private db: DatabaseClient) {}

  /** Find a message by its immutable ID. */
  async findById(id: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from('messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`MessageRepository.findById failed: ${error.message}`);
    }

    return data ? toMessage(data as MessageRow) : null;
  }

  /**
   * Find a message by provider and external message ID.
   * Critical for message deduplication — queries by both provider AND external_message_id.
   * Returns null if no matching message exists.
   */
  async findByExternalId(
    provider: string,
    externalMessageId: string,
  ): Promise<Message | null> {
    const { data, error } = await this.db
      .from('messages')
      .select('*')
      .eq('provider', provider)
      .eq('external_message_id', externalMessageId)
      .maybeSingle();

    if (error) {
      throw new Error(`MessageRepository.findByExternalId failed: ${error.message}`);
    }

    return data ? toMessage(data as MessageRow) : null;
  }

  /**
   * Create a new message record.
   */
  async create(input: CreateMessageInput): Promise<Message> {
    const row: Record<string, unknown> = {
      conversation_id: input.conversationId,
      sender_type: input.senderType,
      direction: input.direction,
      channel: input.channel,
      body: input.body,
    };

    if (input.senderId !== undefined) row.sender_id = input.senderId;
    if (input.subject !== undefined) row.subject = input.subject;
    if (input.rawPayload !== undefined) row.raw_payload = input.rawPayload;
    if (input.provider !== undefined) row.provider = input.provider;
    if (input.providerAccountId !== undefined) row.provider_account_id = input.providerAccountId;
    if (input.externalMessageId !== undefined) row.external_message_id = input.externalMessageId;
    if (input.deliveryStatus !== undefined) row.delivery_status = input.deliveryStatus;

    const { data, error } = await this.db
      .from('messages')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`MessageRepository.create failed: ${error.message}`);
    }

    return toMessage(data as MessageRow);
  }

  /**
   * Update the delivery_status of a message by its ID.
   * Used when a delivery status webhook is received to reflect the latest status.
   */
  async updateDeliveryStatus(
    messageId: string,
    deliveryStatus: DeliveryStatus,
  ): Promise<Message> {
    const { data, error } = await this.db
      .from('messages')
      .update({ delivery_status: deliveryStatus, updated_at: new Date().toISOString() })
      .eq('id', messageId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`MessageRepository.updateDeliveryStatus failed: ${error.message}`);
    }

    return toMessage(data as MessageRow);
  }

  /**
   * List messages for a conversation in chronological order (created_at ASC).
   * Supports an optional limit to cap the number of returned messages.
   */
  async listByConversation(
    conversationId: string,
    limit?: number,
  ): Promise<Message[]> {
    const newestFirst = limit !== undefined;
    let query = this.db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: !newestFirst })
      .order('id', { ascending: !newestFirst });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`MessageRepository.listByConversation failed: ${error.message}`);
    }

    const rows = (data ?? []) as MessageRow[];
    const messages = rows.map(toMessage);
    return newestFirst ? chronologicalFromNewest(messages) : messages;
  }

  /** Return the latest persisted message for supersession checks. */
  async findLatestByConversation(conversationId: string): Promise<Message | null> {
    const { data, error } = await this.db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`MessageRepository.findLatestByConversation failed: ${error.message}`);
    }

    return data ? toMessage(data as MessageRow) : null;
  }

  /**
   * Return chronological context ending at an immutable source message.
   * Two bounded newest-first queries model the composite
   * `(created_at, id) <= (source.created_at, source.id)` boundary without
   * requiring a provider-specific raw filter. Reversing the combined rows
   * restores chronological order for the AI prompt.
   */
  async listByConversationThroughMessage(
    conversationId: string,
    sourceMessage: Pick<Message, 'id' | 'createdAt'>,
    limit: number,
  ): Promise<Message[]> {
    const sourceTimestamp = sourceMessage.createdAt.toISOString();
    const sameTimestampQuery = this.db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('created_at', sourceTimestamp)
      .lte('id', sourceMessage.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    const { data: sameTimestampData, error: sameTimestampError } = await sameTimestampQuery;

    if (sameTimestampError) {
      throw new Error(
        `MessageRepository.listByConversationThroughMessage failed: ${sameTimestampError.message}`,
      );
    }

    const sameTimestampRows = (sameTimestampData ?? []) as MessageRow[];
    if (!sameTimestampRows.some(({ id }) => id === sourceMessage.id)) {
      throw new Error(
        `MessageRepository.listByConversationThroughMessage source not found: ${sourceMessage.id}`,
      );
    }

    const remaining = limit - sameTimestampRows.length;
    if (remaining <= 0) {
      return chronologicalFromNewest(sameTimestampRows.map(toMessage));
    }

    const { data: earlierData, error: earlierError } = await this.db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .lt('created_at', sourceTimestamp)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(remaining);

    if (earlierError) {
      throw new Error(
        `MessageRepository.listByConversationThroughMessage failed: ${earlierError.message}`,
      );
    }

    const newestFirst = [
      ...sameTimestampRows,
      ...((earlierData ?? []) as MessageRow[]),
    ];
    return chronologicalFromNewest(newestFirst.map(toMessage));
  }
}
