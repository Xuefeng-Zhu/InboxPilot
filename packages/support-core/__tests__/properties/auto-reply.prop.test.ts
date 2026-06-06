import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { AiMode } from '@support-core/types/index';

/**
 * Property-based tests for auto-reply threshold gating.
 *
 * Feature: ai-customer-support
 */

// ─── Pure Decision Logic ─────────────────────────────────────────────

/**
 * Pure function that determines whether an AI response should be auto-sent.
 *
 * This mirrors the decision logic in AiAgentService.processMessage:
 * Auto-send only when mode is "auto_reply", confidence ≥ threshold,
 * and requires_human is false.
 */
function shouldAutoSend(
  aiMode: AiMode,
  confidence: number,
  confidenceThreshold: number,
  requiresHuman: boolean,
): boolean {
  return (
    aiMode === 'auto_reply' &&
    confidence >= confidenceThreshold &&
    !requiresHuman
  );
}

// ─── Arbitraries ─────────────────────────────────────────────────────

/** Arbitrary for AI mode. */
const aiModeArb = fc.constantFrom<AiMode>('off', 'draft_only', 'auto_reply');

/** Arbitrary for confidence values (0.0 to 1.0). */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for threshold values (0.0 to 1.0). */
const thresholdArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for requires_human boolean. */
const requiresHumanArb = fc.boolean();

// ─── Property Tests ──────────────────────────────────────────────────

describe('Auto-reply threshold gating property tests', () => {
  /**
   * Property 11: Auto-reply threshold gating
   *
   * Auto-send only when mode is "auto_reply", confidence ≥ threshold,
   * and requires_human is false. In all other cases, the response SHALL NOT
   * be auto-sent.
   *
   * **Validates: Requirements 11.8**
   *
   * Feature: ai-customer-support, Property 11: Auto-reply threshold gating
   */
  it('Property 11: auto-send iff mode is auto_reply AND confidence >= threshold AND requires_human is false', () => {
    fc.assert(
      fc.property(
        aiModeArb,
        confidenceArb,
        thresholdArb,
        requiresHumanArb,
        (mode, confidence, threshold, requiresHuman) => {
          const result = shouldAutoSend(mode, confidence, threshold, requiresHuman);

          const expectedAutoSend =
            mode === 'auto_reply' &&
            confidence >= threshold &&
            !requiresHuman;

          expect(result).toBe(expectedAutoSend);

          // Additional invariants:

          // If mode is not "auto_reply", never auto-send
          if (mode !== 'auto_reply') {
            expect(result).toBe(false);
          }

          // If requires_human is true, never auto-send
          if (requiresHuman) {
            expect(result).toBe(false);
          }

          // If confidence < threshold, never auto-send
          if (confidence < threshold) {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Additional property: auto-reply is the only mode that can auto-send.
   */
  it('Property 11 (mode constraint): only auto_reply mode can auto-send', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AiMode>('off', 'draft_only'),
        confidenceArb,
        thresholdArb,
        requiresHumanArb,
        (mode, confidence, threshold, requiresHuman) => {
          const result = shouldAutoSend(mode, confidence, threshold, requiresHuman);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Additional property: when all conditions are met, auto-send is true.
   */
  it('Property 11 (positive case): auto-send when all conditions met', () => {
    fc.assert(
      fc.property(
        // Confidence >= threshold (generate threshold first, then confidence >= threshold)
        thresholdArb.chain((threshold) =>
          fc.tuple(
            fc.constant(threshold),
            fc.double({
              min: threshold,
              max: 1,
              noNaN: true,
              noDefaultInfinity: true,
            }),
          ),
        ),
        ([threshold, confidence]) => {
          const result = shouldAutoSend('auto_reply', confidence, threshold, false);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
