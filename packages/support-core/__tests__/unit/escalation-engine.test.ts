import { describe, it, expect } from 'vitest';
import {
  HumanRequestRule,
  ProfanityAngerRule,
  SensitiveTopicRule,
  SafetyConcernRule,
  MissingKnowledgeRule,
  RepeatedFailureRule,
  KeywordRule,
  LowConfidenceRule,
  createDefaultEscalationEngine,
} from '../../src/services/escalation-rules.js';
import type { EscalationContext } from '../../src/interfaces/escalation.js';
import type { AiSettings } from '../../src/types/index.js';

/**
 * Unit tests for individual escalation rules with specific trigger phrases.
 */

// ─── Helpers ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AiSettings = {
  id: 'settings-001',
  organizationId: 'org-001',
  aiMode: 'draft_only',
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
};

function makeContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    latestMessage: 'Hello, I need help with my order.',
    conversationHistory: [],
    knowledgeChunks: [{ id: '1', documentId: 'd1', organizationId: 'org-001', content: 'chunk', embedding: [], metadata: {}, createdAt: new Date() }],
    knowledgeSimilarityThreshold: 0.7,
    aiSettings: DEFAULT_SETTINGS,
    consecutiveAiFailures: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Escalation Rules — Individual Rule Tests', () => {
  describe('HumanRequestRule', () => {
    const rule = new HumanRequestRule();

    it('triggers on "speak to a human"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want to speak to a human' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('HumanRequestRule');
    });

    it('triggers on "talk to a person"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Can I talk to a person?' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "live agent"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Get me a live agent' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on normal messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'How do I return an item?' }));
      expect(result).toBeNull();
    });
  });

  describe('ProfanityAngerRule', () => {
    const rule = new ProfanityAngerRule();

    it('triggers on profanity', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'This is bullshit service' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('ProfanityAngerRule');
    });

    it('triggers on anger indicators', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am furious about this' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "worst experience"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'This is the worst experience ever' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on polite messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Could you help me please?' }));
      expect(result).toBeNull();
    });
  });

  describe('SensitiveTopicRule', () => {
    const rule = new SensitiveTopicRule();

    it('triggers on "refund"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want a refund' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('SensitiveTopicRule');
    });

    it('triggers on "legal action"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I will take legal action' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "chargeback"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am filing a chargeback' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "cancel my account"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want to cancel my account' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on normal messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'What are your business hours?' }));
      expect(result).toBeNull();
    });
  });

  describe('SafetyConcernRule', () => {
    const rule = new SafetyConcernRule();

    it('triggers on "security breach"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I think there was a security breach' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('SafetyConcernRule');
    });

    it('triggers on "medical emergency"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'This is a medical emergency' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "hacked"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'My account was hacked' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on normal messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'How do I update my profile?' }));
      expect(result).toBeNull();
    });
  });

  describe('MissingKnowledgeRule', () => {
    const rule = new MissingKnowledgeRule();

    it('triggers when no knowledge chunks are available', () => {
      const result = rule.evaluate(makeContext({ knowledgeChunks: [] }));
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('missing_knowledge');
    });

    it('does not trigger when knowledge chunks exist', () => {
      const result = rule.evaluate(makeContext());
      expect(result).toBeNull();
    });
  });

  describe('RepeatedFailureRule', () => {
    const rule = new RepeatedFailureRule();

    it('triggers when consecutive failures reach max', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 3 }));
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('repeated_failures');
    });

    it('does not trigger when failures are below max', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 1 }));
      expect(result).toBeNull();
    });
  });

  describe('KeywordRule', () => {
    const rule = new KeywordRule();

    it('triggers on configured escalation keywords', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['urgent', 'vip'] };
      const result = rule.evaluate(makeContext({
        latestMessage: 'This is urgent please help',
        aiSettings: settings,
      }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('KeywordRule');
    });

    it('does not trigger when no keywords match', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['urgent', 'vip'] };
      const result = rule.evaluate(makeContext({
        latestMessage: 'How do I return an item?',
        aiSettings: settings,
      }));
      expect(result).toBeNull();
    });

    it('does not trigger when keyword list is empty', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'urgent help needed' }));
      expect(result).toBeNull();
    });
  });

  describe('LowConfidenceRule', () => {
    const rule = new LowConfidenceRule();

    it('evaluateConfidence triggers when confidence is below threshold', () => {
      const result = rule.evaluateConfidence(0.5, 0.75);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('low_confidence');
    });

    it('evaluateConfidence does not trigger when confidence meets threshold', () => {
      const result = rule.evaluateConfidence(0.8, 0.75);
      expect(result).toBeNull();
    });

    it('evaluate returns null during pre-LLM pass', () => {
      const result = rule.evaluate(makeContext());
      expect(result).toBeNull();
    });
  });

  describe('createDefaultEscalationEngine', () => {
    it('creates engine with pre-LLM safety rules registered', () => {
      const engine = createDefaultEscalationEngine();

      // Test that it evaluates rules correctly
      const humanResult = engine.evaluate(makeContext({
        latestMessage: 'I want to speak to a human',
      }));
      expect(humanResult).not.toBeNull();
      expect(humanResult!.ruleName).toBe('HumanRequestRule');
    });

    it('does not register MissingKnowledgeRule by default', () => {
      const engine = createDefaultEscalationEngine();

      const result = engine.evaluate(makeContext({
        latestMessage: 'How do I reset my account password?',
        knowledgeChunks: [],
      }));
      expect(result).toBeNull();
    });

    it('returns null when no rules trigger', () => {
      const engine = createDefaultEscalationEngine();

      const result = engine.evaluate(makeContext({
        latestMessage: 'What are your business hours?',
      }));
      expect(result).toBeNull();
    });
  });
});
