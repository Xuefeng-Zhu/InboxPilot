/**
 * Escalation rules — deterministic rule implementations for the EscalationEngine.
 *
 * Each rule implements the EscalationRule interface and evaluates a context
 * to decide whether a conversation should be escalated to a human agent.
 * Rules are evaluated in registration order; the first match wins.
 */

import type {
  EscalationRule,
  EscalationContext,
  EscalationResult,
} from '../interfaces/escalation.js';
import { EscalationEngine } from '../interfaces/escalation.js';

// ─── Helper ──────────────────────────────────────────────────────────

/** Case-insensitive check: does the message contain any of the given phrases? */
function containsAny(message: string, phrases: string[]): boolean {
  const lower = message.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

// ─── Rule 1: HumanRequestRule ────────────────────────────────────────

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
  'transfer to human',
  'connect me to a human',
  'i want a human',
  'let me talk to someone',
  'get me a person',
];

export class HumanRequestRule implements EscalationRule {
  readonly name = 'HumanRequestRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    if (containsAny(context.latestMessage, HUMAN_REQUEST_PHRASES)) {
      return {
        triggered: true,
        reason: 'Customer requested to speak with a human agent',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 2: ProfanityAngerRule ──────────────────────────────────────

const PROFANITY_WORDS = [
  'fuck', 'shit', 'damn', 'ass', 'bastard', 'bitch', 'crap',
  'hell', 'piss', 'dick', 'bullshit',
];

const ANGER_INDICATORS = [
  'furious', 'outraged', 'livid', 'enraged', 'infuriated',
  'disgusted', 'appalled', 'fed up', 'sick of this',
  'this is unacceptable', 'worst experience', 'terrible service',
  'horrible service', 'incompetent', 'useless',
];

export class ProfanityAngerRule implements EscalationRule {
  readonly name = 'ProfanityAngerRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    const lower = context.latestMessage.toLowerCase();
    const words = lower.split(/\s+/);

    const hasProfanity = words.some((word) => {
      const cleaned = word.replace(/[^a-z]/g, '');
      return PROFANITY_WORDS.includes(cleaned);
    });

    const hasAnger = containsAny(context.latestMessage, ANGER_INDICATORS);

    if (hasProfanity || hasAnger) {
      return {
        triggered: true,
        reason: 'Message contains profanity or anger indicators',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 3: SensitiveTopicRule ──────────────────────────────────────

const SENSITIVE_TOPIC_PHRASES = [
  'legal action', 'sue', 'lawsuit', 'attorney', 'lawyer',
  'chargeback', 'dispute charge', 'charge back',
  'refund', 'money back', 'get my money',
  'billing error', 'charged incorrectly', 'wrong charge', 'overcharged',
  'cancel my account', 'cancel my subscription', 'cancel my plan',
  'cancellation', 'terminate my account',
  'i will report', 'report you', 'file a complaint',
  'better business bureau', 'bbb',
  'consumer protection',
];

export class SensitiveTopicRule implements EscalationRule {
  readonly name = 'SensitiveTopicRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    if (containsAny(context.latestMessage, SENSITIVE_TOPIC_PHRASES)) {
      return {
        triggered: true,
        reason: 'Message contains sensitive topic (legal, chargeback, refund, billing, cancellation)',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 4: SafetyConcernRule ───────────────────────────────────────

const SAFETY_CONCERN_PHRASES = [
  'security breach', 'hacked', 'unauthorized access', 'data breach',
  'identity theft', 'stolen account', 'compromised',
  'medical emergency', 'medical issue', 'health concern', 'injury',
  'allergic reaction', 'side effect', 'adverse reaction',
  'legal issue', 'legal matter', 'court order', 'subpoena',
  'safety hazard', 'safety concern', 'dangerous', 'unsafe',
  'life threatening', 'emergency',
];

export class SafetyConcernRule implements EscalationRule {
  readonly name = 'SafetyConcernRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    if (containsAny(context.latestMessage, SAFETY_CONCERN_PHRASES)) {
      return {
        triggered: true,
        reason: 'Message involves security, medical, legal, or safety concerns',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 5: MissingKnowledgeRule ────────────────────────────────────

export class MissingKnowledgeRule implements EscalationRule {
  readonly name = 'MissingKnowledgeRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    if (context.knowledgeChunks.length === 0) {
      return {
        triggered: true,
        reason: 'missing_knowledge',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 6: LowConfidenceRule ───────────────────────────────────────

/**
 * LowConfidenceRule — triggers when AI_Decision confidence < configured minimum.
 *
 * Note: This is a post-LLM rule. In the pre-LLM escalation pass, it does not
 * trigger (there is no AI decision yet). It is included in the engine for
 * completeness and can be evaluated after the LLM call if needed.
 * In the standard flow, the AiAgentService checks confidence separately.
 */
export class LowConfidenceRule implements EscalationRule {
  readonly name = 'LowConfidenceRule';

  evaluate(_context: EscalationContext): EscalationResult | null {
    // This rule is evaluated post-LLM by AiAgentService directly,
    // not during the pre-LLM escalation pass. It's registered for
    // completeness but returns null during pre-LLM evaluation.
    return null;
  }

  /**
   * Evaluate confidence against the threshold.
   * Called explicitly by AiAgentService after LLM response.
   */
  evaluateConfidence(confidence: number, threshold: number): EscalationResult | null {
    if (confidence < threshold) {
      return {
        triggered: true,
        reason: 'low_confidence',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 7: RepeatedFailureRule ─────────────────────────────────────

export class RepeatedFailureRule implements EscalationRule {
  readonly name = 'RepeatedFailureRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    if (
      context.consecutiveAiFailures >=
      context.aiSettings.maxConsecutiveFailures
    ) {
      return {
        triggered: true,
        reason: 'repeated_failures',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Rule 8: KeywordRule ─────────────────────────────────────────────

export class KeywordRule implements EscalationRule {
  readonly name = 'KeywordRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    const keywords = context.aiSettings.escalationKeywords;
    if (!keywords || keywords.length === 0) {
      return null;
    }

    if (containsAny(context.latestMessage, keywords)) {
      return {
        triggered: true,
        reason: 'Message contains an organization-configured escalation keyword',
        ruleName: this.name,
      };
    }
    return null;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a default EscalationEngine with all 8 built-in rules registered
 * in the standard evaluation order.
 */
export function createDefaultEscalationEngine(): EscalationEngine {
  const engine = new EscalationEngine();

  engine.register(new HumanRequestRule());
  engine.register(new ProfanityAngerRule());
  engine.register(new SensitiveTopicRule());
  engine.register(new SafetyConcernRule());
  engine.register(new MissingKnowledgeRule());
  engine.register(new LowConfidenceRule());
  engine.register(new RepeatedFailureRule());
  engine.register(new KeywordRule());

  return engine;
}
