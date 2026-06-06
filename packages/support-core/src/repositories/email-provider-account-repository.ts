/**
 * EmailProviderAccountRepository — data access for email_provider_accounts and email_addresses tables.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  EmailProviderAccount,
  EmailAddress,
  CreateEmailProviderAccountInput,
} from '../types/index.js';

/** Raw row shape for email_provider_accounts. */
interface EmailProviderAccountRow {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  credentials_secret_id: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Raw row shape for email_addresses. */
interface EmailAddressRow {
  id: string;
  provider_account_id: string;
  organization_id: string;
  email_address: string;
  is_default: boolean;
  created_at: string;
}

/** Convert a database row to an EmailProviderAccount entity. */
function toAccount(row: EmailProviderAccountRow): EmailProviderAccount {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    label: row.label,
    credentialsSecretId: row.credentials_secret_id,
    isActive: row.is_active,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert camelCase EmailProviderAccount fields to snake_case for database writes. */
function toRow(fields: Partial<EmailProviderAccount>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.organizationId !== undefined) row.organization_id = fields.organizationId;
  if (fields.provider !== undefined) row.provider = fields.provider;
  if (fields.label !== undefined) row.label = fields.label;
  if (fields.credentialsSecretId !== undefined) row.credentials_secret_id = fields.credentialsSecretId;
  if (fields.isActive !== undefined) row.is_active = fields.isActive;
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();

  return row;
}

/** Convert a database row to an EmailAddress entity. */
function toEmailAddress(row: EmailAddressRow): EmailAddress {
  return {
    id: row.id,
    providerAccountId: row.provider_account_id,
    organizationId: row.organization_id,
    emailAddress: row.email_address,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
  };
}

export class EmailProviderAccountRepository {
  constructor(private db: DatabaseClient) {}

  /** Find all email provider accounts for an organization. */
  async findByOrg(orgId: string): Promise<EmailProviderAccount[]> {
    const { data, error } = await this.db
      .from('email_provider_accounts')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`EmailProviderAccountRepository.findByOrg failed: ${error.message}`);
    }

    const rows = (data ?? []) as EmailProviderAccountRow[];
    return rows.map(toAccount);
  }

  /** Find an email provider account by its ID. Returns null if not found. */
  async findById(id: string): Promise<EmailProviderAccount | null> {
    const { data, error } = await this.db
      .from('email_provider_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`EmailProviderAccountRepository.findById failed: ${error.message}`);
    }

    return data ? toAccount(data as EmailProviderAccountRow) : null;
  }

  /** Create a new email provider account. */
  async create(input: CreateEmailProviderAccountInput): Promise<EmailProviderAccount> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      provider: input.provider,
      label: input.label,
      credentials_secret_id: input.credentialsSecretId,
    };

    if (input.isActive !== undefined) row.is_active = input.isActive;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { data, error } = await this.db
      .from('email_provider_accounts')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`EmailProviderAccountRepository.create failed: ${error.message}`);
    }

    return toAccount(data as EmailProviderAccountRow);
  }

  /** Update an existing email provider account by id. */
  async update(id: string, updates: Partial<EmailProviderAccount>): Promise<EmailProviderAccount> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('email_provider_accounts')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`EmailProviderAccountRepository.update failed: ${error.message}`);
    }

    return toAccount(data as EmailProviderAccountRow);
  }

  /** Delete an email provider account by id. */
  async delete(id: string): Promise<void> {
    const { error } = await this.db
      .from('email_provider_accounts')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`EmailProviderAccountRepository.delete failed: ${error.message}`);
    }
  }

  /** Find the default email address for an organization (across all active accounts). */
  async findDefaultEmailAddress(orgId: string): Promise<EmailAddress | null> {
    const { data, error } = await this.db
      .from('email_addresses')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_default', true)
      .maybeSingle();

    if (error) {
      throw new Error(`EmailProviderAccountRepository.findDefaultEmailAddress failed: ${error.message}`);
    }

    return data ? toEmailAddress(data as EmailAddressRow) : null;
  }
}
