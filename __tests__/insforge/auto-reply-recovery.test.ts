import { describe, expect, it, vi } from 'vitest';
import { OutboundMessagePostDispatchError } from '../../packages/support-core/src/services/outbound-message-service';
import { reconcileAcceptedDispatch } from '../../insforge/functions/_shared/accepted-dispatch-reconciliation';
import { enqueueAutoReplyFallback } from '../../insforge/functions/_shared/auto-reply-fallback';
import { NonRetryableJobError } from '../../insforge/functions/_shared/run-claimed-job';
import { ProviderSendOutcomeUnknownError } from '../../packages/support-core/src/adapters/provider-send-outcome-unknown-error';
import { dispatchQueuedAutoReply } from '../../insforge/functions/_shared/queued-auto-reply-dispatch';

function postDispatchError(): OutboundMessagePostDispatchError {
  return new OutboundMessagePostDispatchError({
    originalError: new Error('message persistence failed'),
    stage: 'message_persistence',
    dispatchedMessage: null,
    receipt: {
      channel: 'sms',
      provider: 'twilio',
      providerAccountId: 'account-1',
      externalMessageId: 'SM123',
      deliveryStatus: 'queued',
    },
  });
}

describe('auto-reply recovery', () => {
  it('accepts a provider dispatch when either durable reconciliation write succeeds', async () => {
    const updateDecision = vi.fn().mockRejectedValue(new Error('decision write failed'));
    const writeAudit = vi.fn().mockResolvedValue(undefined);

    await expect(reconcileAcceptedDispatch({
      error: postDispatchError(),
      aiDecisionId: 'decision-1',
      updateDecision,
      writeAudit,
    })).resolves.toBeUndefined();
    expect(updateDecision).toHaveBeenCalledOnce();
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it('raises a non-retryable error when no reconciliation marker can be stored', async () => {
    await expect(reconcileAcceptedDispatch({
      error: postDispatchError(),
      aiDecisionId: 'decision-1',
      updateDecision: vi.fn().mockRejectedValue(new Error('decision write failed')),
      writeAudit: vi.fn().mockRejectedValue(new Error('audit write failed')),
    })).rejects.toBeInstanceOf(NonRetryableJobError);
  });

  it('enqueues one fallback only for retryable pre-acceptance failures', async () => {
    const jobQueue = { enqueue: vi.fn().mockResolvedValue({}) };
    await enqueueAutoReplyFallback({
      error: new Error('provider unavailable'),
      jobQueue,
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      responseText: 'Hello',
      aiDecisionId: 'decision-1',
      organizationId: 'org-1',
    });
    expect(jobQueue.enqueue).toHaveBeenCalledOnce();

    await expect(enqueueAutoReplyFallback({
      error: new NonRetryableJobError('provider accepted'),
      jobQueue,
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      responseText: 'Hello',
      aiDecisionId: 'decision-1',
      organizationId: 'org-1',
    })).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(jobQueue.enqueue).toHaveBeenCalledOnce();
  });

  it('does not enqueue fallback when the provider request outcome is unknown', async () => {
    const jobQueue = { enqueue: vi.fn().mockResolvedValue({}) };
    const error = new ProviderSendOutcomeUnknownError({
      providerId: 'twilio',
      stage: 'request',
      message: 'request failed without a provider response',
      originalError: new Error('socket closed'),
    });

    await expect(enqueueAutoReplyFallback({
      error,
      jobQueue,
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      responseText: 'Hello',
      aiDecisionId: 'decision-1',
      organizationId: 'org-1',
    })).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'escalated'])(
    'suppresses a delayed fallback after a manual %s action',
    async () => {
      const claimSourceTurn = vi.fn().mockResolvedValue(false);
      const send = vi.fn();

      await expect(dispatchQueuedAutoReply({
        sourceMessageId: 'message-1',
        claimSourceTurn,
        send,
      })).resolves.toBe(false);

      expect(claimSourceTurn).toHaveBeenCalledOnce();
      expect(claimSourceTurn).toHaveBeenCalledWith('message-1');
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('dispatches a fallback only after its source-turn claim succeeds', async () => {
    const claimSourceTurn = vi.fn().mockResolvedValue(true);
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(dispatchQueuedAutoReply({
      sourceMessageId: 'message-1',
      claimSourceTurn,
      send,
    })).resolves.toBe(true);

    expect(claimSourceTurn.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
  });
});
