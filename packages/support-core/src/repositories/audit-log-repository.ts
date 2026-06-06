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
}
