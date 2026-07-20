import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  createProviderRegistry: vi.fn(),
  getSmsAdapter: vi.fn(),
  getEmailAdapter: vi.fn(),
  getSecret: vi.fn(),
  healthCheck: vi.fn(),
  accountRows: [] as unknown,
  accountError: null as { message: string } | null,
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
}));

vi.mock('@/app/api/functions/_auth', () => ({
  getUserFromToken: mocks.getUserFromToken,
  userHasOrgPermission: mocks.userHasOrgPermission,
}));

vi.mock('@/lib/provider-registry', () => ({
  createProviderRegistry: mocks.createProviderRegistry,
}));

vi.mock('@/lib/insforge-secrets', () => ({
  getSecret: mocks.getSecret,
}));

vi.mock('@support-core/health-check', () => ({
  healthCheck: mocks.healthCheck,
}));

import { POST as postTestChannelConnection } from '../../app/api/functions/test-channel-connection/route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/functions/test-channel-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return new Request('http://localhost/api/functions/test-channel-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  }) as NextRequest;
}

function createAccountBuilder() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.then.mockImplementation((onfulfilled, onrejected) => (
    Promise.resolve({ data: mocks.accountRows, error: mocks.accountError })
      .then(onfulfilled, onrejected)
  ));
  return builder;
}

describe('test-channel-connection route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountRows = [{
      id: 'account-1',
      organization_id: 'org-1',
      provider: 'twilio',
      is_active: true,
      credentials_secret_id: 'secret-1',
    }];
    mocks.accountError = null;
    mocks.from.mockImplementation(() => createAccountBuilder());
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    mocks.getSmsAdapter.mockReturnValue({ providerId: 'twilio' });
    mocks.getEmailAdapter.mockReturnValue({ providerId: 'postmark' });
    mocks.createProviderRegistry.mockReturnValue({
      getSmsAdapter: mocks.getSmsAdapter,
      getEmailAdapter: mocks.getEmailAdapter,
    });
    mocks.getSecret.mockResolvedValue({ accountSid: 'AC123', authToken: 'token' });
    mocks.healthCheck.mockResolvedValue({ ok: true, message: 'Connected' });
  });

  it('rejects anonymous callers before loading provider accounts', async () => {
    mocks.getUserFromToken.mockResolvedValue(null);

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await postTestChannelConnection(makeInvalidJsonRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('validates the channel type', async () => {
    const response = await postTestChannelConnection(makeRequest({
      channelType: 'push',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('validates the provider account id', async () => {
    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
    }));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('surfaces provider account lookup failures', async () => {
    mocks.accountError = { message: 'provider account query unavailable' };

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'provider account query unavailable',
    });
    expect(mocks.healthCheck).not.toHaveBeenCalled();
  });

  it('returns not found for a missing provider account', async () => {
    mocks.accountRows = [];

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'missing-account',
    }));

    expect(response.status).toBe(404);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
  });

  it('does not test accounts outside the caller permissions', async () => {
    mocks.userHasOrgPermission.mockResolvedValue(false);

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(403);
    expect(mocks.userHasOrgPermission).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      'manage_settings',
    );
    expect(mocks.healthCheck).not.toHaveBeenCalled();
  });

  it('returns a validation error for an unknown provider', async () => {
    mocks.getSmsAdapter.mockImplementation(() => {
      throw new Error('unknown provider');
    });

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Unknown provider: twilio',
    });
    expect(mocks.getSecret).not.toHaveBeenCalled();
  });

  it('returns an actionable error when provider credentials are missing', async () => {
    mocks.getSecret.mockResolvedValue(null);

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: 'Credentials secret not found: secret-1',
    });
    expect(mocks.healthCheck).not.toHaveBeenCalled();
  });

  it('checks SMS providers with their stored credentials', async () => {
    const adapter = { providerId: 'twilio' };
    const credentials = { accountSid: 'AC123', authToken: 'token' };
    mocks.getSmsAdapter.mockReturnValue(adapter);
    mocks.getSecret.mockResolvedValue(credentials);
    mocks.healthCheck.mockResolvedValue({ ok: true, message: 'Connected' });

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      data: {
        ok: true,
        message: 'Connected',
        provider: 'twilio',
        active: true,
      },
    });
    expect(mocks.healthCheck).toHaveBeenCalledWith(adapter, credentials);
  });

  it('uses the email adapter for email accounts', async () => {
    mocks.accountRows = [{
      id: 'account-2',
      organization_id: 'org-1',
      provider: 'postmark',
      is_active: false,
      credentials_secret_id: 'secret-2',
    }];
    const adapter = { providerId: 'postmark' };
    mocks.getEmailAdapter.mockReturnValue(adapter);
    mocks.getSecret.mockResolvedValue({ serverToken: 'postmark-token' });
    mocks.healthCheck.mockResolvedValue({ ok: false, reason: 'Unauthorized' });

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'email',
      providerAccountId: 'account-2',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      data: {
        ok: false,
        reason: 'Unauthorized',
        provider: 'postmark',
        active: false,
      },
    });
    expect(mocks.getEmailAdapter).toHaveBeenCalledWith('postmark');
    expect(mocks.healthCheck).toHaveBeenCalledWith(
      adapter,
      { serverToken: 'postmark-token' },
    );
  });

  it('does not require a fake secret for the mock provider', async () => {
    mocks.accountRows = [{
      id: 'account-mock',
      organization_id: 'org-1',
      provider: 'mock',
      is_active: true,
      credentials_secret_id: '',
    }];
    const adapter = { providerId: 'mock' };
    mocks.getSmsAdapter.mockReturnValue(adapter);

    const response = await postTestChannelConnection(makeRequest({
      channelType: 'sms',
      providerAccountId: 'account-mock',
    }));

    expect(response.status).toBe(200);
    expect(mocks.getSecret).not.toHaveBeenCalled();
    expect(mocks.healthCheck).toHaveBeenCalledWith(adapter, {});
  });
});
