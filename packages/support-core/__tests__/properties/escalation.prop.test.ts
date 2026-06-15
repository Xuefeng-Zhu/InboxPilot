import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createDefaultEscalationEngine,
  HumanRequestRule,
  ProfanityAngerRule,
  SensitiveTopicRule,
  SafetyConcernRule,
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
    escalationKeywords: [],
    systemPrompt: null,
    model: 'openai/gpt-4o-mini',
    embeddingModel: 'openai/text-embedding-3-small',
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

const PROFANITY_WORDS = [
  'fuck', 'shit', 'damn', 'bastard', 'bitch', 'crap',
  'hell', 'piss', 'dick', 'bullshit',
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
            knowledgeChunks: [makeChunk()],
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
   * Additional property: the default engine does not escalate solely because
   * no knowledge chunks matched. AiAgentService handles that as a clarify path.
   */
  it('Property 6 (NoKnowledge): default engine does not trigger on empty knowledge chunks alone', () => {
    const engine = createDefaultEscalationEngine();

    fc.assert(
      fc.property(cleanMessageArb, (message) => {
        const context = makeContext({
          latestMessage: message,
          knowledgeChunks: [],
          consecutiveAiFailures: 0,
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
