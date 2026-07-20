import { describe, expect, it, vi } from 'vitest';
import {
  createInboundWebhookHandler,
  createStatusWebhookHandler,
  type InboundWebhookPipelineConfig,
  type StatusWebhookPipelineConfig,
  type WebhookPipelineDependencies,
} from '../../insforge/functions/_shared/webhook-handler-pipelines';
import type { DatabaseClient } from '../../packages/support-core/src/interfaces/database-client';
import type {
  Message,
  NormalizedInboundEmail,
  NormalizedInboundSms,
} from '../../packages/support-core/src/types';
import { InboundMessageService } from '../../packages/support-core/src/services/inbound-message-service';
import type { ContactRepository } from '../../packages/support-core/src/repositories/contact-repository';
import type { ConversationRepository } from '../../packages/support-core/src/repositories/conversation-repository';
import type { MessageRepository } from '../../packages/support-core/src/repositories/message-repository';
import type { AuditLogRepository } from '../../packages/support-core/src/repositories/audit-log-repository';
import type { JobQueue } from '../../packages/support-core/src/interfaces/job-queue';

const MESSAGE: Message = {
  id: 'message-1',
  conversationId: 'conversation-1',
  senderType: 'contact',
  senderId: null,
  direction: 'inbound',
  channel: 'sms',
  body: 'Hello',
  subject: null,
  rawPayload: {},
  provider: 'telnyx',
  providerAccountId: 'account-1',
  externalMessageId: 'external-1',
  deliveryStatus: 'delivered',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const NORMALIZED_SMS: NormalizedInboundSms = {
  from: '+15550000001',
  to: '+15550000002',
  body: 'Hello',
  externalMessageId: 'external-1',
  rawPayload: { source: 'test' },
};

function unusedDatabase(): DatabaseClient {
  return {
    from() {
      throw new Error('Unexpected database query in pipeline test');
    },
    async rpc() {
      throw new Error('Unexpected RPC in pipeline test');
    },
  };
}

function createDependencies(input?: {
  message?: Message | null;
}) {
  const processInboundSms = vi.fn().mockResolvedValue(MESSAGE);
  const processInboundEmail = vi.fn().mockResolvedValue(MESSAGE);
  const findByExternalId = vi.fn().mockResolvedValue(
    input && 'message' in input ? input.message : MESSAGE,
  );
  const updateDeliveryStatus = vi.fn().mockResolvedValue(MESSAGE);
  const createDeliveryEvent = vi.fn().mockResolvedValue({ id: 'event-1' });
  const publish = vi.fn().mockResolvedValue(undefined);

  const dependencies: WebhookPipelineDependencies = {
    getRuntimeConfig: () => ({
      baseUrl: 'https://project.insforge.test',
      serviceRoleKey: 'service-role-key',
      localMockOptIn: undefined,
    }),
    createDatabase: () => unusedDatabase(),
    createInboundService: () => ({
      processInboundSms,
      processInboundEmail,
    }),
    createMessageRepository: () => ({
      findByExternalId,
      updateDeliveryStatus,
    }),
    createDeliveryEventRepository: () => ({ create: createDeliveryEvent }),
    createRealtimePublisher: () => ({ publish }),
  };

  return {
    dependencies,
    processInboundSms,
    findByExternalId,
    updateDeliveryStatus,
    createDeliveryEvent,
    publish,
  };
}

function inboundConfig(input?: { signatureValid?: boolean }) {
  const verifyWebhook = vi.fn().mockResolvedValue(input?.signatureValid ?? true);
  const resolveContext = vi.fn().mockResolvedValue({
    organizationId: 'organization-1',
    providerAccountId: 'account-1',
    provider: 'trusted-telnyx',
    signingSecret: 'stored-signing-secret',
  });

  const config: InboundWebhookPipelineConfig<NormalizedInboundSms> = {
    channelLabel: 'SMS',
    errorPrefix: 'sms-inbound',
    createAdapter: () => ({
      parseInboundWebhook: () => NORMALIZED_SMS,
      verifyWebhook,
    }),
    parseBody: (rawBody) => JSON.parse(rawBody),
    destination: (normalized) => normalized.to,
    resolveContext,
    processInbound: (service, normalized, organizationId, provider) => (
      service.processInboundSms(normalized, organizationId, provider)
    ),
  };

  return { config, verifyWebhook, resolveContext };
}

function statusConfig(input?: { signatureValid?: boolean }) {
  const verifyWebhook = vi.fn().mockResolvedValue(input?.signatureValid ?? true);
  const resolveContext = vi.fn().mockResolvedValue({
    organizationId: 'organization-1',
    providerAccountId: 'account-1',
    provider: 'telnyx',
    signingSecret: 'stored-signing-secret',
  });

  const config: StatusWebhookPipelineConfig = {
    channel: 'sms',
    channelLabel: 'SMS',
    errorPrefix: 'sms-status',
    createAdapter: () => ({
      parseStatusWebhook: () => ({
        externalMessageId: 'external-1',
        status: 'delivered',
        rawPayload: { source: 'test' },
      }),
      verifyWebhook,
    }),
    parseBody: (rawBody) => JSON.parse(rawBody),
    resolveContext,
  };

  return { config, verifyWebhook, resolveContext };
}

function createConflictingInboundService() {
  const enqueue = vi.fn();
  const ensureMessageReceived = vi.fn();
  const service = new InboundMessageService(
    {} as unknown as ContactRepository,
    {
      findById: vi.fn().mockResolvedValue({
        id: MESSAGE.conversationId,
        organizationId: 'another-organization',
      }),
    } as unknown as ConversationRepository,
    {
      findByExternalId: vi.fn().mockResolvedValue(MESSAGE),
    } as unknown as MessageRepository,
    {
      enqueue,
      claim: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    } satisfies JobQueue,
    { ensureMessageReceived } as unknown as AuditLogRepository,
  );

  return { service, enqueue, ensureMessageReceived };
}

describe('shared inbound webhook pipeline', () => {
  it('uses trusted account context for processing and realtime publication', async () => {
    const { dependencies, processInboundSms, publish } = createDependencies();
    const { config, verifyWebhook, resolveContext } = inboundConfig();
    const handler = createInboundWebhookHandler(config, dependencies);

    const response = await handler(new Request('https://functions.test/sms-inbound', {
      method: 'POST',
      headers: { 'x-provider': 'telnyx', 'x-signature': 'signed' },
      body: JSON.stringify({ data: 'provider payload' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', data: {
      ...MESSAGE,
      createdAt: MESSAGE.createdAt.toISOString(),
      updatedAt: MESSAGE.updatedAt.toISOString(),
    } });
    expect(resolveContext).toHaveBeenCalledWith(
      expect.anything(),
      'telnyx',
      NORMALIZED_SMS.to,
      'https://project.insforge.test',
      'service-role-key',
    );
    expect(verifyWebhook).toHaveBeenCalledWith({
      headers: expect.objectContaining({ 'x-provider': 'telnyx', 'x-signature': 'signed' }),
      body: JSON.stringify({ data: 'provider payload' }),
      signingSecret: 'stored-signing-secret',
    });
    expect(processInboundSms).toHaveBeenCalledWith(
      NORMALIZED_SMS,
      'organization-1',
      'trusted-telnyx',
    );
    expect(publish).toHaveBeenCalledWith(
      'org:organization-1',
      'new_message',
      { message: MESSAGE, conversationId: MESSAGE.conversationId },
    );
  });

  it('rejects an invalid signature before persistence or publication', async () => {
    const { dependencies, processInboundSms, publish } = createDependencies();
    const { config } = inboundConfig({ signatureValid: false });
    const handler = createInboundWebhookHandler(config, dependencies);

    const response = await handler(new Request('https://functions.test/sms-inbound', {
      method: 'POST',
      headers: { 'x-provider': 'telnyx' },
      body: '{}',
    }));

    expect(response.status).toBe(401);
    expect(processInboundSms).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a missing provider before constructing an adapter', async () => {
    const { dependencies } = createDependencies();
    const { config } = inboundConfig();
    const createAdapter = vi.fn(config.createAdapter);
    const handler = createInboundWebhookHandler({ ...config, createAdapter }, dependencies);

    const response = await handler(new Request('https://functions.test/sms-inbound', {
      method: 'POST',
      body: '{}',
    }));

    expect(response.status).toBe(400);
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it('returns a non-retryable SMS conflict without duplicate repair writes', async () => {
    const { dependencies, publish } = createDependencies();
    const { service, enqueue, ensureMessageReceived } = createConflictingInboundService();
    dependencies.createInboundService = () => service;
    const { config } = inboundConfig();
    const handler = createInboundWebhookHandler(config, dependencies);

    const response = await handler(new Request('https://functions.test/sms-inbound', {
      method: 'POST',
      headers: { 'x-provider': 'telnyx' },
      body: '{}',
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Inbound message conflict' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(ensureMessageReceived).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns a non-retryable email conflict without duplicate repair writes', async () => {
    const { dependencies, publish } = createDependencies();
    const { service, enqueue, ensureMessageReceived } = createConflictingInboundService();
    dependencies.createInboundService = () => service;
    const normalizedEmail: NormalizedInboundEmail = {
      from: 'customer@example.test',
      to: 'support@example.test',
      subject: 'Help',
      bodyText: 'Hello',
      externalMessageId: 'external-1',
      rawPayload: {},
    };
    const config: InboundWebhookPipelineConfig<NormalizedInboundEmail> = {
      channelLabel: 'email',
      errorPrefix: 'email-inbound',
      createAdapter: () => ({
        parseInboundWebhook: () => normalizedEmail,
        verifyWebhook: vi.fn().mockResolvedValue(true),
      }),
      parseBody: (rawBody) => JSON.parse(rawBody),
      destination: (normalized) => normalized.to,
      resolveContext: vi.fn().mockResolvedValue({
        organizationId: 'organization-1',
        providerAccountId: 'account-1',
        provider: 'postmark',
        signingSecret: 'stored-signing-secret',
      }),
      processInbound: (inboundService, normalized, organizationId, provider) => (
        inboundService.processInboundEmail(normalized, organizationId, provider)
      ),
    };
    const handler = createInboundWebhookHandler(config, dependencies);

    const response = await handler(new Request('https://functions.test/email-inbound', {
      method: 'POST',
      headers: { 'x-provider': 'postmark' },
      body: '{}',
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Inbound message conflict' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(ensureMessageReceived).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('shared status webhook pipeline', () => {
  it('verifies, records, and applies a normalized delivery status', async () => {
    const {
      dependencies,
      findByExternalId,
      updateDeliveryStatus,
      createDeliveryEvent,
    } = createDependencies();
    const { config, verifyWebhook } = statusConfig();
    const handler = createStatusWebhookHandler(config, dependencies);

    const response = await handler(new Request('https://functions.test/sms-status', {
      method: 'POST',
      headers: { 'x-provider': 'telnyx' },
      body: '{}',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      data: { messageId: MESSAGE.id, deliveryStatus: 'delivered' },
    });
    expect(verifyWebhook).toHaveBeenCalledWith(expect.objectContaining({
      signingSecret: 'stored-signing-secret',
    }));
    expect(findByExternalId).toHaveBeenCalledWith('telnyx', 'external-1');
    expect(createDeliveryEvent).toHaveBeenCalledWith('sms', {
      messageId: MESSAGE.id,
      providerAccountId: MESSAGE.providerAccountId,
      status: 'delivered',
      errorCode: null,
      errorMessage: null,
      rawPayload: { source: 'test' },
    });
    expect(updateDeliveryStatus).toHaveBeenCalledWith(MESSAGE.id, 'delivered');
  });

  it('acknowledges an unknown external message without writing a delivery event', async () => {
    const {
      dependencies,
      createDeliveryEvent,
      updateDeliveryStatus,
    } = createDependencies({ message: null });
    const { config } = statusConfig();
    const handler = createStatusWebhookHandler(config, dependencies);

    const response = await handler(new Request('https://functions.test/sms-status', {
      method: 'POST',
      headers: { 'x-provider': 'telnyx' },
      body: '{}',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      message: 'Message not found, status ignored',
    });
    expect(createDeliveryEvent).not.toHaveBeenCalled();
    expect(updateDeliveryStatus).not.toHaveBeenCalled();
  });
});
