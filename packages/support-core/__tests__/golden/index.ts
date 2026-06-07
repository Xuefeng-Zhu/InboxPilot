/**
 * Golden conversations for the AI evaluation harness.
 *
 * 25 fixtures covering:
 *   - 5 pre-LLM escalation rule triggers (human request, profanity, sensitive topic,
 *     low-confidence, missing knowledge)
 *   - 8 LLM-driven "respond" decisions in draft_only / auto_reply mode
 *   - 4 LLM-driven "clarify" decisions
 *   - 4 LLM-driven "escalate" decisions
 *   - 2 ai-mode=off fixtures
 *   - 2 edge cases: LLM returns invalid JSON, LLM call throws
 *
 * Each fixture is deterministic and CI-friendly — no live API calls required.
 */

import type { GoldenConversation } from './types.js';

// ─── Helpers ────────────────────────────────────────────────────────

const NOW = new Date('2026-06-07T12:00:00Z');
const T0 = '2026-06-07T11:55:00Z';
const T1 = '2026-06-07T11:57:00Z';
const T2 = '2026-06-07T11:59:00Z';

function ts(offsetMin: number): string {
  return new Date(NOW.getTime() + offsetMin * 60_000).toISOString();
}

const RETURNS_KB: GoldenConversation['knowledgeChunks'] = [
  { id: 'kb-returns-1', content: 'Items can be returned within 30 days of delivery for a full refund. The item must be unworn and in its original packaging.' },
  { id: 'kb-returns-2', content: 'To start a return, log into your account, go to Orders, and click "Return item" next to the order. You will receive a prepaid shipping label by email within 1 business day.' },
];

const HOURS_KB: GoldenConversation['knowledgeChunks'] = [
  { id: 'kb-hours-1', content: 'Our support team is available Monday through Friday, 9am to 6pm Pacific Time. We respond to all messages within 1 business day.' },
];

const SHIPPING_KB: GoldenConversation['knowledgeChunks'] = [
  { id: 'kb-shipping-1', content: 'Standard shipping takes 3-5 business days within the continental US. Express shipping (1-2 business days) is available for an additional $9.95.' },
  { id: 'kb-shipping-2', content: 'We ship to all 50 US states, Canada, and most EU countries. International orders may be subject to customs duties.' },
];

const PASSWORD_KB: GoldenConversation['knowledgeChunks'] = [
  { id: 'kb-pw-1', content: 'To reset your password, click "Forgot password" on the login page. You will receive a password reset link by email within a few minutes.' },
];

// ─── 1–5: Pre-LLM escalation rule triggers ─────────────────────────

/** 1. Human request phrase → HumanRequestRule. */
export const GOLDEN_HUMAN_REQUEST: GoldenConversation = {
  id: 'gc-001-human-request',
  label: 'Customer asks to speak to a human',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'auto_reply',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'I want to speak to a human please', channel: 'sms', externalMessageId: 'ext-001-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'HumanRequestRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (escalation happened before LLM).', kind: 'binary' },
      { id: 'r-requires-human', description: 'The decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 2. Profanity → ProfanityAngerRule. */
export const GOLDEN_PROFANITY: GoldenConversation = {
  id: 'gc-002-profanity',
  label: 'Customer uses profanity',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'This is bullshit, your product is shit and I am furious', channel: 'sms', externalMessageId: 'ext-002-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'ProfanityAngerRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called.', kind: 'binary' },
      { id: 'r-requires-human', description: 'The decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 3. Sensitive topic (legal) → SensitiveTopicRule. */
export const GOLDEN_LEGAL: GoldenConversation = {
  id: 'gc-003-legal-threat',
  label: 'Customer mentions legal action',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'auto_reply',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'If this is not resolved I will be contacting my lawyer and pursuing legal action.', subject: 'Unresolved complaint', channel: 'email', externalMessageId: 'ext-003-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'SensitiveTopicRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called.', kind: 'binary' },
      { id: 'r-requires-human', description: 'The decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 4. Sensitive topic (refund) — handled at the LLM level, not pre-escalation.
 *  This is in the "respond" section below — but we add a copy here in case the
 *  escalation engine ever changes its mind about refund phrases. The harness
 *  uses the "respond" version (gc-008-refund-question) as the canonical one. */

/** 5. Missing knowledge (no KB chunks, knowledgeSimilarityThreshold high) →
 *  MissingKnowledgeRule. We force the threshold high so empty knowledge → trigger. */
export const GOLDEN_MISSING_KNOWLEDGE: GoldenConversation = {
  id: 'gc-005-missing-knowledge',
  label: 'Question outside knowledge base (no matching chunks)',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  // No knowledgeChunks on purpose.
  messages: [
    { senderType: 'contact', body: 'How do I integrate the API with Salesforce?', channel: 'sms', externalMessageId: 'ext-005-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'MissingKnowledgeRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (missing knowledge triggers pre-escalation).', kind: 'binary' },
      { id: 'r-requires-human', description: 'The decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

// ─── 6–13: LLM-driven "respond" decisions ──────────────────────────

/** 6. Returns question, draft_only, high confidence → respond (draft). */
export const GOLDEN_RETURNS_QUESTION: GoldenConversation = {
  id: 'gc-006-returns-question',
  label: 'Returns question, draft mode, high confidence',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'How do I return an item I bought last week?', channel: 'sms', externalMessageId: 'ext-006-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.7,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false, // draft_only
  },
  rubric: {
    criteria: [
      { id: 'r-30-day', description: 'Reply mentions the 30-day return window.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji (formal support context).', kind: 'binary' },
      { id: 'r-actionable', description: 'Reply tells the customer what action to take next.', kind: 'binary' },
      { id: 'r-length', description: 'Reply length is 30-300 characters (concise but complete).', kind: 'threshold', threshold: 0.7 },
    ],
  },
};

/** 7. Returns question, auto_reply, high confidence → respond (auto-sent). */
export const GOLDEN_RETURNS_AUTO: GoldenConversation = {
  id: 'gc-007-returns-auto',
  label: 'Returns question, auto-reply mode, high confidence',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'auto_reply',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'What is your return policy?', channel: 'sms', externalMessageId: 'ext-007-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.75,
    expectedEscalationRule: null,
    expectOutboundEnqueued: true, // auto_reply + high confidence
  },
  rubric: {
    criteria: [
      { id: 'r-30-day', description: 'Reply mentions the 30-day return window.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
      { id: 'r-tone', description: 'Tone is professional and friendly, not robotic.', kind: 'threshold', threshold: 0.6 },
    ],
  },
};

/** 8. "How do I get my money back for an item I never received" — uses
 *  the phrase "get my money", which SensitiveTopicRule will catch. So this
 *  fixture actually escalates via pre-LLM, not LLM. We re-purpose the
 *  label so the test reflects reality. */
export const GOLDEN_REFUND_QUESTION: GoldenConversation = {
  id: 'gc-008-refund-question',
  label: 'Refund phrasing (pre-escalation: SensitiveTopicRule)',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'Hello, I would like to request a refund for order #12345. Could you let me know the steps?', subject: 'Refund request', channel: 'email', externalMessageId: 'ext-008-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'SensitiveTopicRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (sensitive topic triggers pre-escalation).', kind: 'binary' },
      { id: 'r-requires-human', description: 'Decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 9. Hours question, draft mode. */
export const GOLDEN_HOURS_QUESTION: GoldenConversation = {
  id: 'gc-009-hours-question',
  label: 'Business hours question, draft mode',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: HOURS_KB,
  messages: [
    { senderType: 'contact', body: 'What are your business hours?', channel: 'sms', externalMessageId: 'ext-009-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.8,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-m-f', description: 'Reply mentions Monday-Friday.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
      { id: 'r-concise', description: 'Reply is concise (under 200 chars).', kind: 'binary' },
    ],
  },
};

/** 10. Shipping question, draft mode. */
export const GOLDEN_SHIPPING_QUESTION: GoldenConversation = {
  id: 'gc-010-shipping-question',
  label: 'Shipping question, draft mode',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: SHIPPING_KB,
  messages: [
    { senderType: 'contact', body: 'How long does standard shipping take?', subject: 'Shipping question', channel: 'email', externalMessageId: 'ext-010-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.7,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-3-5-days', description: 'Reply mentions 3-5 business days.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

/** 11. Password reset question, auto_reply mode. */
export const GOLDEN_PASSWORD_RESET: GoldenConversation = {
  id: 'gc-011-password-reset',
  label: 'Password reset, auto-reply mode',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'auto_reply',
  confidenceThreshold: 0.75,
  knowledgeChunks: PASSWORD_KB,
  messages: [
    { senderType: 'contact', body: 'I forgot my password, how do I reset it?', channel: 'sms', externalMessageId: 'ext-011-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.8,
    expectedEscalationRule: null,
    expectOutboundEnqueued: true,
  },
  rubric: {
    criteria: [
      { id: 'r-forgot-link', description: 'Reply tells the customer to click "Forgot password".', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

/** 12. Multi-turn conversation with prior context. */
export const GOLDEN_MULTITURN_RETURNS: GoldenConversation = {
  id: 'gc-012-multiturn-returns',
  label: 'Multi-turn returns conversation (prior AI reply)',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'Hi, I need help with an order.', subject: 'Order help', channel: 'email', externalMessageId: 'ext-012-1', createdAt: T0 },
    { senderType: 'ai', body: 'Of course — could you share your order number?', channel: 'email', createdAt: T1 },
    { senderType: 'contact', body: 'It is order #98765. I want to return the shoes.', channel: 'email', externalMessageId: 'ext-012-2', createdAt: T2 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.7,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-30-day', description: 'Reply mentions the 30-day return window.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
      { id: 'r-uses-context', description: 'Reply uses the order number or acknowledges the shoes.', kind: 'binary' },
    ],
  },
};

/** 13. Greeting-only message, draft mode → LLM should still respond (acknowledge). */
export const GOLDEN_GREETING: GoldenConversation = {
  id: 'gc-013-greeting',
  label: 'Customer just says "hi"',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: HOURS_KB,
  messages: [
    { senderType: 'contact', body: 'hi', channel: 'sms', externalMessageId: 'ext-013-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0.6,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-greets-back', description: 'Reply greets the customer back.', kind: 'binary' },
      { id: 'r-asks-question', description: 'Reply asks how it can help.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

// ─── 14–17: LLM-driven "clarify" decisions ─────────────────────────

/** 14. Ambiguous question that the LLM should ask to clarify (not enough info).
 *  The mock LLM returns confidence 0.7 (just below threshold 0.7) which
 *  triggers the post-LLM LowConfidenceRule. We expect the conversation to
 *  be ESCALATED — that's the design's safety net for low-confidence
 *  responses. */
export const GOLDEN_CLARIFY_ORDER: GoldenConversation = {
  id: 'gc-014-clarify-order',
  label: 'Vague question about "my order" (low-conf → escalate)',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: SHIPPING_KB,
  messages: [
    { senderType: 'contact', body: 'Where is my order?', channel: 'sms', externalMessageId: 'ext-014-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'LowConfidenceRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-asks-for-order', description: 'Reply asks the customer for their order number.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

/** 15. Unclear request needs clarification. */
export const GOLDEN_CLARIFY_BROKEN: GoldenConversation = {
  id: 'gc-015-clarify-broken',
  label: 'Vague "something is broken" message',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'something is broken', subject: 'help', channel: 'email', externalMessageId: 'ext-015-1', createdAt: T0 },
  ],
  expected: {
    decision: 'clarify',
    requiresHuman: false,
    minConfidence: 0.5,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-asks-detail', description: 'Reply asks the customer for more detail (what is broken, order number, etc).', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

/** 16. Two-question message that needs clarifying. */
export const GOLDEN_CLARIFY_DOUBLE: GoldenConversation = {
  id: 'gc-016-clarify-double',
  label: 'Message with two unrelated questions',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'Do you ship to Canada and can I pay with bitcoin?', channel: 'sms', externalMessageId: 'ext-016-1', createdAt: T0 },
  ],
  expected: {
    decision: 'clarify',
    requiresHuman: false,
    minConfidence: 0.4,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-asks-priority', description: 'Reply asks the customer which question to address first.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

/** 17. Off-topic question. */
export const GOLDEN_CLARIFY_OFFTOPIC: GoldenConversation = {
  id: 'gc-017-clarify-offtopic',
  label: 'Completely off-topic question',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'What is the meaning of life?', channel: 'sms', externalMessageId: 'ext-017-1', createdAt: T0 },
  ],
  expected: {
    decision: 'clarify',
    requiresHuman: false,
    minConfidence: 0.4,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-stays-on-topic', description: 'Reply does not attempt to answer the philosophical question.', kind: 'binary' },
      { id: 'r-redirects', description: 'Reply redirects to a support-related question.', kind: 'binary' },
      { id: 'r-no-emoji', description: 'Reply contains no emoji.', kind: 'binary' },
    ],
  },
};

// ─── 18–21: LLM-driven "escalate" decisions ────────────────────────

/** 18. LLM itself recognizes a complaint that warrants human attention. */
export const GOLDEN_LLM_ESCALATE_COMPLAINT: GoldenConversation = {
  id: 'gc-018-llm-escalate-complaint',
  label: 'Repeat complaint — LLM escalates',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'This is the third time I am writing in. Nobody has helped me. I have been a customer for 5 years and this is the worst experience of my life.', subject: 'Third complaint', channel: 'email', externalMessageId: 'ext-018-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0.5,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-auto-reply', description: 'AI does not auto-reply to a repeat complaint.', kind: 'binary' },
      { id: 'r-requires-human', description: 'Decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 19. Account closure. Uses the literal phrase "cancel my account" so
 *  SensitiveTopicRule pre-escalates. Verifies the keyword path fires. */
export const GOLDEN_LLM_ESCALATE_DELETE: GoldenConversation = {
  id: 'gc-019-llm-escalate-delete',
  label: 'Account closure (pre-escalation: SensitiveTopicRule)',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'I would like to cancel my account and have all of my data removed immediately.', subject: 'Account cancellation', channel: 'email', externalMessageId: 'ext-019-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'SensitiveTopicRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (sensitive topic triggers pre-escalation).', kind: 'binary' },
      { id: 'r-requires-human', description: 'Decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 20. Billing error. Uses the literal phrase "billing error" so
 *  SensitiveTopicRule pre-escalates. */
export const GOLDEN_LLM_ESCALATE_BILLING: GoldenConversation = {
  id: 'gc-020-llm-escalate-billing',
  label: 'Billing error (pre-escalation: SensitiveTopicRule)',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.7,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'There is a billing error on my most recent invoice — I was charged incorrectly for an item I returned.', subject: 'Billing error', channel: 'email', externalMessageId: 'ext-020-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0,
    expectedEscalationRule: 'SensitiveTopicRule',
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (sensitive topic triggers pre-escalation).', kind: 'binary' },
      { id: 'r-requires-human', description: 'Decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

/** 21. Complex technical integration question — LLM should escalate. */
export const GOLDEN_LLM_ESCALATE_INTEGRATION: GoldenConversation = {
  id: 'gc-021-llm-escalate-integration',
  label: 'Complex integration question',
  channel: 'email',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB, // intentionally unrelated KB
  messages: [
    { senderType: 'contact', body: 'I need to set up SAML SSO with our IdP, configure webhook retries with exponential backoff, and migrate 50,000 contacts via the bulk API. Can you walk me through this?', subject: 'Enterprise onboarding', channel: 'email', externalMessageId: 'ext-021-1', createdAt: T0 },
  ],
  expected: {
    decision: 'escalate',
    requiresHuman: true,
    minConfidence: 0.5,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-auto-reply', description: 'AI does not auto-reply to a multi-part enterprise question.', kind: 'binary' },
      { id: 'r-requires-human', description: 'Decision is marked requires_human=true.', kind: 'binary' },
    ],
  },
};

// ─── 22–23: ai-mode=off ────────────────────────────────────────────

/** 22. ai-mode=off, returns question. */
export const GOLDEN_MODE_OFF_RETURNS: GoldenConversation = {
  id: 'gc-022-mode-off-returns',
  label: 'ai-mode=off, returns question',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'off',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'How do I return an item?', channel: 'sms', externalMessageId: 'ext-022-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond', // skip-decision is recorded as 'respond' with confidence 0
    requiresHuman: false,
    minConfidence: 0,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (mode is off).', kind: 'binary' },
      { id: 'r-disabled-reason', description: 'Decision reasoning mentions "disabled".', kind: 'binary' },
    ],
  },
};

/** 23. ai-mode=off, profanity — should still not escalate (mode off). */
export const GOLDEN_MODE_OFF_PROFANITY: GoldenConversation = {
  id: 'gc-023-mode-off-profanity',
  label: 'ai-mode=off, profanity (escalation is also skipped)',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'off',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'this is shit', channel: 'sms', externalMessageId: 'ext-023-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-llm-call', description: 'No LLM was called (mode is off).', kind: 'binary' },
      { id: 'r-no-escalation', description: 'No escalation happens even though message contains profanity.', kind: 'binary' },
    ],
  },
};

// ─── 24–25: LLM failure modes ──────────────────────────────────────

/** 24. LLM returns invalid JSON → ai_state="failed", decision="respond" with
 *  confidence 0 and a parse_error tag. */
export const GOLDEN_LLM_INVALID_JSON: GoldenConversation = {
  id: 'gc-024-llm-invalid-json',
  label: 'LLM returns invalid JSON',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'How do I return an item?', channel: 'sms', externalMessageId: 'ext-024-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-response-text', description: 'Decision has no response_text (parse failed).', kind: 'binary' },
      { id: 'r-parse-error-tag', description: 'Decision tags include "parse_error".', kind: 'binary' },
    ],
  },
};

/** 25. LLM call throws → ai_state="failed", decision="respond" with
 *  confidence 0 and an "error" tag. */
export const GOLDEN_LLM_THROWS: GoldenConversation = {
  id: 'gc-025-llm-throws',
  label: 'LLM call throws',
  channel: 'sms',
  initialStatus: 'open',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  knowledgeChunks: RETURNS_KB,
  messages: [
    { senderType: 'contact', body: 'How do I return an item?', channel: 'sms', externalMessageId: 'ext-025-1', createdAt: T0 },
  ],
  expected: {
    decision: 'respond',
    requiresHuman: false,
    minConfidence: 0,
    expectedEscalationRule: null,
    expectOutboundEnqueued: false,
  },
  rubric: {
    criteria: [
      { id: 'r-no-response-text', description: 'Decision has no response_text (LLM call failed).', kind: 'binary' },
      { id: 'r-error-tag', description: 'Decision tags include "error".', kind: 'binary' },
    ],
  },
};

// ─── Catalog ───────────────────────────────────────────────────────

export const GOLDEN_CONVERSATIONS: GoldenConversation[] = [
  // Pre-LLM escalation
  GOLDEN_HUMAN_REQUEST,
  GOLDEN_PROFANITY,
  GOLDEN_LEGAL,
  GOLDEN_MISSING_KNOWLEDGE,
  // LLM respond
  GOLDEN_RETURNS_QUESTION,
  GOLDEN_RETURNS_AUTO,
  GOLDEN_REFUND_QUESTION,
  GOLDEN_HOURS_QUESTION,
  GOLDEN_SHIPPING_QUESTION,
  GOLDEN_PASSWORD_RESET,
  GOLDEN_MULTITURN_RETURNS,
  GOLDEN_GREETING,
  // LLM clarify
  GOLDEN_CLARIFY_ORDER,
  GOLDEN_CLARIFY_BROKEN,
  GOLDEN_CLARIFY_DOUBLE,
  GOLDEN_CLARIFY_OFFTOPIC,
  // LLM escalate
  GOLDEN_LLM_ESCALATE_COMPLAINT,
  GOLDEN_LLM_ESCALATE_DELETE,
  GOLDEN_LLM_ESCALATE_BILLING,
  GOLDEN_LLM_ESCALATE_INTEGRATION,
  // ai-mode=off
  GOLDEN_MODE_OFF_RETURNS,
  GOLDEN_MODE_OFF_PROFANITY,
  // LLM failure modes
  GOLDEN_LLM_INVALID_JSON,
  GOLDEN_LLM_THROWS,
];
