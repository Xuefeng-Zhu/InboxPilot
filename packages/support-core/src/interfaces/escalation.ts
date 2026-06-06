/**
 * Escalation engine — deterministic rule evaluator.
 *
 * Runs before any LLM call. If any rule triggers, the conversation is
 * escalated to a human agent and the AI is skipped entirely.
 */

import type { Message, KnowledgeChunk, AiSettings } from '../types/index.js';

/** Context passed to each escalation rule for evaluation. */
export interface EscalationContext {
  latestMessage: string;
  conversationHistory: Message[];
  knowledgeChunks: KnowledgeChunk[];
  knowledgeSimilarityThreshold: number;
  aiSettings: AiSettings;
  consecutiveAiFailures: number;
}

/** Result returned when an escalation rule triggers. */
export interface EscalationResult {
  triggered: true;
  reason: string;
  ruleName: string;
}

/** A single escalation rule that can evaluate a context. */
export interface EscalationRule {
  readonly name: string;

  /**
   * Evaluate the context against this rule.
   * Returns an EscalationResult if the rule triggers, or null otherwise.
   */
  evaluate(context: EscalationContext): EscalationResult | null;
}

/**
 * Engine that evaluates a set of registered escalation rules in order.
 * Returns the first triggered result, or null if no rules fire.
 */
export class EscalationEngine {
  private rules: EscalationRule[] = [];

  /** Register an escalation rule. Rules are evaluated in registration order. */
  register(rule: EscalationRule): void {
    this.rules.push(rule);
  }

  /** Evaluate all registered rules against the given context. */
  evaluate(context: EscalationContext): EscalationResult | null {
    for (const rule of this.rules) {
      const result = rule.evaluate(context);
      if (result !== null) {
        return result;
      }
    }
    return null;
  }
}
