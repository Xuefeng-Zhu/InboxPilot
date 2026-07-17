import type { OutboundMessagePostDispatchError } from '../../../packages/support-core/src/services/outbound-message-service.ts';
import { NonRetryableJobError } from './run-claimed-job.ts';

/**
 * Persist at least one durable marker for a provider-accepted dispatch that
 * has no message row. Failure is non-retryable because replaying would send a
 * duplicate customer message.
 */
export async function reconcileAcceptedDispatch(input: {
  error: OutboundMessagePostDispatchError;
  aiDecisionId: string | null;
  updateDecision: (metadata: Record<string, unknown>) => Promise<void>;
  writeAudit: (metadata: Record<string, unknown>) => Promise<void>;
  logError?: (message: string) => void;
}): Promise<void> {
  const metadata = {
    autoSent: true,
    reconciliationRequired: true,
    finalizationStage: input.error.stage,
    externalMessageId: input.error.receipt.externalMessageId,
    provider: input.error.receipt.provider,
    dispatchReceipt: input.error.receipt,
  };
  let persisted = false;

  if (input.aiDecisionId) {
    try {
      await input.updateDecision(metadata);
      persisted = true;
    } catch (error) {
      input.logError?.(
        `failed to persist AI-decision reconciliation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    await input.writeAudit(metadata);
    persisted = true;
  } catch (error) {
    input.logError?.(
      `failed to persist reconciliation audit: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!persisted) {
    throw new NonRetryableJobError(
      'Provider accepted auto-reply but no reconciliation record could be persisted',
      input.error,
    );
  }
}
