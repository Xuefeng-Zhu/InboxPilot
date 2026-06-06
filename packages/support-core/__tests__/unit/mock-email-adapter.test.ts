import { describe, it, expect, beforeEach } from 'vitest';
import { MockEmailAdapter } from '@support-core/adapters/mock-email-adapter';
import type {
  SendEmailParams,
  WebhookVerificationRequest,
} from '@support-core/types/index';

describe('MockEmailAdapter', () => {
  let adapter: MockEmailAdapter;

  beforeEach(() => {
    adapter = new MockEmailAdapter();
  });

  it('has providerId "mock"', () => {
    expect(adapter.providerId).toBe('mock');
  });

  describe('sendEmail', () => {
    const params: SendEmailParams = {
      to: 'customer@example.com',
      from: 'support@company.com',
      subject: 'Re: Your inquiry',
      bodyText: 'Hello, thanks for reaching out!',
      providerConfig: {},
    };

    it('returns a deterministic externalMessageId', async () => {
      const result = await adapter.sendEmail(params);
      expect(result.externalMessageId).toBe('mock_email_1');
      expect(result.provider).toBe('mock');
      expect(result.status).toBe('queued');
    });

    it('increments the counter for each send', async () => {
      const r1 = await adapter.sendEmail(params);
      const r2 = await adapter.sendEmail(params);
      const r3 = await adapter.sendEmail(params);
      expect(r1.externalMessageId).toBe('mock_email_1');
      expect(r2.externalMessageId).toBe('mock_email_2');
      expect(r3.externalMessageId).toBe('mock_email_3');
    });

    it('stores sent emails in memory', async () => {
      await adapter.sendEmail(params);
      expect(adapter.sentEmails).toHaveLength(1);
      expect(adapter.sentEmails[0]).toEqual({
        to: 'customer@example.com',
        from: 'support@company.com',
        subject: 'Re: Your inquiry',
        bodyText: 'Hello, thanks for reaching out!',
        externalMessageId: 'mock_email_1',
      });
    });

    it('stores optional bodyHtml and replyToMessageId', async () => {
      const htmlParams: SendEmailParams = {
        ...params,
        bodyHtml: '<p>Hello!</p>',
        replyToMessageId: 'prev_msg_123',
      };
      await adapter.sendEmail(htmlParams);
      expect(adapter.sentEmails[0]).toEqual({
        to: 'customer@example.com',
        from: 'support@company.com',
        subject: 'Re: Your inquiry',
        bodyText: 'Hello, thanks for reaching out!',
        bodyHtml: '<p>Hello!</p>',
        replyToMessageId: 'prev_msg_123',
        externalMessageId: 'mock_email_1',
      });
    });
  });

  describe('clear', () => {
    it('resets sentEmails and counter', async () => {
      await adapter.sendEmail({
        to: 'a@b.com',
        from: 'c@d.com',
        subject: 'Test',
        bodyText: 'test',
        providerConfig: {},
      });
      expect(adapter.sentEmails).toHaveLength(1);

      adapter.clear();
      expect(adapter.sentEmails).toHaveLength(0);

      const result = await adapter.sendEmail({
        to: 'a@b.com',
        from: 'c@d.com',
        subject: 'After clear',
        bodyText: 'after clear',
        providerConfig: {},
      });
      expect(result.externalMessageId).toBe('mock_email_1');
    });
  });

  describe('parseInboundWebhook', () => {
    it('parses a valid inbound payload', () => {
      const result = adapter.parseInboundWebhook({
        from: 'customer@example.com',
        to: 'support@company.com',
        subject: 'Help needed',
        bodyText: 'I need help with my order',
        messageId: 'ext_email_123',
      });

      expect(result).toEqual({
        from: 'customer@example.com',
        to: 'support@company.com',
        subject: 'Help needed',
        bodyText: 'I need help with my order',
        externalMessageId: 'ext_email_123',
        rawPayload: {
          from: 'customer@example.com',
          to: 'support@company.com',
          subject: 'Help needed',
          bodyText: 'I need help with my order',
          messageId: 'ext_email_123',
        },
      });
    });

    it('includes optional bodyHtml and inReplyTo', () => {
      const result = adapter.parseInboundWebhook({
        from: 'customer@example.com',
        to: 'support@company.com',
        subject: 'Re: Help needed',
        bodyText: 'Thanks for the reply',
        bodyHtml: '<p>Thanks for the reply</p>',
        messageId: 'ext_email_456',
        inReplyTo: 'ext_email_123',
      });

      expect(result.bodyHtml).toBe('<p>Thanks for the reply</p>');
      expect(result.inReplyTo).toBe('ext_email_123');
    });

    it('omits bodyHtml and inReplyTo when not strings', () => {
      const result = adapter.parseInboundWebhook({
        from: 'a@b.com',
        to: 'c@d.com',
        subject: 'Test',
        bodyText: 'text',
        messageId: 'ext_1',
        bodyHtml: 123,
        inReplyTo: true,
      });

      expect(result.bodyHtml).toBeUndefined();
      expect(result.inReplyTo).toBeUndefined();
    });

    it('throws on missing fields', () => {
      expect(() => adapter.parseInboundWebhook({})).toThrow();
      expect(() => adapter.parseInboundWebhook({ from: 'a@b.com' })).toThrow();
      expect(() =>
        adapter.parseInboundWebhook({
          from: 'a@b.com',
          to: 'c@d.com',
          subject: 'Test',
          bodyText: 'text',
        }),
      ).toThrow();
    });

    it('throws on null body', () => {
      expect(() => adapter.parseInboundWebhook(null)).toThrow();
    });

    it('throws on non-object body', () => {
      expect(() => adapter.parseInboundWebhook('string')).toThrow();
    });
  });

  describe('parseStatusWebhook', () => {
    it('parses a valid status payload', () => {
      const result = adapter.parseStatusWebhook({
        messageId: 'ext_email_123',
        status: 'delivered',
      });

      expect(result).toEqual({
        externalMessageId: 'ext_email_123',
        status: 'delivered',
        rawPayload: { messageId: 'ext_email_123', status: 'delivered' },
      });
    });

    it('includes optional errorCode and errorMessage', () => {
      const result = adapter.parseStatusWebhook({
        messageId: 'ext_email_456',
        status: 'failed',
        errorCode: '550',
        errorMessage: 'Mailbox not found',
      });

      expect(result.errorCode).toBe('550');
      expect(result.errorMessage).toBe('Mailbox not found');
    });

    it('omits errorCode/errorMessage when not strings', () => {
      const result = adapter.parseStatusWebhook({
        messageId: 'ext_email_789',
        status: 'sent',
        errorCode: 123,
      });

      expect(result.errorCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('throws on invalid status value', () => {
      expect(() =>
        adapter.parseStatusWebhook({
          messageId: 'ext_email_123',
          status: 'unknown_status',
        }),
      ).toThrow('invalid status');
    });

    it('throws on missing fields', () => {
      expect(() => adapter.parseStatusWebhook({})).toThrow();
      expect(() =>
        adapter.parseStatusWebhook({ messageId: 'ext_email_123' }),
      ).toThrow();
    });
  });

  describe('verifyWebhook', () => {
    it('always returns true', async () => {
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '',
        signingSecret: '',
      };
      expect(await adapter.verifyWebhook(req)).toBe(true);
    });
  });
});
