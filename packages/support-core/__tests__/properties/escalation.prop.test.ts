import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createDefaultEscalationEngine,
  HumanRequestRule,
  ProfanityAngerRule,
  SensitiveTopicRule,
  SafetyConcernRule,
  MissingKnowledgeRule,
  RepeatedFailureRule,
  KeywordRule,
} from '@support-core/services/escalation-rules';
import type { EscalationContext } from '@support-core/interfaces/escalation';
import type { AiSettings, Message, KnowledgeChunk } from '@support-core/types/index';

/**
 * Property-based tests for the escalation engine.
 *
 * Feature: ai-customer-support
 */

// ─── Helpers ─────────────────────────────────────────────────────────

/** Create a minimal AiSettings object for testing. */
function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    id: 'settings-1',
    organizationId: 'org-1',
    aiMode: 'auto_reply',
    confidenceThreshold: 0.75,
    contextWindowSize: 20,
    maxConsecutiveFailures: 3,
    knowledgeSimilarityThreshold: 0.7,
    knowledgeRequired: false,
    escalationKeywords: [],
    systemPrompt: null,
    model: 'openai/gpt-4o-mini',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Create a minimal KnowledgeChunk for testing. */
function makeChunk(content: string = 'some knowledge'): KnowledgeChunk {
  return {
    id: 'chunk-1',
    documentId: 'doc-1',
    organizationId: 'org-1',
    content,
    embedding: [],
    metadata: {},
    createdAt: new Date(),
  };
}

/** Create a minimal EscalationContext. */
function makeContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    latestMessage: 'Hello, I need help with my order',
    conversationHistory: [],
    knowledgeChunks: [makeChunk()],
    knowledgeSimilarityThreshold: 0.7,
    aiSettings: makeSettings(),
    consecutiveAiFailures: 0,
    ...overrides,
  };
}

// ─── Trigger phrase lists (matching the rule implementations) ────────

const HUMAN_REQUEST_PHRASES = [
  'speak to a human',
  'talk to a person',
  'real person',
  'human agent',
  'talk to a human',
  'speak to a person',
  'speak to an agent',
  'talk to an agent',
  'real agent',
  'live agent',
  'live person',
];

// Mirrors `PROFANITY_WORDS` in `src/services/escalation-rules.ts`. Keep these
// two lists in lockstep — if you add a conjugation to the implementation, add
// it here too so the property test exercises it.
const PROFANITY_WORDS = [
  'fuck', 'shit', 'damn', 'bastard', 'bitch', 'crap',
  'hell', 'piss', 'dick', 'bullshit',
  // Conjugations / derivatives — the profanity list explicitly enumerates
  // these rather than using prefix matching, to avoid false positives on
  // words like "fable" or "classical". See ProfanityAngerRule contract in
  // src/services/escalation-rules.ts.
  'asshole',
  'fucks', 'fucked', 'fucking', 'fucker',
  'shits', 'shitted', 'shitting',
  'damned', 'damning', 'damnit', 'goddamn',
  'bastards',
  'bitched', 'bitching', 'bitchy', 'bitches',
  'craps', 'crapped', 'crapping', 'crappy',
  'pissed', 'pissing', 'pisser',
  'dicked', 'dicking', 'dickhead',
  'bullshits', 'bullshitted', 'bullshitting', 'bullshitter',
];

const ANGER_INDICATORS = [
  'furious', 'outraged', 'livid', 'enraged', 'infuriated',
  'disgusted', 'appalled', 'fed up', 'sick of this',
  'this is unacceptable', 'worst experience', 'terrible service',
  'horrible service', 'incompetent', 'useless',
];

const SENSITIVE_TOPIC_PHRASES = [
  'legal action', 'lawsuit', 'attorney', 'lawyer',
  'chargeback', 'dispute charge',
  'refund', 'money back',
  'billing error', 'charged incorrectly', 'overcharged',
  'cancel my account', 'cancel my subscription',
  'cancellation', 'terminate my account',
];

const SAFETY_CONCERN_PHRASES = [
  'security breach', 'hacked', 'unauthorized access', 'data breach',
  'identity theft', 'stolen account', 'compromised',
  'medical emergency', 'medical issue', 'health concern',
  'legal issue', 'legal matter', 'court order',
  'safety hazard', 'safety concern', 'dangerous', 'unsafe',
  'life threatening', 'emergency',
];

/** All trigger phrases combined for generating "clean" messages. */
const ALL_TRIGGER_PHRASES = [
  ...HUMAN_REQUEST_PHRASES,
  ...PROFANITY_WORDS,
  ...ANGER_INDICATORS,
  ...SENSITIVE_TOPIC_PHRASES,
  ...SAFETY_CONCERN_PHRASES,
];

/** Arbitrary for a trigger phrase from any rule. */
const triggerPhraseArb = fc.constantFrom(
  ...HUMAN_REQUEST_PHRASES,
  ...ANGER_INDICATORS,
  ...SENSITIVE_TOPIC_PHRASES,
  ...SAFETY_CONCERN_PHRASES,
);

/** Arbitrary for a profanity word (needs word boundary matching). */
const profanityWordArb = fc.constantFrom(...PROFANITY_WORDS);

/** Arbitrary for a "clean" message that doesn't contain any trigger phrases. */
const cleanMessageArb = fc.constantFrom(
  'Hello, I need help with my order',
  'Can you check the status of my delivery?',
  'What are your business hours?',
  'Thank you for your help',
  'I have a question about your product',
  'How do I update my shipping address?',
  'When will my package arrive?',
  'I would like to know more about your services',
  'Could you provide more details?',
  'I appreciate your assistance',
);

// ─── Property Tests ──────────────────────────────────────────────────

describe('Escalation engine property tests', () => {
  /**
   * Property 6: Escalation engine triggers on matching content
   *
   * For any message containing trigger phrases, the engine returns a non-null result.
   * For clean messages, it returns null.
   *
   * **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8**
   *
   * Feature: ai-customer-support, Property 6: Escalation engine triggers on matching content
   */
  it('Property 6: escalation engine triggers on messages with trigger phrases and returns null for clean messages', () => {
    const engine = createDefaultEscalationEngine();

    fc.assert(
      fc.property(
        fc.oneof(
          // Messages with trigger phrases (should escalate)
          fc.record({
            type: fc.constant('trigger' as const),
            message: fc.oneof(
              // Human request phrases embedded in a message
              triggerPhraseArb.map((phrase) => `I want to ${phrase} please`),
              // Profanity words in a message
              profanityWordArb.map((word) => `This is ${word} ridiculous`),
              // Just the trigger phrase
              triggerPhraseArb,
            ),
          }),
          // Clean messages (should not escalate)
          fc.record({
            type: fc.constant('clean' as const),
            message: cleanMessageArb,
          }),
        ),
        ({ type, message }) => {
          const context = makeContext({
            latestMessage: message,
            knowledgeChunks: [makeChunk()], // Has knowledge, so MissingKnowledgeRule won't fire (HIGH-9: even with opt-in, chunks present -> null)
            consecutiveAiFailures: 0, // Below threshold
          });

          const result = engine.evaluate(context);

          if (type === 'trigger') {
            expect(result).not.toBeNull();
            if (result) {
              expect(result.triggered).toBe(true);
              expect(result.reason).toBeTruthy();
              expect(result.ruleName).toBeTruthy();
            }
          } else {
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Additional property: MissingKnowledgeRule triggers when no knowledge chunks.
   *
   * **Validates: Requirements 12.5**
   *
   * HIGH-9 fix: the rule now requires `aiSettings.knowledgeRequired = true`
   * to fire. We test the default-engine path with the opt-in flag on, so
   * the property still proves the rule triggers when both conditions hold.
   */
  it('Property 6 (MissingKnowledge): triggers when knowledge chunks array is empty AND knowledgeRequired is true', () => {
    const engine = createDefaultEscalationEngine();

    fc.assert(
      fc.property(cleanMessageArb, (message) => {
        const context = makeContext({
          latestMessage: message,
          knowledgeChunks: [], // Empty — gating condition #1
          consecutiveAiFailures: 0,
          aiSettings: makeSettings({ knowledgeRequired: true }), // HIGH-9: opt-in
        });

        const result = engine.evaluate(context);
        expect(result).not.toBeNull();
        if (result) {
          expect(result.ruleName).toBe('MissingKnowledgeRule');
          expect(result.reason).toBe('missing_knowledge');
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * HIGH-9 regression: with the default `knowledgeRequired = false` and
   * no knowledge chunks, the default engine MUST NOT escalate on the
   * "missing knowledge" rule. The LLM gets a chance to answer and the
   * customer is not bounced to a human for a greeting.
   *
   * Documents the day-1 default: new tenants do not get every inbound
   * message escalated.
   */
  it('Property 6 (MissingKnowledge, HIGH-9): does NOT trigger with default settings (knowledgeRequired=false) and empty chunks', () => {
    const engine = createDefaultEscalationEngine();

    fc.assert(
      fc.property(cleanMessageArb, (message) => {
        const context = makeContext({
          latestMessage: message,
          knowledgeChunks: [],
          consecutiveAiFailures: 0,
          // makeSettings() defaults knowledgeRequired to false — the
          // org has not opted in to strict gating, so the rule must
          // not fire even with empty chunks.
        });

        const result = engine.evaluate(context);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Additional property: RepeatedFailureRule triggers when failures >= max.
   *
   * **Validates: Requirements 12.7**
   */
  it('Property 6 (RepeatedFailure): triggers when consecutive failures >= max', () => {
    const engine = createDefaultEscalationEngine();

    fc.assert(
      fc.property(
        cleanMessageArb,
        fc.integer({ min: 3, max: 20 }),
        (message, failures) => {
          const context = makeContext({
            latestMessage: message,
            knowledgeChunks: [makeChunk()],
            consecutiveAiFailures: failures,
            aiSettings: makeSettings({ maxConsecutiveFailures: 3 }),
          });

          const result = engine.evaluate(context);
          expect(result).not.toBeNull();
          if (result) {
            expect(result.ruleName).toBe('RepeatedFailureRule');
            expect(result.reason).toBe('repeated_failures');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Additional property: KeywordRule triggers on org-configured keywords.
   *
   * **Validates: Requirements 12.8**
   */
  it('Property 6 (KeywordRule): triggers on organization-configured escalation keywords', () => {
    // Use a standalone KeywordRule to test in isolation, avoiding
    // higher-priority rules matching first in the full engine.
    const rule = new KeywordRule();

    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 20 }).filter((s) => /^[a-z]+$/.test(s)),
        (keyword) => {
          const message = `I need help with ${keyword} issue`;
          const context = makeContext({
            latestMessage: message,
            knowledgeChunks: [makeChunk()],
            consecutiveAiFailures: 0,
            aiSettings: makeSettings({ escalationKeywords: [keyword] }),
          });

          const result = rule.evaluate(context);
          expect(result).not.toBeNull();
          if (result) {
            expect(result.ruleName).toBe('KeywordRule');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
