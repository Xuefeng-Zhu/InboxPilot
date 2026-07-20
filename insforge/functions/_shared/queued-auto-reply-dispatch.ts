import { NonRetryableJobError } from './run-claimed-job.ts';

/**
 * Re-establish a queued auto-reply's source-turn intent immediately before
 * provider dispatch. A newer message makes the atomic claim return false, so a
 * delayed fallback is completed without contacting the provider.
 */
export async function dispatchQueuedAutoReply(input: {
  sourceMessageId: string | undefined;
  claimSourceTurn(sourceMessageId: string): Promise<boolean>;
  send(): Promise<void>;
}): Promise<boolean> {
  if (!input.sourceMessageId) {
    throw new NonRetryableJobError(
      'send_outbound_message: missing source message ID after migration 018',
    );
  }

  if (!await input.claimSourceTurn(input.sourceMessageId)) return false;
  await input.send();
  return true;
}
