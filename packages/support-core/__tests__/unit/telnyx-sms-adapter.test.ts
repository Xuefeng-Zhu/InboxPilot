import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelnyxSmsAdapter } from '@support-core/adapters/telnyx-sms-adapter';
import type { WebhookVerificationRequest } from '@support-core/types/index';

/**
 * Helper: build a Telnyx inbound webhook payload.
 */
function buildInboundPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      event_type: 'message.received',
      payload: {
        from: { phone_number: '+12125551234' },
        to: [{ phone_number: '+19175559999' }],
        text: 'Hello from Telnyx',
        id: 'msg_telnyx_abc123',
        ...overrides,
      },
    },
  };
}

/**
 * Helper: build a Telnyx status webhook payload.
 */
function buildStatusPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      event_type: 'message.finalized',
      payload: {
        id: 'msg_telnyx_abc123',
        to: [{ status: 'delivered' }],
        ...overrides,
      },
    },
  };
}

describe('TelnyxSmsAdapter', () => {
  let adapter: TelnyxSmsAdapter;

  beforeEach(() => {
    adapter = new TelnyxSmsAdapter();
  });

  it('has providerId "telnyx"', () => {
    expect(adapter.providerId).toBe('telnyx');
  });

  // ─── parseInboundWebhook ───────────────────────────────────────────

  describe('parseInboundWebhook', () => {
    it('parses a valid Telnyx inbound payload (object)', () => {
      const payload = buildInboundPayload();
      const result = adapter.parseInboundWebhook(payload);

      expect(result.from).toBe('+12125551234');
      expect(result.to).toBe('+19175559999');
      expect(result.body).toBe('Hello from Telnyx');
      expect(result.externalMessageId).toBe('msg_telnyx_abc123');
      expect(result.rawPayload).toEqual(
        expect.objectContaining({
          from: { phone_number: '+12125551234' },
          id: 'msg_telnyx_abc123',
        }),
      );
    });

    it('parses a JSON string body', () => {
      const payload = buildInboundPayload();
      const result = adapter.parseInboundWebhook(JSON.stringify(payload));

      expect(result.from).toBe('+12125551234');
      expect(result.to).toBe('+19175559999');
      expect(result.body).toBe('Hello from Telnyx');
      expect(result.externalMessageId).toBe('msg_telnyx_abc123');
    });

    it('throws on missing from.phone_number', () => {
      const payload = buildInboundPayload({ from: {} });
      expect(() => adapter.parseInboundWebhook(payload)).toThrow('from.phone_number');
    });

    it('throws on missing to array', () => {
      const payload = buildInboundPayload({ to: [] });
      expect(() => adapter.parseInboundWebhook(payload)).toThrow('to[0].phone_number');
    });

    it('throws on missing text field', () => {
      const payload = buildInboundPayload({ text: undefined });
      expect(() => adapter.parseInboundWebhook(payload)).toThrow('text');
    });

    it('throws on missing id field', () => {
      const payload = buildInboundPayload({ id: undefined });
      expect(() => adapter.parseInboundWebhook(payload)).toThrow('id');
    });

    it('throws on null body', () => {
      expect(() => adapter.parseInboundWebhook(null)).toThrow();
    });

    it('throws on non-object body', () => {
      expect(() => adapter.parseInboundWebhook(42)).toThrow();
    });

    it('throws on invalid JSON string', () => {
      expect(() => adapter.parseInboundWebhook('not-json')).toThrow('not valid JSON');
    });

    it('throws when data is missing', () => {
      expect(() => adapter.parseInboundWebhook({})).toThrow('"data"');
    });

    it('throws when payload is missing from data', () => {
      expect(() =>
        adapter.parseInboundWebhook({ data: { event_type: 'message.received' } }),
      ).toThrow('"payload"');
    });
  });

  // ─── parseStatusWebhook ────────────────────────────────────────────

  describe('parseStatusWebhook', () => {
    it('parses a delivered status', () => {
      const payload = buildStatusPayload();
      const result = adapter.parseStatusWebhook(payload);

      expect(result.externalMessageId).toBe('msg_telnyx_abc123');
      expect(result.status).toBe('delivered');
    });

    it('maps "queued" to queued', () => {
      const payload = buildStatusPayload({ to: [{ status: 'queued' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('queued');
    });

    it('maps "sending" to queued', () => {
      const payload = buildStatusPayload({ to: [{ status: 'sending' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('queued');
    });

    it('maps "sent" to sent', () => {
      const payload = buildStatusPayload({ to: [{ status: 'sent' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('sent');
    });

    it('maps "sending_failed" to failed', () => {
      const payload = buildStatusPayload({ to: [{ status: 'sending_failed' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('failed');
    });

    it('maps "delivery_failed" to bounced', () => {
      const payload = buildStatusPayload({ to: [{ status: 'delivery_failed' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('bounced');
    });

    it('maps "delivery_unconfirmed" to pending', () => {
      const payload = buildStatusPayload({ to: [{ status: 'delivery_unconfirmed' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('pending');
    });

    it('maps unknown status to pending', () => {
      const payload = buildStatusPayload({ to: [{ status: 'some_future_status' }] });
      expect(adapter.parseStatusWebhook(payload).status).toBe('pending');
    });

    it('includes error information when present', () => {
      const payload = buildStatusPayload({
        errors: [{ code: '40300', title: 'Destination number unreachable' }],
      });
      const result = adapter.parseStatusWebhook(payload);

      expect(result.errorCode).toBe('40300');
      expect(result.errorMessage).toBe('Destination number unreachable');
    });

    it('omits error fields when errors array is empty', () => {
      const payload = buildStatusPayload({ errors: [] });
      const result = adapter.parseStatusWebhook(payload);

      expect(result.errorCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('omits error fields when errors is not present', () => {
      const payload = buildStatusPayload();
      const result = adapter.parseStatusWebhook(payload);

      expect(result.errorCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('parses a JSON string body', () => {
      const payload = buildStatusPayload();
      const result = adapter.parseStatusWebhook(JSON.stringify(payload));

      expect(result.externalMessageId).toBe('msg_telnyx_abc123');
      expect(result.status).toBe('delivered');
    });

    it('throws on missing id', () => {
      const payload = buildStatusPayload({ id: undefined });
      expect(() => adapter.parseStatusWebhook(payload)).toThrow('"id"');
    });

    it('throws on missing to[0].status', () => {
      const payload = buildStatusPayload({ to: [{}] });
      expect(() => adapter.parseStatusWebhook(payload)).toThrow('to[0].status');
    });

    it('throws on empty to array', () => {
      const payload = buildStatusPayload({ to: [] });
      expect(() => adapter.parseStatusWebhook(payload)).toThrow('to[0].status');
    });
  });

  // ─── verifyWebhook ────────────────────────────────────────────────

  describe('verifyWebhook', () => {
    it('returns true when signature and timestamp headers are present', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'telnyx-signature-ed25519': 'abc123signaturevalue',
          'telnyx-timestamp': '1234567890',
        },
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(true);
    });

    it('returns false when signature header is missing', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'telnyx-timestamp': '1234567890',
        },
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when timestamp header is missing', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'telnyx-signature-ed25519': 'abc123signaturevalue',
        },
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when signature is empty string', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'telnyx-signature-ed25519': '',
          'telnyx-timestamp': '1234567890',
        },
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when timestamp is empty string', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'telnyx-signature-ed25519': 'abc123signaturevalue',
          'telnyx-timestamp': '',
        },
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when signature is whitespace only', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'telnyx-signature-ed25519': '   ',
          'telnyx-timestamp': '1234567890',
        },
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when both headers are missing', async () => {
      const req: WebhookVerificationRequest = {
        headers: {},
        body: JSON.stringify(buildInboundPayload()),
        signingSecret: 'some-secret',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });
  });

  // ─── sendSms ──────────────────────────────────────────────────────

  describe('sendSms', () => {
    it('throws when apiKey is missing', async () => {
      await expect(
        adapter.sendSms({
          to: '+12125551234',
          from: '+19175559999',
          body: 'Hello',
          providerConfig: {},
        }),
      ).rejects.toThrow('apiKey');
    });

    it('calls Telnyx REST API and returns result on success', async () => {
      const mockResponse = {
        data: {
          id: 'msg_telnyx_new_123',
          type: 'message',
        },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello from test',
        providerConfig: { apiKey: 'KEY_test_telnyx' },
      });

      expect(result.externalMessageId).toBe('msg_telnyx_new_123');
      expect(result.provider).toBe('telnyx');
      expect(result.status).toBe('queued');

      // Verify the fetch call
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.telnyx.com/v2/messages');
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer KEY_test_telnyx',
        }),
      );

      // Verify the request body
      const sentBody = JSON.parse(options?.body as string);
      expect(sentBody.to).toBe('+12125551234');
      expect(sentBody.from).toBe('+19175559999');
      expect(sentBody.text).toBe('Hello from test');

      fetchSpy.mockRestore();
    });

    it('throws on non-OK response from Telnyx', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{"errors":[{"title":"Unauthorized"}]}', {
          status: 401,
        }),
      );

      await expect(
        adapter.sendSms({
          to: '+12125551234',
          from: '+19175559999',
          body: 'Hello',
          providerConfig: { apiKey: 'bad_key' },
        }),
      ).rejects.toThrow('401');

      fetchSpy.mockRestore();
    });
  });
});
