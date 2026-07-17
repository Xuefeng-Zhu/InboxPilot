import { getAccessToken, insforge } from '@/lib/insforge';
import { readResponseJsonObject } from '@/lib/http-json';

export type ProviderChannel = 'sms' | 'email';

export interface ProviderSettingsConfig {
  channel: ProviderChannel;
  channelLabel: string;
  accountTable: 'sms_provider_accounts' | 'email_provider_accounts';
  routeTable: 'sms_phone_numbers' | 'email_addresses';
  routeValueKey: 'phone_number' | 'email_address';
  resourceType: 'sms_provider_account' | 'email_provider_account';
  removeConfirmation: string;
}

export interface ProviderAccount {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderRoute {
  id: string;
  providerAccountId: string;
  value: string;
  isDefault: boolean;
}

export interface ProviderConnectionResult {
  success: boolean;
  message: string;
}

export const PROVIDER_CONNECTION_TIMEOUT_MS = 10_000;

export async function loadProviderSettings(
  config: ProviderSettingsConfig,
  organizationId: string,
): Promise<{ accounts: ProviderAccount[]; routes: ProviderRoute[] }> {
  const [accountsResult, routesResult] = await Promise.all([
    insforge.database
      .from(config.accountTable)
      .select('id,organization_id,provider,label,is_active,metadata,created_at,updated_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true }),
    insforge.database
      .from(config.routeTable)
      .select(`id,provider_account_id,${config.routeValueKey},is_default`)
      .order('created_at', { ascending: true }),
  ]);
  if (accountsResult.error) throw new Error(accountsResult.error.message);
  if (routesResult.error) throw new Error(routesResult.error.message);

  const accounts = Array.isArray(accountsResult.data)
    ? accountsResult.data as ProviderAccount[]
    : [];
  const routeRows = Array.isArray(routesResult.data) ? routesResult.data : [];
  const routes = routeRows.flatMap((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const id = row.id;
    const providerAccountId = row.provider_account_id;
    const value = row[config.routeValueKey];
    if (
      typeof id !== 'string' ||
      typeof providerAccountId !== 'string' ||
      typeof value !== 'string'
    ) return [];
    return [{
      id,
      providerAccountId,
      value,
      isDefault: row.is_default === true,
    }];
  });
  return { accounts, routes };
}

export async function createProviderAccount(input: {
  config: ProviderSettingsConfig;
  organizationId: string;
  provider: string;
  label: string;
  credentialsSecretId: string;
}): Promise<void> {
  const { error } = await insforge.database
    .from(input.config.accountTable)
    .insert([{
      organization_id: input.organizationId,
      provider: input.provider,
      label: input.label,
      credentials_secret_id: input.credentialsSecretId,
      is_active: true,
      metadata: {},
    }]);
  if (error) throw new Error(error.message);
}

export async function updateProviderAccountLabel(
  config: ProviderSettingsConfig,
  accountId: string,
  label: string,
): Promise<void> {
  const { error } = await insforge.database
    .from(config.accountTable)
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) throw new Error(error.message);
}

export async function deleteProviderAccount(
  config: ProviderSettingsConfig,
  accountId: string,
): Promise<void> {
  const { error } = await insforge.database
    .from(config.accountTable)
    .delete()
    .eq('id', accountId);
  if (error) throw new Error(error.message);
}

export async function writeProviderAudit(input: {
  config: ProviderSettingsConfig;
  organizationId: string;
  actorId: string | null;
  operation: 'create' | 'update' | 'delete';
  resourceId: string | null;
  metadata: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const { error } = await insforge.database
      .from('audit_logs')
      .insert([{
        organization_id: input.organizationId,
        actor_id: input.actorId,
        actor_type: 'user',
        action: 'provider_account_modified',
        resource_type: input.config.resourceType,
        resource_id: input.resourceId,
        metadata: { operation: input.operation, ...input.metadata },
      }]);
    return error?.message ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown audit error';
  }
}

export async function testProviderConnection(
  channel: ProviderChannel,
  accountId: string,
): Promise<ProviderConnectionResult> {
  const token = getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PROVIDER_CONNECTION_TIMEOUT_MS,
  );

  try {
    const response = await fetch('/api/functions/test-channel-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        channelType: channel,
        providerAccountId: accountId,
      }),
      signal: controller.signal,
    });
    const data = await readResponseJsonObject(response, 'provider connection test');
    const healthData =
      data.data && typeof data.data === 'object' && !Array.isArray(data.data)
        ? data.data as Record<string, unknown>
        : null;
    const success = response.ok && data.status === 'ok' && healthData?.ok === true;
    const detail =
      (typeof healthData?.message === 'string' && healthData.message) ||
      (typeof healthData?.reason === 'string' && healthData.reason) ||
      (typeof data.error === 'string' && data.error) ||
      null;
    return {
      success,
      message: success
        ? detail ?? 'Connection successful'
        : detail ?? 'Connection failed',
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Connection test timed out after ${PROVIDER_CONNECTION_TIMEOUT_MS / 1000} seconds`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
