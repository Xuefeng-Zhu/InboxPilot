import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthCheck } from '../../src/health-check';
import type { SmsProviderAdapter } from '../../src/interfaces/sms-provider-adapter';

function adapter(providerId: string): SmsProviderAdapter {
  return { providerId } as unknown as SmsProviderAdapter;
}

describe('healthCheck', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('short-circuits the mock provider without network traffic', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(healthCheck(adapter('mock'), {})).resolves.toEqual({
      ok: true,
      message: 'Mock provider (no remote ping)',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates provider credentials before sending a request', async () => {
    await expect(healthCheck(adapter('twilio'), {})).resolves.toEqual({
      ok: false,
      reason: 'Twilio providerConfig must contain accountSid and authToken',
    });
    await expect(healthCheck(adapter('postmark'), {})).resolves.toEqual({
      ok: false,
      reason: 'Postmark providerConfig must contain serverToken',
    });
  });

  it('builds the Twilio authorization request and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await healthCheck(adapter('twilio'), {
      accountSid: 'AC123',
      authToken: 'secret',
    });

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeTypeOf('number');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC123.json',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns non-2xx and network failures instead of throwing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      healthCheck(adapter('postmark'), { serverToken: 'token' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, message: 'HTTP 401' }));
    await expect(
      healthCheck(adapter('postmark'), { serverToken: 'token' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'network down' }));
  });

  it('reports unsupported providers deterministically', async () => {
    await expect(healthCheck(adapter('telnyx'), {})).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining('not implemented'),
    });
    await expect(healthCheck(adapter('bandwidth'), {})).resolves.toEqual({
      ok: false,
      reason: 'Provider not implemented in this build',
    });
  });
});
