/**
 * A second fixture recording representing a "weaker" model run.
 *
 * Used by run-eval-compare.ts to demonstrate a head-to-head comparison
 * between the default gpt-4o-mini mock and a hypothetical claude-haiku
 * mock. The differences are designed to be realistic:
 *   - some rubric criteria lose (verbose / no greeting / "Sure!" openers)
 *   - one decision is wrong (gc-014 should be escalate not clarify)
 *
 * The point is the comparison report, not a real benchmark — the live
 * OpenRouter client (openrouter-ai-client.ts) is the path to a real
 * model comparison.
 */

import type { Recording } from './mock-ai-client.js';

export const CLAUDE_HAIKU_RECORDING: Recording = {
  // Same as gpt-4o-mini for pre-LLM escalations (LLM is never called).
  'gc-001-human-request': JSON.stringify({}),
  'gc-002-profanity': JSON.stringify({}),
  'gc-003-legal-threat': JSON.stringify({}),
  'gc-005-missing-knowledge': JSON.stringify({}),

  // gc-006: haiku responds but with a less polished answer
  'gc-006-returns-question': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.88,
    reasoning_summary: 'Customer is asking about returns.',
    response_text: 'You can return items within 30 days. Login and click "Return item" on your order. You will get a shipping label.',
    tags: ['returns'],
    requires_human: false,
  }),

  // gc-007: haiku responds but with no greeting
  'gc-007-returns-auto': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.86,
    reasoning_summary: 'Returns question.',
    response_text: 'Items can be returned within 30 days of delivery for a full refund. The item must be unworn and in its original packaging.',
    tags: ['returns'],
    requires_human: false,
  }),

  'gc-008-refund-question': JSON.stringify({}),

  // gc-009: haiku gets hours question right
  'gc-009-hours-question': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Hours question.',
    response_text: 'We are open Monday through Friday, 9am to 6pm Pacific Time. We respond within one business day.',
    tags: ['hours'],
    requires_human: false,
  }),

  'gc-010-shipping-question': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.88,
    reasoning_summary: 'Shipping question.',
    response_text: 'Standard shipping is 3-5 business days in the US. Express is 1-2 days for $9.95 more.',
    tags: ['shipping'],
    requires_human: false,
  }),

  'gc-011-password-reset': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.9,
    reasoning_summary: 'Password reset.',
    response_text: 'Click "Forgot password" on the login page. You will get a reset link by email.',
    tags: ['account'],
    requires_human: false,
  }),

  // gc-012: haiku misses the order number reference
  'gc-012-multiturn-returns': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.78,
    reasoning_summary: 'Returns follow-up.',
    response_text: 'You can return the shoes within 30 days if unworn. I will email a return label shortly.',
    tags: ['returns'],
    requires_human: false,
  }),

  // gc-013: haiku opens with "Sure!" (no professional greeting)
  'gc-013-greeting': JSON.stringify({
    decision_type: 'respond',
    confidence: 0.7,
    reasoning_summary: 'Greeting only.',
    response_text: 'Sure! How can I help?',
    tags: ['greeting'],
    requires_human: false,
  }),

  // gc-014: haiku escalates (different from gpt-4o-mini which clarified)
  'gc-014-clarify-order': JSON.stringify({
    decision_type: 'escalate',
    confidence: 0.5,
    reasoning_summary: 'Vague; route to human.',
    response_text: null,
    tags: ['low-confidence'],
    requires_human: true,
  }),

  // gc-015: haiku clarifies
  'gc-015-clarify-broken': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.7,
    reasoning_summary: 'Need more info.',
    response_text: 'What item is broken, and what happens when you try to use it?',
    tags: ['needs-info'],
    requires_human: false,
  }),

  'gc-016-clarify-double': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.78,
    reasoning_summary: 'Two questions.',
    response_text: 'I can help with both. Which first — shipping to Canada or payment options?',
    tags: ['needs-info'],
    requires_human: false,
  }),

  'gc-017-clarify-offtopic': JSON.stringify({
    decision_type: 'clarify',
    confidence: 0.72,
    reasoning_summary: 'Off-topic.',
    response_text: 'That is outside what I can help with. Anything I can help you with — order, account, products?',
    tags: ['redirect'],
    requires_human: false,
  }),

  'gc-018-llm-escalate-complaint': JSON.stringify({
    decision_type: 'escalate',
    confidence: 0.5,
    reasoning_summary: 'Repeat complaint.',
    response_text: null,
    tags: ['repeat-contact'],
    requires_human: true,
  }),

  'gc-019-llm-escalate-delete': JSON.stringify({}),
  'gc-020-llm-escalate-billing': JSON.stringify({}),

  'gc-021-llm-escalate-integration': JSON.stringify({
    decision_type: 'escalate',
    confidence: 0.5,
    reasoning_summary: 'Enterprise scope.',
    response_text: null,
    tags: ['enterprise'],
    requires_human: true,
  }),

  'gc-022-mode-off-returns': JSON.stringify({}),
  'gc-023-mode-off-profanity': JSON.stringify({}),

  'gc-024-llm-invalid-json': 'not valid json at all',
  'gc-025-llm-throws': { throw: 'simulated LLM timeout' },
};
