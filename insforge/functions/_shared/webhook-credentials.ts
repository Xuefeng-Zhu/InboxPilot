import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';
import { getSecret } from './insforge-secrets.ts';

interface ProviderAccountRow {
  id: string;
  organization_id: string;
  provider: string;
  credentials_secret_id: string;
  is_active: boolean;
}

interface SmsPhoneRouteRow {
  provider_account_id: string;
  organization_id: string;
}

interface EmailAddressRouteRow {
  provider_account_id: string;
  organization_id: string;
}

interface MessageProviderAccountRow {
  provider_account_id: string | null;
}

export interface WebhookAccountContext {
  organizationId: string;
  providerAccountId: string;
  signingSecret: string;
}

export function requestHeadersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function parseSmsWebhookBody(rawBody: string, provider: string): unknown {
  if (provider === 'twilio') {
    return rawBody;
  }
  return JSON.parse(rawBody);
}

export function parseEmailWebhookBody(rawBody: string): unknown {
  return JSON.parse(rawBody);
}

export function getWebhookSigningSecret(
  channel: 'sms' | 'email',
  provider: string,
  credentials: Record<string, unknown>,
): string | null {
  if (provider === 'mock') {
    return '';
  }

  if (channel === 'sms' && provider === 'twilio') {
    return stringField(credentials, 'authToken');
  }

  if (channel === 'sms' && provider === 'telnyx') {
    return firstStringField(credentials, [
      'webhookPublicKey',
      'webhookSigningPublicKey',
      'signingPublicKey',
      'publicKey',
    ]);
  }

  if (channel === 'email' && provider === 'postmark') {
    return firstStringField(credentials, ['serverToken', 'webhookToken']);
  }

  return null;
}

export async function resolveSmsInboundWebhookContext(
  db: DatabaseClient,
  provider: string,
  toPhoneNumber: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const route = await findSmsPhoneRoute(db, toPhoneNumber);
  if (!route) {
    return null;
  }

  if (provider === 'mock') {
    return {
      organizationId: route.organization_id,
      providerAccountId: route.provider_account_id,
      signingSecret: '',
    };
  }

  return resolveSmsProviderAccount(
    db,
    provider,
    route.provider_account_id,
    baseUrl,
    serviceRoleKey,
  );
}

export async function resolveEmailInboundWebhookContext(
  db: DatabaseClient,
  provider: string,
  toEmailAddress: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const route = await findEmailAddressRoute(db, toEmailAddress);
  if (!route) {
    return null;
  }

  if (provider === 'mock') {
    return {
      organizationId: route.organization_id,
      providerAccountId: route.provider_account_id,
      signingSecret: '',
    };
  }

  return resolveEmailProviderAccount(
    db,
    provider,
    route.provider_account_id,
    baseUrl,
    serviceRoleKey,
  );
}

export async function resolveSmsStatusWebhookContext(
  db: DatabaseClient,
  provider: string,
  externalMessageId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const providerAccountId = await findMessageProviderAccountId(db, provider, externalMessageId);
  if (providerAccountId === null) {
    return null;
  }

  if (provider === 'mock') {
    return {
      organizationId: '',
      providerAccountId,
      signingSecret: '',
    };
  }

  return resolveSmsProviderAccount(db, provider, providerAccountId, baseUrl, serviceRoleKey);
}

export async function resolveEmailStatusWebhookContext(
  db: DatabaseClient,
  provider: string,
  externalMessageId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const providerAccountId = await findMessageProviderAccountId(db, provider, externalMessageId);
  if (providerAccountId === null) {
    return null;
  }

  if (provider === 'mock') {
    return {
      organizationId: '',
      providerAccountId,
      signingSecret: '',
    };
  }

  return resolveEmailProviderAccount(db, provider, providerAccountId, baseUrl, serviceRoleKey);
}

async function findSmsPhoneRoute(
  db: DatabaseClient,
  phoneNumber: string,
): Promise<SmsPhoneRouteRow | null> {
  const { data, error } = await db
    .from('sms_phone_numbers')
    .select('provider_account_id, organization_id')
    .eq('phone_number', phoneNumber)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`findSmsPhoneRoute failed: ${error.message}`);
  }

  return data ? data as SmsPhoneRouteRow : null;
}

async function findEmailAddressRoute(
  db: DatabaseClient,
  emailAddress: string,
): Promise<EmailAddressRouteRow | null> {
  const { data, error } = await db
    .from('email_addresses')
    .select('provider_account_id, organization_id')
    .eq('email_address', emailAddress)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`findEmailAddressRoute failed: ${error.message}`);
  }

  return data ? data as EmailAddressRouteRow : null;
}

async function findMessageProviderAccountId(
  db: DatabaseClient,
  provider: string,
  externalMessageId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('provider_account_id')
    .eq('provider', provider)
    .eq('external_message_id', externalMessageId)
    .maybeSingle();

  if (error) {
    throw new Error(`findMessageProviderAccountId failed: ${error.message}`);
  }

  const row = data ? data as MessageProviderAccountRow : null;
  return row?.provider_account_id ?? null;
}

async function resolveSmsProviderAccount(
  db: DatabaseClient,
  provider: string,
  providerAccountId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const account = await findProviderAccount(db, 'sms_provider_accounts', provider, providerAccountId);
  if (!account) {
    return null;
  }

  const signingSecret = await loadSigningSecret(
    'sms',
    provider,
    account.credentials_secret_id,
    baseUrl,
    serviceRoleKey,
  );
  if (signingSecret === null) {
    return null;
  }

  return {
    organizationId: account.organization_id,
    providerAccountId: account.id,
    signingSecret,
  };
}

async function resolveEmailProviderAccount(
  db: DatabaseClient,
  provider: string,
  providerAccountId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const account = await findProviderAccount(db, 'email_provider_accounts', provider, providerAccountId);
  if (!account) {
    return null;
  }

  const signingSecret = await loadSigningSecret(
    'email',
    provider,
    account.credentials_secret_id,
    baseUrl,
    serviceRoleKey,
  );
  if (signingSecret === null) {
    return null;
  }

  return {
    organizationId: account.organization_id,
    providerAccountId: account.id,
    signingSecret,
  };
}

async function findProviderAccount(
  db: DatabaseClient,
  table: 'sms_provider_accounts' | 'email_provider_accounts',
  provider: string,
  providerAccountId: string,
): Promise<ProviderAccountRow | null> {
  const { data, error } = await db
    .from(table)
    .select('id, organization_id, provider, credentials_secret_id, is_active')
    .eq('id', providerAccountId)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`findProviderAccount failed: ${error.message}`);
  }

  return data ? data as ProviderAccountRow : null;
}

async function loadSigningSecret(
  channel: 'sms' | 'email',
  provider: string,
  credentialsSecretId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<string | null> {
  const credentials = await getSecret<Record<string, unknown>>(
    credentialsSecretId,
    baseUrl,
    serviceRoleKey,
  );
  if (!credentials) {
    return null;
  }
  return getWebhookSigningSecret(channel, provider, credentials);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringField(record, key);
    if (value !== null) {
      return value;
    }
  }
  return null;
}
