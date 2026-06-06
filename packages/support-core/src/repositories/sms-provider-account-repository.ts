/**
 * SmsProviderAccountRepository — data access for sms_provider_accounts and sms_phone_numbers tables.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  SmsProviderAccount,
  SmsPhoneNumber,
  CreateSmsProviderAccountInput,
} from '../types/index.js';

/** Raw row shape for sms_provider_accounts. */
interface SmsProviderAccountRow {
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

/** Raw row shape for sms_phone_numbers. */
interface SmsPhoneNumberRow {
  id: string;
  provider_account_id: string;
  organization_id: string;
  phone_number: string;
  is_default: boolean;
  created_at: string;
}

/** Convert a database row to an SmsProviderAccount entity. */
function toAccount(row: SmsProviderAccountRow): SmsProviderAccount {
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

/** Convert camelCase SmsProviderAccount fields to snake_case for database writes. */
function toRow(fields: Partial<SmsProviderAccount>): Record<string, unknown> {
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

/** Convert a database row to an SmsPhoneNumber entity. */
function toPhoneNumber(row: SmsPhoneNumberRow): SmsPhoneNumber {
  return {
    id: row.id,
    providerAccountId: row.provider_account_id,
    organizationId: row.organization_id,
    phoneNumber: row.phone_number,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
  };
}

export class SmsProviderAccountRepository {
  constructor(private db: DatabaseClient) {}

  /** Find all SMS provider accounts for an organization. */
  async findByOrg(orgId: string): Promise<SmsProviderAccount[]> {
    const { data, error } = await this.db
      .from('sms_provider_accounts')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`SmsProviderAccountRepository.findByOrg failed: ${error.message}`);
    }

    const rows = (data ?? []) as SmsProviderAccountRow[];
    return rows.map(toAccount);
  }

  /** Find an SMS provider account by its ID. Returns null if not found. */
  async findById(id: string): Promise<SmsProviderAccount | null> {
    const { data, error } = await this.db
      .from('sms_provider_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`SmsProviderAccountRepository.findById failed: ${error.message}`);
    }

    return data ? toAccount(data as SmsProviderAccountRow) : null;
  }

  /** Create a new SMS provider account. */
  async create(input: CreateSmsProviderAccountInput): Promise<SmsProviderAccount> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      provider: input.provider,
      label: input.label,
      credentials_secret_id: input.credentialsSecretId,
    };

    if (input.isActive !== undefined) row.is_active = input.isActive;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { data, error } = await this.db
      .from('sms_provider_accounts')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`SmsProviderAccountRepository.create failed: ${error.message}`);
    }

    return toAccount(data as SmsProviderAccountRow);
  }

  /** Update an existing SMS provider account by id. */
  async update(id: string, updates: Partial<SmsProviderAccount>): Promise<SmsProviderAccount> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('sms_provider_accounts')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`SmsProviderAccountRepository.update failed: ${error.message}`);
    }

    return toAccount(data as SmsProviderAccountRow);
  }

  /** Delete an SMS provider account by id. */
  async delete(id: string): Promise<void> {
    const { error } = await this.db
      .from('sms_provider_accounts')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`SmsProviderAccountRepository.delete failed: ${error.message}`);
    }
  }

  /** Find the default phone number for an organization (across all active accounts). */
  async findDefaultPhoneNumber(orgId: string): Promise<SmsPhoneNumber | null> {
    const { data, error } = await this.db
      .from('sms_phone_numbers')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_default', true)
      .maybeSingle();

    if (error) {
      throw new Error(`SmsProviderAccountRepository.findDefaultPhoneNumber failed: ${error.message}`);
    }

    return data ? toPhoneNumber(data as SmsPhoneNumberRow) : null;
  }
}
