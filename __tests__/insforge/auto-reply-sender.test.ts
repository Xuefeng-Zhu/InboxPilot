import { describe, expect, it, vi } from 'vitest';
import {
  createAutoReplySenderWithOperations,
  type AutoReplySenderOperations,
} from '../../insforge/functions/_shared/auto-reply-sender';
import { NonRetryableJobError } from '../../insforge/functions/_shared/run-claimed-job';
import { ProviderSendOutcomeUnknownError } from '../../packages/support-core/src/adapters/provider-send-outcome-unknown-error';
import { OutboundMessagePostDispatchError } from '../../packages/support-core/src/services/outbound-message-service';
import type {
  Channel,
  Conversation,
  Message,
} from '../../packages/support-core/src/types';

function conversation(channel: Channel = 'sms'): Conversation {
  return {
    id: 'conversation-1',
    organizationId: 'org-1',
    contactId: 'contact-1',
    channel,
    status: 'open',
    aiState: 'auto_replied',
    subject: null,
    assignedTo: null,
    lastMessageAt: null,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function outboundMessage(channel: Channel = 'sms'): Message {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    senderType: 'ai',
    senderId: null,
    direction: 'outbound',
    channel,
    body: 'Hello',
    subject: null,
    rawPayload: {},
    provider: channel === 'webchat' ? 'webchat' : 'twilio',
    providerAccountId: channel === 'webchat' ? null : 'account-1',
    externalMessageId: channel === 'webchat' ? 'webchat-message-1' : 'SM123',
    deliveryStatus: 'queued',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function postDispatchError(dispatchedMessage: Message | null): OutboundMessagePostDispatchError {
  return new OutboundMessagePostDispatchError({
    originalError: new Error('local finalization failed'),
    stage: dispatchedMessage ? 'conversation_update' : 'message_persistence',
    dispatchedMessage,
    receipt: {
      channel: dispatchedMessage?.channel ?? 'sms',
      provider: dispatchedMessage?.provider ?? 'twilio',
      providerAccountId: dispatchedMessage?.providerAccountId ?? 'account-1',
      externalMessageId: dispatchedMessage?.externalMessageId ?? 'SM123',
      deliveryStatus: 'queued',
    },
  });
}

function operations(
  overrides: Partial<AutoReplySenderOperations> = {},
): AutoReplySenderOperations {
  return {
    findConversation: vi.fn().mockResolvedValue(conversation()),
    resolveProviderConfig: vi.fn().mockResolvedValue({ accountSid: 'configured' }),
    sendReply: vi.fn().mockResolvedValue(outboundMessage()),
    updateDecision: vi.fn().mockResolvedValue(undefined),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    findWebchatThread: vi.fn().mockResolvedValue(null),
    publishRealtime: vi.fn().mockResolvedValue(true),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('auto-reply sender', () => {
  it('converts an unknown provider outcome into a non-retryable job error', async () => {
    const ops = operations({
      sendReply: vi.fn().mockRejectedValue(new ProviderSendOutcomeUnknownError({
        providerId: 'twilio',
        stage: 'request',
        message: 'request failed without a provider response',
        originalError: new Error('socket closed'),
      })),
    });

    await expect(createAutoReplySenderWithOperations(ops)(
      'conversation-1',
      'Hello',
      'decision-1',
    )).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(ops.writeAudit).not.toHaveBeenCalled();
    expect(ops.publishRealtime).not.toHaveBeenCalled();
    expect(ops.updateDecision).not.toHaveBeenCalled();
  });

  it('stores durable reconciliation markers when provider acceptance precedes message persistence', async () => {
    const ops = operations({
      sendReply: vi.fn().mockRejectedValue(postDispatchError(null)),
    });

    await expect(createAutoReplySenderWithOperations(ops)(
      'conversation-1',
      'Hello',
      'decision-1',
    )).resolves.toBeUndefined();
    expect(ops.updateDecision).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({
        autoSent: true,
        reconciliationRequired: true,
        finalizationStage: 'message_persistence',
        externalMessageId: 'SM123',
      }),
    );
    expect(ops.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      actorId: null,
      actorType: 'ai',
      action: 'message_sent',
      resourceId: null,
      metadata: expect.objectContaining({
        trigger: 'auto_reply',
        reconciliationRequired: true,
      }),
    }));
    expect(ops.publishRealtime).not.toHaveBeenCalled();
  });

  it('reconciles a persisted dispatch and still publishes its realtime event', async () => {
    const message = outboundMessage();
    const ops = operations({
      sendReply: vi.fn().mockRejectedValue(postDispatchError(message)),
    });

    await expect(createAutoReplySenderWithOperations(ops)(
      'conversation-1',
      'Hello',
      'decision-1',
    )).resolves.toBeUndefined();
    expect(ops.updateDecision).toHaveBeenCalledTimes(1);
    expect(ops.updateDecision).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({
        reconciliationRequired: true,
        messageId: 'message-1',
      }),
    );
    expect(ops.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'ai',
      resourceId: 'message-1',
      metadata: expect.objectContaining({ reconciliationRequired: true }),
    }));
    expect(ops.publishRealtime).toHaveBeenCalledOnce();
    expect(ops.publishRealtime).toHaveBeenCalledWith(
      'org:org-1',
      'new_message',
      { message, conversationId: 'conversation-1' },
      'sendAutoReply message message-1',
    );
  });

  it('publishes webchat replies to the widget before the organization channel', async () => {
    const webchatConversation = conversation('webchat');
    const message = outboundMessage('webchat');
    const ops = operations({
      findConversation: vi.fn().mockResolvedValue(webchatConversation),
      sendReply: vi.fn().mockResolvedValue(message),
      findWebchatThread: vi.fn().mockResolvedValue({
        widgetId: 'widget-1',
        visitorTokenJti: 'visitor-1',
      }),
    });

    await createAutoReplySenderWithOperations(ops)(
      'conversation-1',
      'Hello',
      'decision-1',
    );

    expect(ops.publishRealtime).toHaveBeenNthCalledWith(
      1,
      'widget:widget-1:visitor-1',
      'new_message',
      { message, conversationId: 'conversation-1' },
      'sendAutoReply message message-1',
    );
    expect(ops.publishRealtime).toHaveBeenNthCalledWith(
      2,
      'org:org-1',
      'new_message',
      { message, conversationId: 'conversation-1' },
      'sendAutoReply message message-1',
    );
    expect(ops.updateDecision).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({ autoSent: true }),
    );
  });

  it('logs a webchat thread lookup failure and still broadcasts to the organization', async () => {
    const message = outboundMessage('webchat');
    const ops = operations({
      findConversation: vi.fn().mockResolvedValue(conversation('webchat')),
      sendReply: vi.fn().mockResolvedValue(message),
      findWebchatThread: vi.fn().mockRejectedValue(new Error('thread lookup failed')),
    });

    await expect(createAutoReplySenderWithOperations(ops)(
      'conversation-1',
      'Hello',
      'decision-1',
    )).resolves.toBeUndefined();
    expect(ops.logError).toHaveBeenCalledWith(expect.stringContaining('thread lookup failed'));
    expect(ops.publishRealtime).toHaveBeenCalledOnce();
    expect(ops.publishRealtime).toHaveBeenCalledWith(
      'org:org-1',
      'new_message',
      { message, conversationId: 'conversation-1' },
      'sendAutoReply message message-1',
    );
  });
});
