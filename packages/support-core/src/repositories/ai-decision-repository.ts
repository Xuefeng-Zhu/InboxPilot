/**
 * AiDecisionRepository — data access for the ai_decisions table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { AiDecision, AiDecisionType, CreateAiDecisionInput } from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface AiDecisionRow {
  id: string;
  conversation_id: string;
  organization_id: string;
  message_id: string | null;
  decision_type: AiDecisionType;
  confidence: number;
  reasoning_summary: string | null;
  response_text: string | null;
  tags: string[];
  requires_human: boolean;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}

/** Convert a database row to an AiDecision entity. */
function toAiDecision(row: AiDecisionRow): AiDecision {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    messageId: row.message_id,
    decisionType: row.decision_type,
    confidence: Number(row.confidence),
    reasoningSummary: row.reasoning_summary,
    responseText: row.response_text,
    tags: row.tags,
    requiresHuman: row.requires_human,
    rawResponse: row.raw_response,
    createdAt: new Date(row.created_at),
  };
}

export class AiDecisionRepository {
  constructor(private db: DatabaseClient) {}

  /** Create a new AI decision record. */
  async create(input: CreateAiDecisionInput): Promise<AiDecision> {
    const row: Record<string, unknown> = {
      conversation_id: input.conversationId,
      organization_id: input.organizationId,
      decision_type: input.decisionType,
      confidence: input.confidence,
      requires_human: input.requiresHuman,
    };

    if (input.messageId !== undefined) row.message_id = input.messageId;
    if (input.reasoningSummary !== undefined) row.reasoning_summary = input.reasoningSummary;
    if (input.responseText !== undefined) row.response_text = input.responseText;
    if (input.tags !== undefined) row.tags = input.tags;
    if (input.rawResponse !== undefined) row.raw_response = input.rawResponse;

    const { data, error } = await this.db
      .from('ai_decisions')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`AiDecisionRepository.create failed: ${error.message}`);
    }

    return toAiDecision(data as AiDecisionRow);
  }

  /** Find the latest AI decision for a conversation, ordered by created_at DESC. */
  async findLatestByConversation(conversationId: string): Promise<AiDecision | null> {
    const { data, error } = await this.db
      .from('ai_decisions')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`AiDecisionRepository.findLatestByConversation failed: ${error.message}`);
    }

    return data ? toAiDecision(data as AiDecisionRow) : null;
  }

  /**
   * Find the most recent AI decisions for a conversation, ordered by created_at DESC.
   * Used by AiAgentService to count consecutive failures (see `countConsecutiveFailures`).
   */
  async listRecentByConversation(
    conversationId: string,
    limit: number = 10,
  ): Promise<AiDecision[]> {
    const { data, error } = await this.db
      .from('ai_decisions')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`AiDecisionRepository.listRecentByConversation failed: ${error.message}`);
    }

    return (data as AiDecisionRow[] | null ?? []).map(toAiDecision);
  }

  /**
   * Count consecutive AI failures for a conversation, most-recent first.
   *
   * "Failure" = `decision_type='respond'` with tags containing `'parse_error'` or `'error'`
   * (the two tags used by AiAgentService when an LLM call or parse step fails — see
   * `tags: ['parse_error']` on parse failures and `tags: ['error']` on thrown errors).
   *
   * Counting stops at the first non-failure row, so e.g. a sequence
   * [respond-error, respond-error, respond-ok, respond-error] returns 2, not 3.
   * Returns 0 if there are no decisions or the most-recent is not a failure.
   *
   * This is the data source that powers `RepeatedFailureRule` — a max-failures
   * threshold of e.g. 3 now actually fires after three consecutive bad LLM
   * calls instead of being a permanent no-op.
   */
  async countConsecutiveFailures(
    conversationId: string,
    window: number = 10,
  ): Promise<number> {
    const recent = await this.listRecentByConversation(conversationId, window);
    const FAILURE_TAGS = new Set(['parse_error', 'error']);

    let count = 0;
    for (const decision of recent) {
      const isFailure =
        decision.decisionType === 'respond' &&
        decision.tags.some((tag) => FAILURE_TAGS.has(tag));
      if (isFailure) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }
}
