/**
 * MemberRepository — data access for the organization_members table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { OrganizationMember, MemberRole, CreateMemberInput } from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to an OrganizationMember entity. */
function toMember(row: MemberRow): OrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert camelCase OrganizationMember fields to snake_case for database writes. */
function toRow(fields: Partial<OrganizationMember>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.organizationId !== undefined) row.organization_id = fields.organizationId;
  if (fields.userId !== undefined) row.user_id = fields.userId;
  if (fields.role !== undefined) row.role = fields.role;
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();

  return row;
}

export class MemberRepository {
  constructor(private db: DatabaseClient) {}

  /** Find a member by organization ID and user ID. Returns null if not found. */
  async findByOrgAndUser(orgId: string, userId: string): Promise<OrganizationMember | null> {
    const { data, error } = await this.db
      .from('organization_members')
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`MemberRepository.findByOrgAndUser failed: ${error.message}`);
    }

    return data ? toMember(data as MemberRow) : null;
  }

  /** List all members for an organization. */
  async listByOrg(orgId: string): Promise<OrganizationMember[]> {
    const { data, error } = await this.db
      .from('organization_members')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`MemberRepository.listByOrg failed: ${error.message}`);
    }

    const rows = (data ?? []) as MemberRow[];
    return rows.map(toMember);
  }

  /** Create a new member record. */
  async create(input: CreateMemberInput): Promise<OrganizationMember> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      user_id: input.userId,
      role: input.role,
    };

    const { data, error } = await this.db
      .from('organization_members')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`MemberRepository.create failed: ${error.message}`);
    }

    return toMember(data as MemberRow);
  }

  /** Update an existing member by id. */
  async update(id: string, updates: Partial<OrganizationMember>): Promise<OrganizationMember> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('organization_members')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`MemberRepository.update failed: ${error.message}`);
    }

    return toMember(data as MemberRow);
  }

  /** Delete a member by id. */
  async delete(id: string): Promise<void> {
    const { error } = await this.db
      .from('organization_members')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`MemberRepository.delete failed: ${error.message}`);
    }
  }
}
