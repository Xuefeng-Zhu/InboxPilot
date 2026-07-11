/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ProviderSettingsConfig,
  useProviderSettings,
} from '../../app/settings/_components/useProviderSettings';

const mocks = vi.hoisted(() => ({
  auditError: null as { message: string } | null,
  inserts: [] as Array<{ table: string; rows: unknown[] }>,
  selects: [] as Array<{ table: string; columns?: string }>,
  membershipResult: {
    data: { organizationId: 'org-1', role: 'owner' as const },
    isLoading: false,
  },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: (() => {
    const authState = { user: { id: 'user-1' }, loading: false };
    return () => authState;
  })(),
}));

vi.mock('@/lib/queries', () => ({
  useCurrentMembership: () => mocks.membershipResult,
}));

vi.mock('@/lib/insforge', () => ({
  getAccessToken: vi.fn(() => null),
  insforge: {
    database: {
      from: vi.fn((table: string) => ({
        select: vi.fn((columns?: string) => {
          mocks.selects.push({ table, columns });
          const eq = vi.fn();
          const order = vi.fn().mockResolvedValue({ data: [], error: null });
          const query = { eq, order };
          eq.mockReturnValue(query);
          return query;
        }),
        insert: vi.fn((rows: unknown[]) => {
          mocks.inserts.push({ table, rows });
          return Promise.resolve({
            data: null,
            error: table === 'audit_logs' ? mocks.auditError : null,
          });
        }),
      })),
    },
  },
}));

const SMS_CONFIG: ProviderSettingsConfig = {
  channel: 'sms',
  channelLabel: 'SMS',
  accountTable: 'sms_provider_accounts',
  routeTable: 'sms_phone_numbers',
  routeValueKey: 'phone_number',
  resourceType: 'sms_provider_account',
  removeConfirmation: 'Remove?',
};

describe('useProviderSettings', () => {
  afterEach(() => {
    mocks.auditError = null;
    mocks.inserts.length = 0;
    mocks.selects.length = 0;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('audits the first provider account with the membership organization', async () => {
    const { result } = renderHook(() => useProviderSettings(SMS_CONFIG));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewLabel('Production Twilio');
      result.current.setNewCredentialsId('secret-1');
      result.current.setNewProvider('twilio');
    });
    await act(async () => result.current.addAccount());

    const auditInsert = mocks.inserts.find(({ table }) => table === 'audit_logs');
    expect(auditInsert?.rows).toEqual([expect.objectContaining({
      organization_id: 'org-1',
      action: 'provider_account_modified',
      resource_type: 'sms_provider_account',
      metadata: expect.objectContaining({ operation: 'create', provider: 'twilio' }),
    })]);
    expect(result.current.success).toBe('SMS provider account added');
  });

  it('surfaces an audit failure after the account write succeeds', async () => {
    mocks.auditError = { message: 'audit unavailable' };
    const { result } = renderHook(() => useProviderSettings(SMS_CONFIG));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewLabel('Mock');
      result.current.setNewCredentialsId('secret-1');
    });
    await act(async () => result.current.addAccount());

    expect(result.current.error).toBe(
      'Account added, but audit logging failed: audit unavailable',
    );
    expect(result.current.success).toBeNull();
  });

  it('does not read credential secret ids into browser state', async () => {
    const { result } = renderHook(() => useProviderSettings(SMS_CONFIG));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const accountSelect = mocks.selects.find(({ table }) => table === 'sms_provider_accounts');
    expect(accountSelect?.columns).not.toContain('credentials_secret_id');
  });

  it('shows a failed health result even when the route returns HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'ok',
      data: { ok: false, reason: 'Provider rejected the credentials' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const { result } = renderHook(() => useProviderSettings(SMS_CONFIG));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.testConnection('account-1'));

    expect(result.current.testResult).toEqual({
      id: 'account-1',
      success: false,
      message: 'Provider rejected the credentials',
    });
  });
});
