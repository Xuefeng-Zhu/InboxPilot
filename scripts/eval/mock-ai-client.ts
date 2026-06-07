/**
 * Deterministic mock AiClient for the AI evaluation harness.
 *
 * This client plays back canned LLM responses keyed by golden-conversation id.
 * The same fixture always produces the same response, so the harness is
 * reproducible in CI without any network access.
 *
 * The recording format is a single JSON object:
 *   { "<gc-id>": <llm-content-or-throw> }
 *
 * where <llm-content-or-throw> is one of:
 *   - a string (treated as the LLM's chat-completion content)
 *   - { "throw": "<error message>" }  →  client throws with that message
 *
 * A built-in default recording covers all 25 fixtures; pass a custom recording
 * via --recording <file> to override per conversation (used for live runs
 * where the harness plays back what the real model just said).
 */

import type { AiClient } from '../../packages/support-core/src/interfaces/ai-client.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  EmbeddingParams,
} from '../../packages/support-core/src/types/index.js';

export type RecordedResponse = string | { throw: string };

export type Recording = Record<string, RecordedResponse>;

// ─── Default recording (covers all GOLDEN_CONVERSATIONS) ───────────

export const DEFAULT_RECORDING: Recording = {
  // gc-001: pre-LLM escalation (HumanRequestRule), LLM is never called.
  //         Recording is irrelevant but provided for completeness.
  'gc-001-human-request': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Would have responded if asked',
    response_text: 'I am happy to help with your return.',
    tags: ['returns'],
    requires_human: false,
  }),
  'gc-002-profanity': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Would have responded if asked',
    response_text: 'I understand you are frustrated. Let me look into this.',
    tags: ['empathy'],
    requires_human: false,
  }),
  'gc-003-legal-threat': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Would have responded if asked',
    response_text: 'I will connect you with a specialist.',
    tags: ['legal'],
    requires_human: false,
  }),
  'gc-005-missing-knowledge': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Would have responded if asked',
    response_text: 'I can help with that.',
    tags: ['integration'],
    requires_human: false,
  }),

  // gc-006 — returns, draft mode, high confidence
  'gc-006-returns-question': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.92,
    reasoning_summary: 'Returns question matches knowledge base article on the 30-day return window.',
    response_text: 'You can return most items within 30 days of delivery for a full refund. To start a return, log in to your account, go to Orders, and click "Return item" next to the order. You will receive a prepaid shipping label by email within 1 business day.',
    tags: ['returns', 'policy'],
    requires_human: false,
  }),

  // gc-007 — returns, auto-reply mode, high confidence
  'gc-007-returns-auto': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Returns question matches the 30-day return window policy.',
    response_text: 'Our return policy allows you to return most items within 30 days of delivery for a full refund, as long as the item is unworn and in its original packaging.',
    tags: ['returns', 'policy'],
    requires_human: false,
  }),

  // gc-008 — refund → pre-escalates
  'gc-008-refund-question': JSON.stringify({}),

  // gc-009 — hours question
  'gc-009-hours-question': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.95,
    reasoning_summary: 'Direct question answered by the support hours knowledge base article.',
    response_text: 'Our support team is available Monday through Friday, 9am to 6pm Pacific Time, and we respond to all messages within one business day.',
    tags: ['hours'],
    requires_human: false,
  }),

  // gc-010 — shipping question
  'gc-010-shipping-question': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Shipping question matches the standard shipping knowledge base article.',
    response_text: 'Standard shipping within the continental US takes 3-5 business days. Express shipping (1-2 business days) is available for an additional $9.95.',
    tags: ['shipping'],
    requires_human: false,
  }),

  // gc-011 — password reset
  'gc-011-password-reset': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.93,
    reasoning_summary: 'Password reset steps are clearly documented.',
    response_text: 'To reset your password, click "Forgot password" on the login page. You will receive a password reset link by email within a few minutes.',
    tags: ['account', 'password'],
    requires_human: false,
  }),

  // gc-012 — multi-turn returns
  'gc-012-multiturn-returns': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.85,
    reasoning_summary: 'Customer has provided order #98765 and wants to return shoes; policy applies.',
    response_text: 'Thanks for the order number. Shoes from order #98765 can be returned within 30 days of delivery as long as they are unworn and in the original packaging. I will email you a prepaid return label shortly.',
    tags: ['returns', 'order-98765'],
    requires_human: false,
  }),

  // gc-013 — greeting
  'gc-013-greeting': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.7,
    reasoning_summary: 'Greeting-only message, invite the customer to ask a question.',
    response_text: 'Hello! How can I help you today?',
    tags: ['greeting'],
    requires_human: false,
  }),

  // gc-014 — clarify (no order number) — confidence above threshold to actually pass
  'gc-014-clarify-order': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.75,
    reasoning_summary: 'Customer asked about order status but did not provide an order number.',
    response_text: 'I would be happy to look into that — could you share the order number, please?',
    tags: ['needs-info'],
    requires_human: false,
  }),

  // gc-015 — clarify (vague broken item) — confidence above threshold
  'gc-015-clarify-broken': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.72,
    reasoning_summary: 'Vague message needs more detail.',
    response_text: 'I am sorry to hear something is not working. Could you tell me which item is broken and what is happening when you try to use it?',
    tags: ['needs-info'],
    requires_human: false,
  }),

  // gc-016 — clarify (two questions) — confidence above threshold
  'gc-016-clarify-double': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.8,
    reasoning_summary: 'Two unrelated questions; ask customer to focus.',
    response_text: 'Happy to help with both. To make sure I give you a complete answer, which would you like me to start with — shipping to Canada, or payment options?',
    tags: ['needs-info'],
    requires_human: false,
  }),

  // gc-017 — clarify (off-topic) — confidence above threshold
  'gc-017-clarify-offtopic': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.75,
    reasoning_summary: 'Off-topic question, redirect to support scope.',
    response_text: 'That is a great philosophical question, but it is outside what I can help with. Is there anything I can help you with today, such as an order, your account, or our products?',
    tags: ['redirect'],
    requires_human: false,
  }),

  // gc-018 — LLM-driven escalate (repeat complaint, no keyword match)
  'gc-018-llm-escalate-complaint': JSON.stringify({
    decision_type: 'escalate',
    confidence: 0.6,
    reasoning_summary: 'Repeat complaint with strong dissatisfaction warrants human follow-up.',
    response_text: null,
    tags: ['repeat-contact', 'frustration'],
    requires_human: true,
  }),

  // gc-019, gc-020 — pre-escalate via SensitiveTopicRule
  'gc-019-llm-escalate-delete': JSON.stringify({}),
  'gc-020-llm-escalate-billing': JSON.stringify({}),

  // gc-021 — LLM-driven escalate (complex integration)
  'gc-021-llm-escalate-integration': JSON.stringify({
    decision_type: 'escalate',
    confidence: 0.55,
    reasoning_summary: 'Multi-part enterprise question exceeds the support bot scope; route to onboarding.',
    response_text: null,
    tags: ['enterprise', 'onboarding'],
    requires_human: true,
  }),

  // gc-022, gc-023 — ai-mode=off
  'gc-022-mode-off-returns': JSON.stringify({}),
  'gc-023-mode-off-profanity': JSON.stringify({}),

  // gc-024 — invalid JSON
  'gc-024-llm-invalid-json': 'not valid json at all',

  // gc-025 — LLM throws
  'gc-025-llm-throws': { throw: 'simulated LLM timeout' },
};

// ─── AiClient implementation ───────────────────────────────────────

/**
 * A deterministic AiClient that returns recorded responses keyed by the
 * golden-conversation id. The id is recovered from the system prompt
 * (the harness injects it as a marker) OR from the latest user message
 * (which contains the conversation id) — the harness is responsible for
 * injecting the id before calling the service.
 */
export class MockAiClient implements AiClient {
  private readonly recording: Recording;

  constructor(recording: Recording = DEFAULT_RECORDING) {
    this.recording = recording;
  }

  /**
   * Override or extend the recording (e.g. after a live OpenRouter run).
   */
  setRecording(gcId: string, response: RecordedResponse): void {
    this.recording[gcId] = response;
  }

  async chatCompletion(_params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const gcId = this.resolveGcId(_params);
    const recorded = this.recording[gcId];
    if (recorded === undefined) {
      throw new Error(
        `MockAiClient: no recording for golden conversation "${gcId}". ` +
        `Add it to the recording map (DEFAULT_RECORDING or via --recording).`,
      );
    }
    if (typeof recorded === 'object' && 'throw' in recorded) {
      throw new Error(recorded.throw);
    }
    return { content: recorded };
  }

  async createEmbedding(_params: EmbeddingParams): Promise<number[]> {
    // Return a deterministic 1536-dim zero vector — the harness never inspects it.
    return new Array(1536).fill(0);
  }

  /**
   * Extract the golden-conversation id from the system prompt. The harness
   * injects a `[EVAL_GC:gc-id]` marker as the very first line of the system
   * prompt. This is the supported way to identify which fixture is running.
   */
  private resolveGcId(params: ChatCompletionParams): string {
    const systemMsg = params.messages.find((m) => m.role === 'system');
    if (systemMsg) {
      const match = /\[EVAL_GC:([a-zA-Z0-9_-]+)\]/.exec(systemMsg.content);
      if (match) {
        return match[1];
      }
    }
    // Fallback: take the last user message (the contact's latest message) and
    // search for the id in its body. This is brittle; the marker is preferred.
    for (let i = params.messages.length - 1; i >= 0; i--) {
      const m = params.messages[i];
      if (m.role === 'user') {
        const match = /\[EVAL_GC:([a-zA-Z0-9_-]+)\]/.exec(m.content);
        if (match) return match[1];
      }
    }
    throw new Error(
      'MockAiClient: could not find [EVAL_GC:<id>] marker in messages. ' +
      'The harness must inject the marker into the seed messages before calling the service.',
    );
  }
}
