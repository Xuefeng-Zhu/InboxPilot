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
  provider: string;
  signingSecret: string;
}

export function readWebhookProvider(headers: Headers): string | null {
  const provider = headers.get('x-provider')?.trim().toLowerCase();
  return provider ? provider : null;
}

/**
 * Mock inbound webhooks are a local-only development escape hatch. Requiring
 * an explicit opt-in plus loopback request and InsForge URLs prevents a
 * deployment from enabling the unauthenticated mock adapter with an env flag.
 */
export function isLocalMockWebhookAllowed(
  requestUrl: string,
  baseUrl: string,
  explicitOptIn: string | undefined,
): boolean {
  if (explicitOptIn !== 'true') {
    return false;
  }

  return isLoopbackUrl(requestUrl) && isLoopbackUrl(baseUrl);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';
  } catch {
    return false;
  }
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

  return resolveSmsProviderAccount(
    db,
    provider,
    route.provider_account_id,
    route.organization_id,
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

  return resolveEmailProviderAccount(
    db,
    provider,
    route.provider_account_id,
    route.organization_id,
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
  return resolveStatusWebhookContext(
    'sms',
    db,
    provider,
    externalMessageId,
    baseUrl,
    serviceRoleKey,
  );
}

export async function resolveEmailStatusWebhookContext(
  db: DatabaseClient,
  provider: string,
  externalMessageId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  return resolveStatusWebhookContext(
    'email',
    db,
    provider,
    externalMessageId,
    baseUrl,
    serviceRoleKey,
  );
}

async function resolveStatusWebhookContext(
  channel: 'sms' | 'email',
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
      provider,
      signingSecret: '',
    };
  }

  return resolveProviderAccount(
    channel,
    db,
    provider,
    providerAccountId,
    undefined,
    baseUrl,
    serviceRoleKey,
  );
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
  routeOrganizationId: string | undefined,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  return resolveProviderAccount(
    'sms',
    db,
    provider,
    providerAccountId,
    routeOrganizationId,
    baseUrl,
    serviceRoleKey,
  );
}

async function resolveEmailProviderAccount(
  db: DatabaseClient,
  provider: string,
  providerAccountId: string,
  routeOrganizationId: string | undefined,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  return resolveProviderAccount(
    'email',
    db,
    provider,
    providerAccountId,
    routeOrganizationId,
    baseUrl,
    serviceRoleKey,
  );
}

async function resolveProviderAccount(
  channel: 'sms' | 'email',
  db: DatabaseClient,
  provider: string,
  providerAccountId: string,
  routeOrganizationId: string | undefined,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<WebhookAccountContext | null> {
  const accountTable = channel === 'sms'
    ? 'sms_provider_accounts'
    : 'email_provider_accounts';
  const account = await findProviderAccount(db, accountTable, providerAccountId);
  if (
    !account ||
    account.provider !== provider ||
    (routeOrganizationId !== undefined && account.organization_id !== routeOrganizationId)
  ) {
    return null;
  }

  const signingSecret = provider === 'mock'
    ? ''
    : await loadSigningSecret(
      channel,
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
    provider: account.provider,
    signingSecret,
  };
}

async function findProviderAccount(
  db: DatabaseClient,
  table: 'sms_provider_accounts' | 'email_provider_accounts',
  providerAccountId: string,
): Promise<ProviderAccountRow | null> {
  const { data, error } = await db
    .from(table)
    .select('id, organization_id, provider, credentials_secret_id, is_active')
    .eq('id', providerAccountId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`findProviderAccount failed: ${error.message}`);
  }

  const account = data ? data as ProviderAccountRow : null;
  return account?.is_active === true ? account : null;
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
