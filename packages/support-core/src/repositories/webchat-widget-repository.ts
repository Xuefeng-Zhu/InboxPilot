/**
 * WebchatWidgetRepository — data access for the webchat_widgets table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  WebchatWidget,
  CreateWebchatWidgetInput,
  UpdateWebchatWidgetInput,
} from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface WebchatWidgetRow {
  id: string;
  organization_id: string;
  name: string;
  widget_token: string;
  hmac_secret: string;
  allowed_domains: string[];
  position: 'bottom-right' | 'bottom-left';
  primary_color: string | null;
  greeting: string | null;
  pre_chat_enabled: boolean;
  ai_mode_override: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to a WebchatWidget entity. */
function toWidget(row: WebchatWidgetRow): WebchatWidget {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    widgetToken: row.widget_token,
    hmacSecret: row.hmac_secret,
    allowedDomains: row.allowed_domains,
    position: row.position,
    primaryColor: row.primary_color,
    greeting: row.greeting,
    preChatEnabled: row.pre_chat_enabled,
    aiModeOverride: row.ai_mode_override as WebchatWidget['aiModeOverride'],
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class WebchatWidgetRepository {
  constructor(private db: DatabaseClient) {}

  async findById(id: string): Promise<WebchatWidget | null> {
    const { data, error } = await this.db
      .from('webchat_widgets')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`WebchatWidgetRepository.findById failed: ${error.message}`);
    }

    return data ? toWidget(data as WebchatWidgetRow) : null;
  }

  async findByWidgetToken(token: string): Promise<WebchatWidget | null> {
    const { data, error } = await this.db
      .from('webchat_widgets')
      .select('*')
      .eq('widget_token', token)
      .maybeSingle();

    if (error) {
      throw new Error(`WebchatWidgetRepository.findByWidgetToken failed: ${error.message}`);
    }

    return data ? toWidget(data as WebchatWidgetRow) : null;
  }

  async listByOrg(orgId: string): Promise<WebchatWidget[]> {
    const { data, error } = await this.db
      .from('webchat_widgets')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`WebchatWidgetRepository.listByOrg failed: ${error.message}`);
    }

    const rows = (data ?? []) as WebchatWidgetRow[];
    return rows.map(toWidget);
  }

  async create(input: CreateWebchatWidgetInput): Promise<WebchatWidget> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      name: input.name,
      widget_token: input.widgetToken,
      hmac_secret: input.hmacSecret,
    };

    if (input.allowedDomains !== undefined) row.allowed_domains = input.allowedDomains;
    if (input.position !== undefined) row.position = input.position;
    if (input.primaryColor !== undefined) row.primary_color = input.primaryColor;
    if (input.greeting !== undefined) row.greeting = input.greeting;
    if (input.preChatEnabled !== undefined) row.pre_chat_enabled = input.preChatEnabled;
    if (input.aiModeOverride !== undefined) row.ai_mode_override = input.aiModeOverride;

    const { data, error } = await this.db
      .from('webchat_widgets')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`WebchatWidgetRepository.create failed: ${error.message}`);
    }

    return toWidget(data as WebchatWidgetRow);
  }

  async update(id: string, updates: UpdateWebchatWidgetInput): Promise<WebchatWidget> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (updates.name !== undefined) row.name = updates.name;
    if (updates.allowedDomains !== undefined) row.allowed_domains = updates.allowedDomains;
    if (updates.position !== undefined) row.position = updates.position;
    if (updates.primaryColor !== undefined) row.primary_color = updates.primaryColor;
    if (updates.greeting !== undefined) row.greeting = updates.greeting;
    if (updates.preChatEnabled !== undefined) row.pre_chat_enabled = updates.preChatEnabled;
    if (updates.aiModeOverride !== undefined) row.ai_mode_override = updates.aiModeOverride;
    if (updates.isActive !== undefined) row.is_active = updates.isActive;

    const { data, error } = await this.db
      .from('webchat_widgets')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`WebchatWidgetRepository.update failed: ${error.message}`);
    }

    return toWidget(data as WebchatWidgetRow);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db
      .from('webchat_widgets')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`WebchatWidgetRepository.delete failed: ${error.message}`);
    }
  }
}
