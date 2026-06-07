import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockSmsAdapter } from '@support-core/adapters/mock-sms-adapter';
import type {
  SendSmsParams,
  WebhookVerificationRequest,
} from '@support-core/types/index';

describe('MockSmsAdapter', () => {
  let adapter: MockSmsAdapter;

  beforeEach(() => {
    adapter = new MockSmsAdapter();
  });

  it('has providerId "mock"', () => {
    expect(adapter.providerId).toBe('mock');
  });

  describe('sendSms', () => {
    const params: SendSmsParams = {
      to: '+12125551234',
      from: '+19175559999',
      body: 'Hello, world!',
      providerConfig: {},
    };

    it('returns a deterministic externalMessageId', async () => {
      const result = await adapter.sendSms(params);
      expect(result.externalMessageId).toBe('mock_sms_1');
      expect(result.provider).toBe('mock');
      expect(result.status).toBe('queued');
    });

    it('increments the counter for each send', async () => {
      const r1 = await adapter.sendSms(params);
      const r2 = await adapter.sendSms(params);
      const r3 = await adapter.sendSms(params);
      expect(r1.externalMessageId).toBe('mock_sms_1');
      expect(r2.externalMessageId).toBe('mock_sms_2');
      expect(r3.externalMessageId).toBe('mock_sms_3');
    });

    it('stores sent messages in memory', async () => {
      await adapter.sendSms(params);
      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0]).toEqual({
        to: '+12125551234',
        from: '+19175559999',
        body: 'Hello, world!',
        externalMessageId: 'mock_sms_1',
      });
    });
  });

  describe('clear', () => {
    it('resets sentMessages and counter', async () => {
      await adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'test',
        providerConfig: {},
      });
      expect(adapter.sentMessages).toHaveLength(1);

      adapter.clear();
      expect(adapter.sentMessages).toHaveLength(0);

      const result = await adapter.sendSms({
        to: '+12125551234',
        from: '+19175559999',
        body: 'after clear',
        providerConfig: {},
      });
      expect(result.externalMessageId).toBe('mock_sms_1');
    });
  });

  describe('parseInboundWebhook', () => {
    it('parses a valid inbound payload', () => {
      const result = adapter.parseInboundWebhook({
        from: '+12125551234',
        to: '+19175559999',
        body: 'Hi there',
        messageId: 'ext_123',
      });

      expect(result).toEqual({
        from: '+12125551234',
        to: '+19175559999',
        body: 'Hi there',
        externalMessageId: 'ext_123',
        rawPayload: {
          from: '+12125551234',
          to: '+19175559999',
          body: 'Hi there',
          messageId: 'ext_123',
        },
      });
    });

    it('throws on missing fields', () => {
      expect(() => adapter.parseInboundWebhook({})).toThrow();
      expect(() => adapter.parseInboundWebhook({ from: '+1' })).toThrow();
      expect(() =>
        adapter.parseInboundWebhook({ from: '+1', to: '+2', body: 'hi' }),
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
        messageId: 'ext_123',
        status: 'delivered',
      });

      expect(result).toEqual({
        externalMessageId: 'ext_123',
        status: 'delivered',
        rawPayload: { messageId: 'ext_123', status: 'delivered' },
      });
    });

    it('includes optional errorCode and errorMessage', () => {
      const result = adapter.parseStatusWebhook({
        messageId: 'ext_456',
        status: 'failed',
        errorCode: '30001',
        errorMessage: 'Unreachable',
      });

      expect(result.errorCode).toBe('30001');
      expect(result.errorMessage).toBe('Unreachable');
    });

    it('omits errorCode/errorMessage when not strings', () => {
      const result = adapter.parseStatusWebhook({
        messageId: 'ext_789',
        status: 'sent',
        errorCode: 123,
      });

      expect(result.errorCode).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });

    it('throws on invalid status value', () => {
      expect(() =>
        adapter.parseStatusWebhook({
          messageId: 'ext_123',
          status: 'unknown_status',
        }),
      ).toThrow('invalid status');
    });

    it('throws on missing fields', () => {
      expect(() => adapter.parseStatusWebhook({})).toThrow();
      expect(() =>
        adapter.parseStatusWebhook({ messageId: 'ext_123' }),
      ).toThrow();
    });
  });

  describe('verifyWebhook', () => {
    // CRITICAL-1 regression: the mock adapter must NEVER accept an unsigned
    // webhook. The default behavior (no MOCK_WEBHOOK_SECRET in env) is to
    // reject every call. Tests that need a positive path must set the env var
    // (and unset it in afterEach).
    const originalEnv = process.env.MOCK_WEBHOOK_SECRET;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MOCK_WEBHOOK_SECRET;
      } else {
        process.env.MOCK_WEBHOOK_SECRET = originalEnv;
      }
    });

    it('rejects when MOCK_WEBHOOK_SECRET is not set', async () => {
      delete process.env.MOCK_WEBHOOK_SECRET;
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '',
        signingSecret: 'anything',
      };
      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('rejects when MOCK_WEBHOOK_SECRET is set but signingSecret is empty', async () => {
      process.env.MOCK_WEBHOOK_SECRET = 'test-secret-123';
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '',
        signingSecret: '',
      };
      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('rejects when MOCK_WEBHOOK_SECRET is set and signingSecret does not match', async () => {
      process.env.MOCK_WEBHOOK_SECRET = 'test-secret-123';
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '',
        signingSecret: 'wrong-secret',
      };
      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('rejects when MOCK_WEBHOOK_SECRET is set and signingSecret is a prefix match (length mismatch)', async () => {
      process.env.MOCK_WEBHOOK_SECRET = 'test-secret-123';
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '',
        signingSecret: 'test-secret-',
      };
      expect(await adapter.verifyWebhook(req)).toBe(false);
    });

    it('accepts when MOCK_WEBHOOK_SECRET matches signingSecret exactly', async () => {
      process.env.MOCK_WEBHOOK_SECRET = 'test-secret-123';
      const req: WebhookVerificationRequest = {
        headers: {},
        body: '',
        signingSecret: 'test-secret-123',
      };
      expect(await adapter.verifyWebhook(req)).toBe(true);
    });
  });
});
