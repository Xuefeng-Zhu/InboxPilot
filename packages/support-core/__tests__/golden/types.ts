/**
 * Golden-conversation fixture schema for the AI evaluation harness.
 *
 * Each fixture is a self-contained scenario: a seed conversation (contact
 * messages + optional prior AI replies), the AI settings that should be in
 * effect, the decision we expect `AiAgentService.processMessage` to produce,
 * and a rubric for the reply text (used by the LLM-as-judge step).
 *
 * The same fixture is runnable against:
 *   - the deterministic mock client (CI default, no network)
 *   - a real OpenRouter-backed client (manual, with OPENROUTER_API_KEY)
 */

import type {
  Channel,
  ConversationStatus,
  AiMode,
  AiDecisionType,
} from '../../src/types/index.js';

// ─── Rubric ────────────────────────────────────────────────────────

/** A single declarative criterion the LLM-as-judge will check. */
export interface RubricCriterion {
  /** Short stable id, used in CSV output. */
  id: string;
  /** What the judge is being asked to check. */
  description: string;
  /**
   * How the judge should score this criterion. All scores are 0..1.
   *  - "binary": pass = 1.0, fail = 0.0
   *  - "threshold": pass if score >= threshold, else 0.0
   */
  kind: 'binary' | 'threshold';
  /** For "threshold" kind, the minimum score for a pass. */
  threshold?: number;
}

/** The full rubric for a fixture. The overall rubric_pass is the mean of all criteria. */
export interface Rubric {
  criteria: RubricCriterion[];
}

// ─── Seed Conversation ─────────────────────────────────────────────

/** A single message in the seed conversation history. */
export interface SeedMessage {
  senderType: 'contact' | 'user' | 'ai' | 'system';
  body: string;
  subject?: string | null;
  channel: Channel;
  externalMessageId?: string | null;
  createdAt?: string; // ISO; defaults to "before now"
}

// ─── Expected Outcome ──────────────────────────────────────────────

/**
 * What we expect the AI to do. The harness compares the actual decision
 * against this — the `decision` field is the "what" and the rubric is the
 * "how well".
 */
export interface ExpectedDecision {
  /** Expected decision type (respond / escalate / clarify). */
  decision: AiDecisionType;
  /**
   * Whether we expect the conversation to be escalated to a human
   * (true if decision === "escalate", or if a pre-LLM escalation rule fires).
   */
  requiresHuman: boolean;
  /** Minimum confidence we accept (0..1). Below this = fail. */
  minConfidence: number;
  /**
   * The escalation rule we expect to fire, when applicable
   * (e.g. "HumanRequestRule"). Set to null when we expect the LLM to
   * handle it without a pre-escalation rule.
   */
  expectedEscalationRule: string | null;
  /**
   * For draft / auto-reply modes, optional expectation that the job queue
   * receives a "send_outbound_message" enqueue (auto-reply) or not (draft).
   * null = don't care (e.g. escalate or ai-mode=off fixtures).
   */
  expectOutboundEnqueued: boolean | null;
}

// ─── Golden Conversation ───────────────────────────────────────────

export interface GoldenConversation {
  /** Stable id used as the conversation id AND the seed conversation id. */
  id: string;
  /** Short human label, surfaces in CSV and reports. */
  label: string;
  /** Channel for the incoming contact message. */
  channel: Channel;
  /** Initial conversation status (usually "open"). */
  initialStatus: ConversationStatus;
  /** AI mode in effect for this fixture. */
  aiMode: AiMode;
  /** Confidence threshold in effect. */
  confidenceThreshold: number;
  /**
   * Optional knowledge chunks to return from the knowledge repo for this
   * fixture. When omitted, the harness supplies an empty knowledge set.
   */
  knowledgeChunks?: Array<{ id: string; content: string }>;
  /** Seed conversation history. The last entry is treated as the "latest message". */
  messages: SeedMessage[];
  /** What we expect the AI to decide. */
  expected: ExpectedDecision;
  /** Rubric for the LLM-as-judge to grade the response text. */
  rubric: Rubric;
}
