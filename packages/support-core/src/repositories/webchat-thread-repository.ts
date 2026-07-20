/**
 * WebchatThreadRepository — data access for the webchat_threads table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  WebchatThread,
  CreateWebchatThreadInput,
  UpdateWebchatThreadInput,
} from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface WebchatThreadRow {
  id: string;
  organization_id: string;
  widget_id: string;
  conversation_id: string;
  contact_id: string;
  visitor_token_jti: string;
  first_seen_at: string;
  last_seen_at: string;
  identified_at: string | null;
  page_url: string | null;
  referrer: string | null;
  user_agent: string | null;
  ip_country: string | null;
  ip_city: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to a WebchatThread entity. */
function toThread(row: WebchatThreadRow): WebchatThread {
  return {
    id: row.id,
    organizationId: row.organization_id,
    widgetId: row.widget_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    visitorTokenJti: row.visitor_token_jti,
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    identifiedAt: row.identified_at ? new Date(row.identified_at) : null,
    pageUrl: row.page_url,
    referrer: row.referrer,
    userAgent: row.user_agent,
    ipCountry: row.ip_country,
    ipCity: row.ip_city,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class WebchatThreadRepository {
  constructor(private db: DatabaseClient) {}

  async findById(id: string): Promise<WebchatThread | null> {
    const { data, error } = await this.db
      .from('webchat_threads')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`WebchatThreadRepository.findById failed: ${error.message}`);
    }

    return data ? toThread(data as WebchatThreadRow) : null;
  }

  async findByConversationId(conversationId: string): Promise<WebchatThread | null> {
    const { data, error } = await this.db
      .from('webchat_threads')
      .select('*')
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (error) {
      throw new Error(`WebchatThreadRepository.findByConversationId failed: ${error.message}`);
    }

    return data ? toThread(data as WebchatThreadRow) : null;
  }

  async findByVisitorJti(jti: string): Promise<WebchatThread | null> {
    const { data, error } = await this.db
      .from('webchat_threads')
      .select('*')
      .eq('visitor_token_jti', jti)
      .maybeSingle();

    if (error) {
      throw new Error(`WebchatThreadRepository.findByVisitorJti failed: ${error.message}`);
    }

    return data ? toThread(data as WebchatThreadRow) : null;
  }

  async findActiveByWidget(widgetId: string, limit = 50): Promise<WebchatThread[]> {
    const { data, error } = await this.db
      .from('webchat_threads')
      .select('*')
      .eq('widget_id', widgetId)
      .order('last_seen_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`WebchatThreadRepository.findActiveByWidget failed: ${error.message}`);
    }

    const rows = (data ?? []) as WebchatThreadRow[];
    return rows.map(toThread);
  }

  async create(input: CreateWebchatThreadInput): Promise<WebchatThread> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      widget_id: input.widgetId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      visitor_token_jti: input.visitorTokenJti,
    };

    if (input.identifiedAt !== undefined) {
      row.identified_at = input.identifiedAt
        ? input.identifiedAt.toISOString()
        : null;
    }
    if (input.pageUrl !== undefined) row.page_url = input.pageUrl;
    if (input.referrer !== undefined) row.referrer = input.referrer;
    if (input.userAgent !== undefined) row.user_agent = input.userAgent;
    if (input.ipCountry !== undefined) row.ip_country = input.ipCountry;
    if (input.ipCity !== undefined) row.ip_city = input.ipCity;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { data, error } = await this.db
      .from('webchat_threads')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`WebchatThreadRepository.create failed: ${error.message}`);
    }

    return toThread(data as WebchatThreadRow);
  }

  async update(id: string, updates: UpdateWebchatThreadInput): Promise<WebchatThread> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (updates.lastSeenAt !== undefined) row.last_seen_at = updates.lastSeenAt.toISOString();
    if (updates.identifiedAt !== undefined) {
      row.identified_at = updates.identifiedAt ? updates.identifiedAt.toISOString() : null;
    }
    if (updates.pageUrl !== undefined) row.page_url = updates.pageUrl;
    if (updates.visitorTokenJti !== undefined) row.visitor_token_jti = updates.visitorTokenJti;
    if (updates.metadata !== undefined) row.metadata = updates.metadata;

    const { data, error } = await this.db
      .from('webchat_threads')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`WebchatThreadRepository.update failed: ${error.message}`);
    }

    return toThread(data as WebchatThreadRow);
  }

  async rotateVisitorToken(threadId: string, newJti: string): Promise<WebchatThread> {
    return this.update(threadId, { visitorTokenJti: newJti });
  }
}
