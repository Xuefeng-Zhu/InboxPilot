import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getWebhookSigningSecret,
  isLocalMockWebhookAllowed,
  parseSmsWebhookBody,
  readWebhookProvider,
  resolveEmailInboundWebhookContext,
  resolveSmsInboundWebhookContext,
} from '../../insforge/functions/_shared/webhook-credentials.ts';

function queryBuilder(result) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected)),
  };
  return builder;
}

function database(results) {
  return {
    from: vi.fn((table) => queryBuilder(
      results[table] ?? { data: null, error: null },
    )),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe('webhook credential resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the trusted account and signing key for an inbound route', async () => {
    const db = database({
      sms_phone_numbers: {
        data: { provider_account_id: 'account-1', organization_id: 'org-1' },
        error: null,
      },
      sms_provider_accounts: {
        data: {
          id: 'account-1',
          organization_id: 'org-1',
          provider: 'telnyx',
          credentials_secret_id: 'secret-1',
          is_active: true,
        },
        error: null,
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"webhookPublicKey":"public-key"}', { status: 200 }),
    ));

    await expect(
      resolveSmsInboundWebhookContext(
        db,
        'telnyx',
        '+15551234567',
        'https://example.insforge.app',
        'service-role-key',
      ),
    ).resolves.toEqual({
      organizationId: 'org-1',
      providerAccountId: 'account-1',
      provider: 'telnyx',
      signingSecret: 'public-key',
    });
  });

  it('rejects provider downgrade and route/account tenant mismatches', async () => {
    const providerMismatchDb = database({
      sms_phone_numbers: {
        data: { provider_account_id: 'account-1', organization_id: 'org-1' },
        error: null,
      },
      sms_provider_accounts: {
        data: {
          id: 'account-1',
          organization_id: 'org-1',
          provider: 'telnyx',
          credentials_secret_id: 'secret-1',
          is_active: true,
        },
        error: null,
      },
    });

    await expect(
      resolveSmsInboundWebhookContext(
        providerMismatchDb,
        'mock',
        '+15551234567',
        'http://localhost:54321',
        'service-role-key',
      ),
    ).resolves.toBeNull();

    const tenantMismatchDb = database({
      email_addresses: {
        data: { provider_account_id: 'account-2', organization_id: 'org-route' },
        error: null,
      },
      email_provider_accounts: {
        data: {
          id: 'account-2',
          organization_id: 'org-account',
          provider: 'mock',
          credentials_secret_id: 'secret-2',
          is_active: true,
        },
        error: null,
      },
    });

    await expect(
      resolveEmailInboundWebhookContext(
        tenantMismatchDb,
        'mock',
        'support@example.com',
        'http://localhost:54321',
        'service-role-key',
      ),
    ).resolves.toBeNull();
  });

  it('allows mock resolution only through a matching active configured account', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const db = database({
      sms_phone_numbers: {
        data: { provider_account_id: 'mock-account', organization_id: 'org-1' },
        error: null,
      },
      sms_provider_accounts: {
        data: {
          id: 'mock-account',
          organization_id: 'org-1',
          provider: 'mock',
          credentials_secret_id: 'unused-for-local-mock',
          is_active: true,
        },
        error: null,
      },
    });

    await expect(
      resolveSmsInboundWebhookContext(
        db,
        'mock',
        '+15551234567',
        'http://localhost:54321',
        'service-role-key',
      ),
    ).resolves.toEqual({
      organizationId: 'org-1',
      providerAccountId: 'mock-account',
      provider: 'mock',
      signingSecret: '',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const inactiveDb = database({
      sms_phone_numbers: {
        data: { provider_account_id: 'mock-account', organization_id: 'org-1' },
        error: null,
      },
      sms_provider_accounts: {
        data: {
          id: 'mock-account',
          organization_id: 'org-1',
          provider: 'mock',
          credentials_secret_id: 'unused-for-local-mock',
          is_active: false,
        },
        error: null,
      },
    });

    await expect(
      resolveSmsInboundWebhookContext(
        inactiveDb,
        'mock',
        '+15551234567',
        'http://localhost:54321',
        'service-role-key',
      ),
    ).resolves.toBeNull();
  });

  it('returns null when no active provider account matches the route', async () => {
    const db = database({
      sms_phone_numbers: {
        data: { provider_account_id: 'account-1', organization_id: 'org-1' },
        error: null,
      },
      sms_provider_accounts: { data: null, error: null },
    });

    await expect(
      resolveSmsInboundWebhookContext(
        db,
        'telnyx',
        '+15551234567',
        'https://example.insforge.app',
        'service-role-key',
      ),
    ).resolves.toBeNull();
  });

  it('surfaces database lookup failures', async () => {
    const db = database({
      sms_phone_numbers: {
        data: null,
        error: { message: 'database unavailable' },
      },
    });

    await expect(
      resolveSmsInboundWebhookContext(
        db,
        'telnyx',
        '+15551234567',
        'https://example.insforge.app',
        'service-role-key',
      ),
    ).rejects.toThrow('findSmsPhoneRoute failed: database unavailable');
  });

  it('keeps provider-specific parsing and secret aliases explicit', () => {
    expect(parseSmsWebhookBody('Body=hello', 'twilio')).toBe('Body=hello');
    expect(parseSmsWebhookBody('{"data":{}}', 'telnyx')).toEqual({ data: {} });
    expect(getWebhookSigningSecret('sms', 'telnyx', {
      signingPublicKey: 'telnyx-key',
    })).toBe('telnyx-key');
    expect(getWebhookSigningSecret('email', 'postmark', {
      serverToken: 'postmark-token',
    })).toBe('postmark-token');
  });

  it('requires an explicit provider header and normalizes its value', () => {
    expect(readWebhookProvider(new Headers())).toBeNull();
    expect(readWebhookProvider(new Headers({ 'x-provider': '   ' }))).toBeNull();
    expect(readWebhookProvider(new Headers({ 'x-provider': ' Telnyx ' }))).toBe('telnyx');
  });

  it('allows mock webhooks only with an explicit opt-in on loopback URLs', () => {
    expect(isLocalMockWebhookAllowed(
      'http://localhost:8000/functions/sms-inbound',
      'http://127.0.0.1:54321',
      'true',
    )).toBe(true);
    expect(isLocalMockWebhookAllowed(
      'https://project.insforge.app/functions/sms-inbound',
      'http://127.0.0.1:54321',
      'true',
    )).toBe(false);
    expect(isLocalMockWebhookAllowed(
      'http://localhost:8000/functions/sms-inbound',
      'https://project.insforge.app',
      'true',
    )).toBe(false);
    expect(isLocalMockWebhookAllowed(
      'http://localhost:8000/functions/sms-inbound',
      'http://127.0.0.1:54321',
      undefined,
    )).toBe(false);
  });
});
