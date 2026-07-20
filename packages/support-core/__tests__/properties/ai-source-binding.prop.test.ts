import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { transitionForRecoveredDecision } from '../../src/services/ai-agent-service.js';

describe('AI source message binding properties', () => {
  it('restores human-required decisions as escalated for every response payload', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (responseText) => {
        expect(transitionForRecoveredDecision({
          requiresHuman: true,
          responseText,
          rawResponse: { _shouldAutoSend: true },
        })).toEqual({ aiState: 'needs_human', status: 'escalated' });
      }),
      { numRuns: 100 },
    );
  });

  it('restores non-human decisions according to durable reply metadata', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (responseText) => {
        expect(transitionForRecoveredDecision({
          requiresHuman: false,
          responseText,
          rawResponse: { _shouldAutoSend: true },
        })).toEqual({ aiState: 'auto_replied' });
        expect(transitionForRecoveredDecision({
          requiresHuman: false,
          responseText,
          rawResponse: { _shouldAutoSend: false },
        })).toEqual({ aiState: 'drafted' });
      }),
      { numRuns: 100 },
    );
  });

  it('distinguishes disabled turns from failed response-less turns', () => {
    expect(transitionForRecoveredDecision({
      requiresHuman: false,
      responseText: null,
      rawResponse: { _auditMetadata: { reason: 'ai_mode_off' } },
    })).toEqual({ aiState: 'idle' });
    expect(transitionForRecoveredDecision({
      requiresHuman: false,
      responseText: null,
      rawResponse: { error: 'timeout' },
    })).toEqual({ aiState: 'failed' });
  });
});
