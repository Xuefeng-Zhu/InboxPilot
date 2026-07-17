import type { AiDecision } from '../../../packages/support-core/src/types/index.ts';

/** Use only the immutable decision outcome, never mutable conversation state. */
export function shouldAutoSendDecision(
  decision: Pick<AiDecision, 'responseText' | 'rawResponse'>,
): decision is Pick<AiDecision, 'responseText' | 'rawResponse'> & { responseText: string } {
  return Boolean(
    decision.responseText && decision.rawResponse?._shouldAutoSend === true,
  );
}
