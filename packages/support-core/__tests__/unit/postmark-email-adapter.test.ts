import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostmarkEmailAdapter } from '@support-core/adapters/postmark-email-adapter';
import type { WebhookVerificationRequest } from '@support-core/types/index';

describe('PostmarkEmailAdapter', () => {
  let adapter: PostmarkEmailAdapter;

  beforeEach(() => {
    adapter = new PostmarkEmailAdapter();
  });

  it('has providerId "postmark"', () => {
    expect(adapter.providerId).toBe('postmark');
  });

  // ─── parseInboundWebhook ───────────────────────────────────────────

  describe('parseInboundWebhook', () => {
    it('parses a valid Postmark inbound payload', () => {
      const payload = {
        From: 'customer@example.com',
        To: 'support@company.com',
        Subject: 'Help needed',
        TextBody: 'I need help with my order',
        HtmlBody: '<p>I need help with my order</p>',
        MessageID: 'abc-123-def',
      };

      const result = adapter.parseInboundWebhook(payload);

      expect(result.from).toBe('customer@example.com');
      expect(result.to).toBe('support@company.com');
      expect(result.subject).toBe('Help needed');
      expect(result.bodyText).toBe('I need help with my order');
      expect(result.bodyHtml).toBe('<p>I need help with my order</p>');
      expect(result.externalMessageId).toBe('abc-123-def');
      expect(result.rawPayload).toEqual(expect.objectContaining({
        From: 'customer@example.com',
        MessageID: 'abc-123-def',
      }));
    });

    it('parses payload without optional HtmlBody', () => {
      const payload = {
        From: 'customer@example.com',
        To: 'support@company.com',
        Subject: 'Question',
        TextBody: 'Plain text only',
        MessageID: 'msg-001',
      };

      const result = adapter.parseInboundWebhook(payload);

      expect(result.bodyHtml).toBeUndefined();
    });

    it('extracts InReplyTo from direct field', () => {
      const payload = {
        From: 'customer@example.com',
        To: 'support@company.com',
        Subject: 'Re: Help',
        TextBody: 'Thanks',
        MessageID: 'msg-002',
        InReplyTo: '<original-msg-id@example.com>',
      };

      const result = adapter.parseInboundWebhook(payload);

      expect(result.inReplyTo).toBe('<original-msg-id@example.com>');
    });

    it('extracts InReplyTo from Headers array', () => {
      const payload = {
        From: 'customer@example.com',
        To: 'support@company.com',
        Subject: 'Re: Help',
        TextBody: 'Thanks',
        MessageID: 'msg-003',
        Headers: [
          { Name: 'In-Reply-To', Value: '<prev-msg@example.com>' },
          { Name: 'X-Custom', Value: 'test' },
        ],
      };

      const result = adapter.parseInboundWebhook(payload);

      expect(result.inReplyTo).toBe('<prev-msg@example.com>');
    });

    it('omits inReplyTo when not present', () => {
      const payload = {
        From: 'customer@example.com',
        To: 'support@company.com',
        Subject: 'New thread',
        TextBody: 'Hello',
        MessageID: 'msg-004',
      };

      const result = adapter.parseInboundWebhook(payload);

      expect(result.inReplyTo).toBeUndefined();
    });

    it('throws on missing From field', () => {
      expect(() =>
        adapter.parseInboundWebhook({
          To: 'support@company.com',
          Subject: 'Test',
          TextBody: 'text',
          MessageID: 'msg-005',
        }),
      ).toThrow('From');
    });

    it('throws on missing MessageID field', () => {
      expect(() =>
        adapter.parseInboundWebhook({
          From: 'customer@example.com',
          To: 'support@company.com',
          Subject: 'Test',
          TextBody: 'text',
        }),
      ).toThrow('MessageID');
    });

    it('throws on null body', () => {
      expect(() => adapter.parseInboundWebhook(null)).toThrow();
    });

    it('throws on non-object body', () => {
      expect(() => adapter.parseInboundWebhook('string')).toThrow();
    });

    it('throws on array body', () => {
      expect(() => adapter.parseInboundWebhook([1, 2, 3])).toThrow();
    });
  });

  // ─── parseStatusWebhook ────────────────────────────────────────────

  describe('parseStatusWebhook', () => {
    it('parses a Delivery status', () => {
      const result = adapter.parseStatusWebhook({
        MessageID: 'msg-100',
        RecordType: 'Delivery',
        DeliveredAt: '2024-01-15T10:30:00Z',
      });

      expect(result.externalMessageId).toBe('msg-100');
      expect(result.status).toBe('delivered');
    });

    it('parses a Bounce status with error details', () => {
      const result = adapter.parseStatusWebhook({
        MessageID: 'msg-101',
        RecordType: 'Bounce',
        TypeCode: 1,
        Description: 'Hard bounce',
        BouncedAt: '2024-01-15T10:30:00Z',
      });

      expect(result.externalMessageId).toBe('msg-101');
      expect(result.status).toBe('bounced');
      expect(result.errorCode).toBe('1');
      expect(result.errorMessage).toBe('Hard bounce');
    });

    it('maps SpamComplaint to failed', () => {
      const result = adapter.parseStatusWebhook({
        MessageID: 'msg-102',
        RecordType: 'SpamComplaint',
      });

      expect(result.status).toBe('failed');
    });

    it('maps unknown RecordType to pending', () => {
      const result = adapter.parseStatusWebhook({
        MessageID: 'msg-103',
        RecordType: 'Open',
      });

      expect(result.status).toBe('pending');
    });

    it('omits errorCode when TypeCode is not present', () => {
      const result = adapter.parseStatusWebhook({
        MessageID: 'msg-104',
        RecordType: 'Delivery',
      });

      expect(result.errorCode).toBeUndefined();
    });

    it('omits errorMessage when Description is empty', () => {
      const result = adapter.parseStatusWebhook({
        MessageID: 'msg-105',
        RecordType: 'Delivery',
        Description: '',
      });

      expect(result.errorMessage).toBeUndefined();
    });

    it('throws on missing MessageID', () => {
      expect(() =>
        adapter.parseStatusWebhook({ RecordType: 'Delivery' }),
      ).toThrow('MessageID');
    });

    it('throws on missing RecordType', () => {
      expect(() =>
        adapter.parseStatusWebhook({ MessageID: 'msg-106' }),
      ).toThrow('RecordType');
    });
  });

  // ─── verifyWebhook ────────────────────────────────────────────────

  describe('verifyWebhook', () => {
    const serverToken = 'test-postmark-server-token-12345';

    it('returns true when x-postmark-server-token matches', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'x-postmark-server-token': serverToken,
        },
        body: '{}',
        signingSecret: serverToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(true);
    });

    it('returns true with capitalized header name', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'X-Postmark-Server-Token': serverToken,
        },
        body: '{}',
        signingSecret: serverToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(true);
    });

    it('returns false when token does not match', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'x-postmark-server-token': 'wrong-token',
        },
        body: '{}',
        signingSecret: serverToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when header is missing', async () => {
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '{}',
        signingSecret: serverToken,
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when signingSecret is empty', async () => {
      const req: WebhookVerificationRequest = {
        headers: {
          'x-postmark-server-token': serverToken,
        },
        body: '{}',
        signingSecret: '',
      };

      expect(await adapter.verifyWebhook(req)).toBe(false);
    });
  });

  // ─── sendEmail ────────────────────────────────────────────────────

  describe('sendEmail', () => {
    it('throws when serverToken is missing', async () => {
      await expect(
        adapter.sendEmail({
          to: 'customer@example.com',
          from: 'support@company.com',
          subject: 'Test',
          bodyText: 'Hello',
          providerConfig: {},
        }),
      ).rejects.toThrow('serverToken');
    });

    it('calls Postmark REST API and returns result on success', async () => {
      const mockResponse = {
        MessageID: 'pm-msg-abc-123',
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await adapter.sendEmail({
        to: 'customer@example.com',
        from: 'support@company.com',
        subject: 'Re: Your inquiry',
        bodyText: 'Hello, thanks for reaching out!',
        bodyHtml: '<p>Hello, thanks for reaching out!</p>',
        providerConfig: {
          serverToken: 'test-server-token',
        },
      });

      expect(result.externalMessageId).toBe('pm-msg-abc-123');
      expect(result.provider).toBe('postmark');
      expect(result.status).toBe('queued');

      // Verify the fetch call
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.postmarkapp.com/email');
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual(
        expect.objectContaining({
          'X-Postmark-Server-Token': 'test-server-token',
          'Content-Type': 'application/json',
        }),
      );

      // Verify the body contains expected fields
      const sentBody = JSON.parse(options?.body as string);
      expect(sentBody.From).toBe('support@company.com');
      expect(sentBody.To).toBe('customer@example.com');
      expect(sentBody.Subject).toBe('Re: Your inquiry');
      expect(sentBody.TextBody).toBe('Hello, thanks for reaching out!');
      expect(sentBody.HtmlBody).toBe('<p>Hello, thanks for reaching out!</p>');

      fetchSpy.mockRestore();
    });

    it('throws on non-OK response from Postmark', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{"ErrorCode":10,"Message":"Bad request"}', {
          status: 422,
        }),
      );

      await expect(
        adapter.sendEmail({
          to: 'customer@example.com',
          from: 'support@company.com',
          subject: 'Test',
          bodyText: 'Hello',
          providerConfig: {
            serverToken: 'bad-token',
          },
        }),
      ).rejects.toThrow('422');

      fetchSpy.mockRestore();
    });
  });
});
