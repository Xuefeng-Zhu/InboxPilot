import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { TwilioSmsAdapter } from '@support-core/adapters/twilio-sms-adapter';
import { ProviderSendOutcomeUnknownError } from '@support-core/adapters';
import type { WebhookVerificationRequest } from '@support-core/types/index';

/**
 * Helper: compute a valid Twilio signature for testing.
 */
function computeSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(data).digest('base64');
}

/**
 * Helper: encode params as a URL-encoded form body.
 */
function toFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

describe('TwilioSmsAdapter', () => {
  let adapter: TwilioSmsAdapter;

  beforeEach(() => {
    adapter = new TwilioSmsAdapter();
  });

  it('has providerId "twilio"', () => {
    expect(adapter.providerId).toBe('twilio');
  });

  // ─── parseInboundWebhook ───────────────────────────────────────────

  describe('parseInboundWebhook', () => {
    it('parses a valid Twilio inbound payload (object)', () => {
      const payload = {
        From: '+12125551234',
        To: '+19175559999',
        Body: 'Hello from Twilio',
        MessageSid: 'SM1234567890abcdef',
        AccountSid: 'AC0000000000000000',
        NumMedia: '0',
      };

      const result = adapter.parseInboundWebhook(payload);

      expect(result.from).toBe('+12125551234');
      expect(result.to).toBe('+19175559999');
      expect(result.body).toBe('Hello from Twilio');
      expect(result.externalMessageId).toBe('SM1234567890abcdef');
      expect(result.rawPayload).toEqual(expect.objectContaining({
        From: '+12125551234',
        AccountSid: 'AC0000000000000000',
      }));
    });

    it('parses a URL-encoded form body string', () => {
      const formBody = 'From=%2B12125551234&To=%2B19175559999&Body=Hello&MessageSid=SM999';

      const result = adapter.parseInboundWebhook(formBody);

      expect(result.from).toBe('+12125551234');
      expect(result.to).toBe('+19175559999');
      expect(result.body).toBe('Hello');
      expect(result.externalMessageId).toBe('SM999');
    });

    it('handles form body with + as space encoding', () => {
      const formBody = 'From=%2B12125551234&To=%2B19175559999&Body=Hello+World&MessageSid=SM999';

      const result = adapter.parseInboundWebhook(formBody);

      expect(result.body).toBe('Hello World');
    });

    it('throws on missing From field', () => {
      expect(() =>
        adapter.parseInboundWebhook({
          To: '+19175559999',
          Body: 'Hi',
          MessageSid: 'SM123',
        }),
      ).toThrow('From');
    });

    it('throws on missing MessageSid field', () => {
      expect(() =>
        adapter.parseInboundWebhook({
          From: '+12125551234',
          To: '+19175559999',
          Body: 'Hi',
        }),
      ).toThrow('MessageSid');
    });

    it('throws on null body', () => {
      expect(() => adapter.parseInboundWebhook(null)).toThrow();
    });

    it('throws on non-object/non-string body', () => {
      expect(() => adapter.parseInboundWebhook(42)).toThrow();
    });
  });

  // ─── parseStatusWebhook ────────────────────────────────────────────

  describe('parseStatusWebhook', () => {
    it('parses a delivered status', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
      });

      expect(result.externalMessageId).toBe('SM123');
      expect(result.status).toBe('delivered');
    });

    it('maps "queued" to queued', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'queued',
      });
      expect(result.status).toBe('queued');
    });

    it('maps "sent" to sent', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'sent',
      });
      expect(result.status).toBe('sent');
    });

    it('maps "undelivered" to bounced', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'undelivered',
      });
      expect(result.status).toBe('bounced');
    });

    it('maps "failed" to failed', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'failed',
      });
      expect(result.status).toBe('failed');
    });

    it('maps "sending" to queued', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'sending',
      });
      expect(result.status).toBe('queued');
    });

    it('maps unknown status to pending', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'some_future_status',
      });
      expect(result.status).toBe('pending');
    });

    it('includes ErrorCode and ErrorMessage when present', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'failed',
        ErrorCode: '30001',
        ErrorMessage: 'Queue overflow',
      });

      expect(result.errorCode).toBe('30001');
      expect(result.errorMessage).toBe('Queue overflow');
    });

    it('omits ErrorCode and ErrorMessage when empty strings', () => {
      const result = adapter.parseStatusWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
        ErrorCode: '',
        ErrorMessage: '',
      });

      expect(result.errorCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('parses a URL-encoded form body string', () => {
      const formBody = 'MessageSid=SM456&MessageStatus=delivered';
      const result = adapter.parseStatusWebhook(formBody);

      expect(result.externalMessageId).toBe('SM456');
      expect(result.status).toBe('delivered');
    });

    it('throws on missing MessageSid', () => {
      expect(() =>
        adapter.parseStatusWebhook({ MessageStatus: 'delivered' }),
      ).toThrow('MessageSid');
    });

    it('throws on missing MessageStatus', () => {
      expect(() =>
        adapter.parseStatusWebhook({ MessageSid: 'SM123' }),
      ).toThrow('MessageStatus');
    });
  });

  // ─── verifyWebhook ────────────────────────────────────────────────

  describe('verifyWebhook', () => {
    const authToken = 'test_auth_token_12345';
    const webhookUrl = 'https://example.com/webhooks/sms-inbound';

    it('returns true for a valid signature', async () => {
      const params: Record<string, string> = {
        From: '+12125551234',
        To: '+19175559999',
        Body: 'Hello',
        MessageSid: 'SM123',
      };

      const signature = computeSignature(authToken, webhookUrl, params);
      const body = toFormBody(params);

      const req: WebhookVerificationRequest = {
        headers: {
          'x-twilio-signature': signature,
          'x-webhook-url': webhookUrl,
        },
        body,
        signingSecret: authToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(true);
    });

    it('returns false for an invalid signature', async () => {
      const params: Record<string, string> = {
        From: '+12125551234',
        To: '+19175559999',
        Body: 'Hello',
        MessageSid: 'SM123',
      };

      const body = toFormBody(params);

      const req: WebhookVerificationRequest = {
        headers: {
          'x-twilio-signature': 'invalid_base64_signature==',
          'x-webhook-url': webhookUrl,
        },
        body,
        signingSecret: authToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when x-twilio-signature header is missing', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'x-webhook-url': webhookUrl,
        },
        body: 'From=%2B12125551234',
        signingSecret: authToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when x-webhook-url header is missing', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'x-twilio-signature': 'some_signature',
        },
        body: 'From=%2B12125551234',
        signingSecret: authToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when signingSecret is empty', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'x-twilio-signature': 'some_signature',
          'x-webhook-url': webhookUrl,
        },
        body: 'From=%2B12125551234',
        signingSecret: '',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('handles Buffer body correctly', async () => {
      const params: Record<string, string> = {
        From: '+12125551234',
        Body: 'Test',
        MessageSid: 'SM999',
        To: '+19175559999',
      };

      const signature = computeSignature(authToken, webhookUrl, params);
      const body = Buffer.from(toFormBody(params));

      const req: WebhookVerificationRequest = {
        headers: {
          'x-twilio-signature': signature,
          'x-webhook-url': webhookUrl,
        },
        body,
        signingSecret: authToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(true);
    });

    it('verifies with empty POST body', async () => {
      const signature = computeSignature(authToken, webhookUrl, {});

      const req: WebhookVerificationRequest = {
        headers: {
          'x-twilio-signature': signature,
          'x-webhook-url': webhookUrl,
        },
        body: '',
        signingSecret: authToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(true);
    });
  });

  // ─── sendSms ──────────────────────────────────────────────────────

  describe('sendSms', () => {
    it('throws when accountSid is missing', async () => {
      await expect(
        adapter.sendSms({
          to: '+12125551234',
          from: '+19175559999',
          body: 'Hello',
          providerConfig: { authToken: 'token' },
        }),
      ).rejects.toThrow('accountSid');
    });

    it('throws when authToken is missing', async () => {
      await expect(
        adapter.sendSms({
          to: '+12125551234',
          from: '+19175559999',
          body: 'Hello',
          providerConfig: { accountSid: 'AC123' },
        }),
      ).rejects.toThrow('authToken');
    });

    it('calls Twilio REST API and returns result on success', async () => {
      const mockResponse = {
        sid: 'SM_new_message_123',
        status: 'queued',
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello from test',
        providerConfig: {
          accountSid: 'AC_test_account',
          authToken: 'test_token',
        },
      });

      expect(result.externalMessageId).toBe('SM_new_message_123');
      expect(result.provider).toBe('twilio');
      expect(result.status).toBe('queued');

      // Verify the fetch call
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://api.twilio.com/2010-04-01/Accounts/AC_test_account/Messages.json',
      );
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      );

      // Verify Basic auth header
      const authHeader = (options?.headers as Record<string, string>)['Authorization'];
      const expectedAuth = Buffer.from('AC_test_account:test_token').toString('base64');
      expect(authHeader).toBe(`Basic ${expectedAuth}`);

      fetchSpy.mockRestore();
    });

    it('marks a rejected fetch as an unknown provider outcome', async () => {
      const networkError = new TypeError('socket closed before response');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(networkError);

      const result = adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello',
        providerConfig: { accountSid: 'AC_test', authToken: 'test_token' },
      });

      await expect(result).rejects.toBeInstanceOf(ProviderSendOutcomeUnknownError);
      await expect(result).rejects.toMatchObject({
        providerId: 'twilio',
        stage: 'request',
        originalError: networkError,
      });
      fetchSpy.mockRestore();
    });

    it('marks an unreadable successful response as an unknown provider outcome', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('not-json', { status: 201 }),
      );

      const result = adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello',
        providerConfig: { accountSid: 'AC_test', authToken: 'test_token' },
      });

      await expect(result).rejects.toMatchObject({
        name: 'ProviderSendOutcomeUnknownError',
        providerId: 'twilio',
        stage: 'response',
      });
      fetchSpy.mockRestore();
    });

    it('marks a successful response without a message SID as an unknown outcome', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'queued' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello',
        providerConfig: { accountSid: 'AC_test', authToken: 'test_token' },
      });

      await expect(result).rejects.toMatchObject({
        name: 'ProviderSendOutcomeUnknownError',
        providerId: 'twilio',
        stage: 'response',
      });
      fetchSpy.mockRestore();
    });

    it('throws on non-OK response from Twilio', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{"message":"Invalid credentials"}', {
          status: 401,
        }),
      );

      const result = adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello',
        providerConfig: {
          accountSid: 'AC_bad',
          authToken: 'bad_token',
        },
      });
      await expect(result).rejects.toThrow('401');
      await expect(result).rejects.not.toBeInstanceOf(ProviderSendOutcomeUnknownError);

      fetchSpy.mockRestore();
    });
  });
});
