import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteProviderAccount,
  loadProviderSettings,
  PROVIDER_CONNECTION_TIMEOUT_MS,
  testProviderConnection,
  updateProviderAccountLabel,
  writeProviderAudit,
  type ProviderSettingsConfig,
} from '../../app/settings/_components/provider-settings-data';

const mocks = vi.hoisted(() => ({
  tableData: {} as Record<string, unknown>,
  tableErrors: {} as Record<string, { message: string } | null>,
  updates: [] as Array<{ table: string; values: Record<string, unknown>; id: string }>,
  deletes: [] as Array<{ table: string; id: string }>,
  inserts: [] as Array<{ table: string; rows: unknown[] }>,
  insertRejections: {} as Record<string, string>,
}));

vi.mock('@/lib/insforge', () => ({
  getAccessToken: vi.fn(() => null),
  insforge: {
    database: {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => {
          const resolve = () => Promise.resolve({
            data: mocks.tableData[table] ?? [],
            error: mocks.tableErrors[table] ?? null,
          });
          const query = {
            eq: vi.fn(),
            order: vi.fn(resolve),
          };
          query.eq.mockReturnValue(query);
          return query;
        }),
        update: vi.fn((values: Record<string, unknown>) => ({
          eq: vi.fn(async (_column: string, id: string) => {
            mocks.updates.push({ table, values, id });
            return { data: null, error: mocks.tableErrors[table] ?? null };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async (_column: string, id: string) => {
            mocks.deletes.push({ table, id });
            return { data: null, error: mocks.tableErrors[table] ?? null };
          }),
        })),
        insert: vi.fn(async (rows: unknown[]) => {
          mocks.inserts.push({ table, rows });
          if (mocks.insertRejections[table]) {
            throw new Error(mocks.insertRejections[table]);
          }
          return { data: null, error: mocks.tableErrors[table] ?? null };
        }),
      })),
    },
  },
}));

const config: ProviderSettingsConfig = {
  channel: 'sms',
  channelLabel: 'SMS',
  accountTable: 'sms_provider_accounts',
  routeTable: 'sms_phone_numbers',
  routeValueKey: 'phone_number',
  resourceType: 'sms_provider_account',
  removeConfirmation: 'Remove?',
};

describe('provider settings data operations', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mocks.tableData = {};
    mocks.tableErrors = {};
    mocks.updates.length = 0;
    mocks.deletes.length = 0;
    mocks.inserts.length = 0;
    mocks.insertRejections = {};
    vi.clearAllMocks();
  });

  it('maps provider routes without exposing credential secret IDs', async () => {
    mocks.tableData.sms_provider_accounts = [{
      id: 'account-1',
      organization_id: 'org-1',
      provider: 'twilio',
      label: 'Primary',
      is_active: true,
      metadata: {},
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }];
    mocks.tableData.sms_phone_numbers = [{
      id: 'route-1',
      provider_account_id: 'account-1',
      phone_number: '+15551234567',
      is_default: true,
    }];

    await expect(loadProviderSettings(config, 'org-1')).resolves.toMatchObject({
      accounts: [expect.not.objectContaining({ credentials_secret_id: expect.anything() })],
      routes: [{
        id: 'route-1',
        providerAccountId: 'account-1',
        value: '+15551234567',
        isDefault: true,
      }],
    });
  });

  it('updates and deletes the selected account through focused operations', async () => {
    await updateProviderAccountLabel(config, 'account-1', 'Renamed');
    await deleteProviderAccount(config, 'account-1');

    expect(mocks.updates).toEqual([expect.objectContaining({
      table: 'sms_provider_accounts',
      id: 'account-1',
      values: expect.objectContaining({ label: 'Renamed' }),
    })]);
    expect(mocks.deletes).toEqual([{
      table: 'sms_provider_accounts',
      id: 'account-1',
    }]);
  });

  it('propagates mutation errors and reports audit errors separately', async () => {
    mocks.tableErrors.sms_provider_accounts = { message: 'database unavailable' };
    await expect(
      updateProviderAccountLabel(config, 'account-1', 'Renamed'),
    ).rejects.toThrow('database unavailable');

    mocks.tableErrors.audit_logs = { message: 'audit unavailable' };
    await expect(writeProviderAudit({
      config,
      organizationId: 'org-1',
      actorId: 'user-1',
      operation: 'delete',
      resourceId: 'account-1',
      metadata: { provider: 'twilio' },
    })).resolves.toBe('audit unavailable');

    mocks.tableErrors.audit_logs = null;
    mocks.insertRejections.audit_logs = 'audit network failure';
    await expect(writeProviderAudit({
      config,
      organizationId: 'org-1',
      actorId: 'user-1',
      operation: 'delete',
      resourceId: 'account-1',
      metadata: { provider: 'twilio' },
    })).resolves.toBe('audit network failure');
  });

  it('aborts a stalled provider connection test after the bounded timeout', async () => {
    vi.useFakeTimers();
    const request = { signal: null as AbortSignal | null };
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      request.signal = init.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }));

    const result = testProviderConnection('sms', 'account-1');
    const rejection = expect(result).rejects.toThrow(
      'Connection test timed out after 10 seconds',
    );

    await vi.advanceTimersByTimeAsync(PROVIDER_CONNECTION_TIMEOUT_MS);
    await rejection;
    expect(request.signal?.aborted).toBe(true);
  });
});
