/**
 * ConversationRepository — data access for the conversations table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  Channel,
  Conversation,
  ConversationFilters,
  ConversationStatus,
  AiState,
  CreateConversationInput,
} from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface ConversationRow {
  id: string;
  organization_id: string;
  contact_id: string;
  channel: Channel;
  status: ConversationStatus;
  ai_state: AiState;
  subject: string | null;
  assigned_to: string | null;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to a Conversation entity. */
function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    channel: row.channel,
    status: row.status,
    aiState: row.ai_state,
    subject: row.subject,
    assignedTo: row.assigned_to,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert camelCase Conversation fields to snake_case for database writes. */
function toRow(fields: Partial<Conversation>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.organizationId !== undefined) row.organization_id = fields.organizationId;
  if (fields.contactId !== undefined) row.contact_id = fields.contactId;
  if (fields.channel !== undefined) row.channel = fields.channel;
  if (fields.status !== undefined) row.status = fields.status;
  if (fields.aiState !== undefined) row.ai_state = fields.aiState;
  if (fields.subject !== undefined) row.subject = fields.subject;
  if (fields.assignedTo !== undefined) row.assigned_to = fields.assignedTo;
  if (fields.lastMessageAt !== undefined) {
    row.last_message_at = fields.lastMessageAt ? fields.lastMessageAt.toISOString() : null;
  }
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();

  return row;
}

export class ConversationRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Find a conversation by its ID.
   * Returns null if no conversation exists with the given ID.
   */
  async findById(id: string): Promise<Conversation | null> {
    const { data, error } = await this.db
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`ConversationRepository.findById failed: ${error.message}`);
    }

    return data ? toConversation(data as ConversationRow) : null;
  }

  /**
   * Find an open conversation for a given contact and channel.
   * Returns null if no open conversation exists.
   */
  async findOpenByContactAndChannel(
    contactId: string,
    channel: Channel,
  ): Promise<Conversation | null> {
    const { data, error } = await this.db
      .from('conversations')
      .select('*')
      .eq('contact_id', contactId)
      .eq('channel', channel)
      .eq('status', 'open')
      .maybeSingle();

    if (error) {
      throw new Error(
        `ConversationRepository.findOpenByContactAndChannel failed: ${error.message}`,
      );
    }

    return data ? toConversation(data as ConversationRow) : null;
  }

  /**
   * Create a new conversation record.
   */
  async create(input: CreateConversationInput): Promise<Conversation> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      contact_id: input.contactId,
      channel: input.channel,
    };

    if (input.status !== undefined) row.status = input.status;
    if (input.aiState !== undefined) row.ai_state = input.aiState;
    if (input.subject !== undefined) row.subject = input.subject;

    const { data, error } = await this.db
      .from('conversations')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`ConversationRepository.create failed: ${error.message}`);
    }

    return toConversation(data as ConversationRow);
  }

  /**
   * Update an existing conversation by id.
   * Only the provided fields are updated; updated_at is set automatically.
   */
  async update(id: string, updates: Partial<Conversation>): Promise<Conversation> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('conversations')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`ConversationRepository.update failed: ${error.message}`);
    }

    return toConversation(data as ConversationRow);
  }

  /**
   * List conversations for an organization with optional filters.
   * Supports filtering by status, channel, assignedTo, and pagination (limit/offset).
   * Results are ordered by last_message_at DESC.
   */
  async listByOrg(
    orgId: string,
    filters: ConversationFilters = {},
  ): Promise<Conversation[]> {
    let query = this.db
      .from('conversations')
      .select('*')
      .eq('organization_id', orgId);

    if (filters.status !== undefined) {
      query = query.eq('status', filters.status);
    }

    if (filters.channel !== undefined) {
      query = query.eq('channel', filters.channel);
    }

    if (filters.assignedTo !== undefined) {
      query = query.eq('assigned_to', filters.assignedTo);
    }

    query = query.order('last_message_at', { ascending: false });

    if (filters.limit !== undefined) {
      query = query.limit(filters.limit);
    }

    if (filters.offset !== undefined && filters.limit !== undefined) {
      query = query.range(filters.offset, filters.offset + filters.limit - 1);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`ConversationRepository.listByOrg failed: ${error.message}`);
    }

    const rows = (data ?? []) as ConversationRow[];
    return rows.map(toConversation);
  }
}
