import type { JobQueue } from '../../../packages/support-core/src/interfaces/job-queue.ts';
import { ProviderSendOutcomeUnknownError } from '../../../packages/support-core/src/adapters/provider-send-outcome-unknown-error.ts';
import { NonRetryableJobError } from './run-claimed-job.ts';

export async function enqueueAutoReplyFallback(input: {
  error: unknown;
  jobQueue: Pick<JobQueue, 'enqueue'>;
  conversationId: string;
  responseText: string;
  aiDecisionId: string;
  organizationId: string;
}): Promise<void> {
  if (input.error instanceof NonRetryableJobError) throw input.error;
  if (input.error instanceof ProviderSendOutcomeUnknownError) {
    throw new NonRetryableJobError(input.error.message, input.error);
  }

  await input.jobQueue.enqueue(
    'send_outbound_message',
    {
      conversationId: input.conversationId,
      body: input.responseText,
      senderType: 'ai',
      aiDecisionId: input.aiDecisionId,
    },
    input.organizationId,
  );
}
