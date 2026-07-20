/**
 * AiDecisionRepository — data access for the ai_decisions table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  AiDecision,
  AiDecisionType,
  AiState,
  ConversationStatus,
  CreateAiDecisionInput,
} from '../types/index.js';

export interface AiTurnFinalization {
  sourceMessageId?: string | null;
  aiState: AiState;
  status?: ConversationStatus;
  expected?: {
    aiState?: AiState;
    status?: ConversationStatus;
  };
}

/** Raw row shape returned by the database (snake_case columns). */
interface AiDecisionRow {
  id: string;
  conversation_id: string;
  organization_id: string;
  source_job_id: string | null;
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
    sourceJobId: row.source_job_id ?? null,
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
    if (input.sourceJobId !== undefined) row.source_job_id = input.sourceJobId;
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

  /** Atomically persist a decision and publish its guarded terminal AI state. */
  async finalizeTurn(
    input: CreateAiDecisionInput,
    finalization: AiTurnFinalization,
  ): Promise<AiDecision | null> {
    const { data, error } = await this.db.rpc('finalize_ai_turn_with_decision', {
      p_conversation_id: input.conversationId,
      p_organization_id: input.organizationId,
      p_source_message_id: finalization.sourceMessageId ?? null,
      p_source_job_id: input.sourceJobId ?? null,
      p_message_id: input.messageId ?? null,
      p_decision_type: input.decisionType,
      p_confidence: input.confidence,
      p_reasoning_summary: input.reasoningSummary ?? null,
      p_response_text: input.responseText ?? null,
      p_tags: input.tags ?? [],
      p_requires_human: input.requiresHuman,
      p_raw_response: input.rawResponse ?? null,
      p_ai_state: finalization.aiState,
      p_status: finalization.status ?? null,
      p_expected_ai_state: finalization.expected?.aiState ?? null,
      p_expected_status: finalization.expected?.status ?? null,
    });

    if (error) {
      throw new Error(`AiDecisionRepository.finalizeTurn failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return row ? toAiDecision(row as AiDecisionRow) : null;
  }

  /** Find the decision already produced by a queue job, if any. */
  async findBySourceJobId(
    sourceJobId: string,
    organizationId: string,
  ): Promise<AiDecision | null> {
    const { data, error } = await this.db
      .from('ai_decisions')
      .select('*')
      .eq('source_job_id', sourceJobId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      throw new Error(`AiDecisionRepository.findBySourceJobId failed: ${error.message}`);
    }

    return data ? toAiDecision(data as AiDecisionRow) : null;
  }

  /** Update an existing AI decision by ID (partial update). */
  async update(id: string, fields: Partial<Pick<AiDecision, 'reasoningSummary' | 'responseText' | 'tags' | 'requiresHuman'>> & { metadata?: Record<string, unknown> }): Promise<AiDecision> {
    const row: Record<string, unknown> = {};
    if (fields.reasoningSummary !== undefined) row.reasoning_summary = fields.reasoningSummary;
    if (fields.responseText !== undefined) row.response_text = fields.responseText;
    if (fields.tags !== undefined) row.tags = fields.tags;
    if (fields.requiresHuman !== undefined) row.requires_human = fields.requiresHuman;
    if (fields.metadata !== undefined) {
      const { data: existingData, error: existingError } = await this.db
        .from('ai_decisions')
        .select('raw_response')
        .eq('id', id)
        .single();
      if (existingError) {
        throw new Error(`AiDecisionRepository.update metadata read failed: ${existingError.message}`);
      }
      const existingRow = existingData && typeof existingData === 'object'
        ? existingData as Record<string, unknown>
        : {};
      const existingRaw = existingRow.raw_response &&
          typeof existingRow.raw_response === 'object' &&
          !Array.isArray(existingRow.raw_response)
        ? existingRow.raw_response as Record<string, unknown>
        : {};
      row.raw_response = { ...existingRaw, ...fields.metadata };
    }

    const { data, error } = await this.db
      .from('ai_decisions')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`AiDecisionRepository.update failed: ${error.message}`);
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
   * Persist which knowledge chunks grounded a given AI decision.
   * One row inserted per (aiDecisionId, knowledgeChunkId) pair. Rows are
   * append-only audit records — there is no update method. A no-op when
   * `chunkIds` is empty so callers don't need to guard.
   *
   * Throws on failure, consistent with other write methods in this repo.
   * Callers (the AI agent service) wrap calls in try/catch if they need
   * soft-failure semantics.
   */
  async recordChunkRefs(
    aiDecisionId: string,
    organizationId: string,
    chunkIds: ReadonlyArray<string>,
  ): Promise<void> {
    if (chunkIds.length === 0) return;

    const rows = chunkIds.map((chunkId) => ({
      ai_decision_id: aiDecisionId,
      knowledge_chunk_id: chunkId,
      organization_id: organizationId,
    }));

    const { error } = await this.db
      .from('ai_decision_chunks')
      .insert(rows);

    if (error) {
      throw new Error(`AiDecisionRepository.recordChunkRefs failed: ${error.message}`);
    }
  }
}
