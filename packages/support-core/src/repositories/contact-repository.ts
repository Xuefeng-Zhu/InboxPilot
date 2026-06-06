/**
 * ContactRepository — data access for the contacts table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { Contact, CreateContactInput } from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface ContactRow {
  id: string;
  organization_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to a Contact entity. */
function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert camelCase Contact fields to snake_case for database writes. */
function toRow(fields: Partial<Contact>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.organizationId !== undefined) row.organization_id = fields.organizationId;
  if (fields.name !== undefined) row.name = fields.name;
  if (fields.email !== undefined) row.email = fields.email;
  if (fields.phone !== undefined) row.phone = fields.phone;
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();

  return row;
}

export class ContactRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Find a contact by its ID.
   * Returns null if no contact exists with the given ID.
   */
  async findById(id: string): Promise<Contact | null> {
    const { data, error } = await this.db
      .from('contacts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`ContactRepository.findById failed: ${error.message}`);
    }

    return data ? toContact(data as ContactRow) : null;
  }

  /**
   * Find a contact by phone number within an organization.
   * Returns null if no matching contact exists.
   */
  async findByPhone(orgId: string, phone: string): Promise<Contact | null> {
    const { data, error } = await this.db
      .from('contacts')
      .select('*')
      .eq('organization_id', orgId)
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      throw new Error(`ContactRepository.findByPhone failed: ${error.message}`);
    }

    return data ? toContact(data as ContactRow) : null;
  }

  /**
   * Find a contact by email address within an organization.
   * Returns null if no matching contact exists.
   */
  async findByEmail(orgId: string, email: string): Promise<Contact | null> {
    const { data, error } = await this.db
      .from('contacts')
      .select('*')
      .eq('organization_id', orgId)
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new Error(`ContactRepository.findByEmail failed: ${error.message}`);
    }

    return data ? toContact(data as ContactRow) : null;
  }

  /**
   * Create a new contact record.
   */
  async create(input: CreateContactInput): Promise<Contact> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
    };

    if (input.name !== undefined) row.name = input.name;
    if (input.email !== undefined) row.email = input.email;
    if (input.phone !== undefined) row.phone = input.phone;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { data, error } = await this.db
      .from('contacts')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`ContactRepository.create failed: ${error.message}`);
    }

    return toContact(data as ContactRow);
  }

  /**
   * Update an existing contact by id.
   * Only the provided fields are updated; updated_at is set automatically by the caller
   * or can be set here for consistency.
   */
  async update(id: string, updates: Partial<Contact>): Promise<Contact> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('contacts')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`ContactRepository.update failed: ${error.message}`);
    }

    return toContact(data as ContactRow);
  }
}
