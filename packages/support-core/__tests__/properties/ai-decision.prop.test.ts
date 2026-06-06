import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseAiDecision } from '@support-core/services/ai-decision-parser';

/**
 * Property-based tests for AI_Decision parsing.
 *
 * Feature: ai-customer-support
 */

// ─── Arbitraries ─────────────────────────────────────────────────────

/** Arbitrary for valid decision_type values. */
const decisionTypeArb = fc.constantFrom('respond', 'escalate', 'clarify');

/** Arbitrary for valid confidence values (0.0 to 1.0). */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for valid reasoning_summary strings. */
const reasoningSummaryArb = fc.string({ minLength: 0, maxLength: 500 });

/** Arbitrary for valid response_text (string or null). */
const responseTextArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 500 }),
  fc.constant(null),
);

/** Arbitrary for valid tags arrays. */
const tagsArb = fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 10 });

/** Arbitrary for valid requires_human boolean. */
const requiresHumanArb = fc.boolean();

/** Arbitrary for a valid AI_Decision object. */
const validAiDecisionArb = fc.record({
  decision_type: decisionTypeArb,
  confidence: confidenceArb,
  reasoning_summary: reasoningSummaryArb,
  response_text: responseTextArb,
  tags: tagsArb,
  requires_human: requiresHumanArb,
});

// ─── Property Tests ──────────────────────────────────────────────────

describe('AI_Decision parsing property tests', () => {
  /**
   * Property 4: AI_Decision JSON round-trip
   *
   * For any valid AI_Decision, serialize to JSON and parse back produces
   * equivalent result.
   *
   * **Validates: Requirements 11.4, 29.5, 29.9**
   *
   * Feature: ai-customer-support, Property 4: AI_Decision JSON round-trip
   */
  it('Property 4: valid AI_Decision round-trips through JSON serialization and parsing', () => {
    fc.assert(
      fc.property(validAiDecisionArb, (decision) => {
        const json = JSON.stringify(decision);
        const result = parseAiDecision(json);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.decision_type).toBe(decision.decision_type);
          expect(result.data.confidence).toBeCloseTo(decision.confidence, 10);
          expect(result.data.reasoning_summary).toBe(decision.reasoning_summary);
          expect(result.data.response_text).toBe(decision.response_text);
          expect(result.data.tags).toEqual(decision.tags);
          expect(result.data.requires_human).toBe(decision.requires_human);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5: Invalid JSON always produces failure state
   *
   * For any string that is not valid JSON or doesn't conform to schema,
   * parsing fails.
   *
   * **Validates: Requirements 11.5**
   *
   * Feature: ai-customer-support, Property 5: Invalid JSON always produces failure state
   */
  it('Property 5: invalid JSON or non-conforming schema always produces failure', () => {
    // Sub-property 5a: Completely invalid JSON strings
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => {
          try {
            JSON.parse(s);
            return false; // Skip strings that happen to be valid JSON
          } catch {
            return true;
          }
        }),
        (invalidJson) => {
          const result = parseAiDecision(invalidJson);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );

    // Sub-property 5b: Valid JSON but wrong schema
    fc.assert(
      fc.property(
        fc.oneof(
          // Missing required fields
          fc.record({
            decision_type: fc.constantFrom('respond', 'escalate', 'clarify'),
            // Missing confidence, reasoning_summary, etc.
          }),
          // Wrong types for fields
          fc.record({
            decision_type: fc.string().filter((s) => !['respond', 'escalate', 'clarify'].includes(s)),
            confidence: confidenceArb,
            reasoning_summary: reasoningSummaryArb,
            response_text: responseTextArb,
            tags: tagsArb,
            requires_human: requiresHumanArb,
          }),
          // Confidence out of range
          fc.record({
            decision_type: decisionTypeArb,
            confidence: fc.oneof(
              fc.double({ min: 1.01, max: 100, noNaN: true, noDefaultInfinity: true }),
              fc.double({ min: -100, max: -0.01, noNaN: true, noDefaultInfinity: true }),
            ),
            reasoning_summary: reasoningSummaryArb,
            response_text: responseTextArb,
            tags: tagsArb,
            requires_human: requiresHumanArb,
          }),
          // Primitive values
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(fc.integer()),
          ),
        ),
        (invalidData) => {
          const json = JSON.stringify(invalidData);
          const result = parseAiDecision(json);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
