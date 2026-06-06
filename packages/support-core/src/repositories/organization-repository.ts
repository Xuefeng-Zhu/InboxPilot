/**
 * OrganizationRepository — data access for the organizations table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { Organization, CreateOrganizationInput } from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to an Organization entity. */
function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert camelCase Organization fields to snake_case for database writes. */
function toRow(fields: Partial<Organization>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.name !== undefined) row.name = fields.name;
  if (fields.slug !== undefined) row.slug = fields.slug;
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();

  return row;
}

export class OrganizationRepository {
  constructor(private db: DatabaseClient) {}

  /** Find an organization by its ID. Returns null if not found. */
  async findById(id: string): Promise<Organization | null> {
    const { data, error } = await this.db
      .from('organizations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`OrganizationRepository.findById failed: ${error.message}`);
    }

    return data ? toOrganization(data as OrganizationRow) : null;
  }

  /** Find an organization by its unique slug. Returns null if not found. */
  async findBySlug(slug: string): Promise<Organization | null> {
    const { data, error } = await this.db
      .from('organizations')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      throw new Error(`OrganizationRepository.findBySlug failed: ${error.message}`);
    }

    return data ? toOrganization(data as OrganizationRow) : null;
  }

  /** Create a new organization record. */
  async create(input: CreateOrganizationInput): Promise<Organization> {
    const row: Record<string, unknown> = {
      name: input.name,
      slug: input.slug,
    };

    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { data, error } = await this.db
      .from('organizations')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`OrganizationRepository.create failed: ${error.message}`);
    }

    return toOrganization(data as OrganizationRow);
  }

  /** Update an existing organization by id. */
  async update(id: string, updates: Partial<Organization>): Promise<Organization> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('organizations')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`OrganizationRepository.update failed: ${error.message}`);
    }

    return toOrganization(data as OrganizationRow);
  }

  /** Delete an organization by id. */
  async delete(id: string): Promise<void> {
    const { error } = await this.db
      .from('organizations')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`OrganizationRepository.delete failed: ${error.message}`);
    }
  }
}
