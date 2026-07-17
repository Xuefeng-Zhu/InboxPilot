/**
 * AuditLogRepository — data access for the audit_logs table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 *
 * This repository is append-only: no update or delete methods are provided.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { AuditLog, ActorType, CreateAuditLogInput } from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface AuditLogRow {
  id: string;
  organization_id: string;
  actor_id: string | null;
  actor_type: ActorType;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Convert a database row to an AuditLog entity. */
function toAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
  };
}

export class AuditLogRepository {
  constructor(private db: DatabaseClient) {}

  /** Create a new audit log entry. This is the only write operation — append-only. */
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      actor_type: input.actorType,
      action: input.action,
      resource_type: input.resourceType,
    };

    if (input.actorId !== undefined) row.actor_id = input.actorId;
    if (input.resourceId !== undefined) row.resource_id = input.resourceId;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { data, error } = await this.db
      .from('audit_logs')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`AuditLogRepository.create failed: ${error.message}`);
    }

    return toAuditLog(data as AuditLogRow);
  }

  /** Check whether an append-only action has already been recorded. */
  async existsForActionResource(
    organizationId: string,
    action: string,
    resourceType: string,
    resourceId: string,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from('audit_logs')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('action', action)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`AuditLogRepository.existsForActionResource failed: ${error.message}`);
    }

    return data !== null && data !== undefined;
  }

  /**
   * Atomically ensure the one message_received audit row for an inbound
   * message. The database RPC serializes concurrent provider retries so this
   * repair path stays append-only without duplicate audit entries.
   */
  async ensureMessageReceived(
    organizationId: string,
    messageId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await this.db.rpc('ensure_message_received_audit', {
      p_organization_id: organizationId,
      p_message_id: messageId,
      p_metadata: metadata,
    });
    if (error) {
      throw new Error(`AuditLogRepository.ensureMessageReceived failed: ${error.message}`);
    }
  }
}
