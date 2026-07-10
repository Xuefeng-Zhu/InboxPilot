import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getWebhookSigningSecret,
  parseSmsWebhookBody,
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
      signingSecret: 'public-key',
    });
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
});
