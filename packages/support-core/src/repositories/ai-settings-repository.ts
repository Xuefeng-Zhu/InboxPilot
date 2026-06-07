/**
 * AiSettingsRepository — data access for the ai_settings table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { AiSettings, AiMode, CreateAiSettingsInput } from '../types/index.js';

/**
 * Raw row shape returned by the database (snake_case columns).
 *
 * `knowledge_required` is optional at the row layer because pre-migration
 * rows (or rows that have not been re-read since the column was added) will
 * not have it set. The repository always defaults to `false` so the
 * HIGH-9 default-off behaviour holds even if a deployment is mid-rollout.
 */
interface AiSettingsRow {
  id: string;
  organization_id: string;
  ai_mode: AiMode;
  confidence_threshold: number;
  context_window_size: number;
  max_consecutive_failures: number;
  knowledge_similarity_threshold: number;
  knowledge_required?: boolean;
  escalation_keywords: string[];
  system_prompt: string | null;
  model: string;
  created_at: string;
  updated_at: string;
}

/** Convert a database row to an AiSettings entity. */
function toAiSettings(row: AiSettingsRow): AiSettings {
  return {
    id: row.id,
    organizationId: row.organization_id,
    aiMode: row.ai_mode,
    confidenceThreshold: Number(row.confidence_threshold),
    contextWindowSize: row.context_window_size,
    maxConsecutiveFailures: row.max_consecutive_failures,
    knowledgeSimilarityThreshold: Number(row.knowledge_similarity_threshold),
    // HIGH-9: default false at the repo layer so a missing column (pre-migration
    // rows) does not break callers. Matches the application default.
    knowledgeRequired: row.knowledge_required ?? false,
    escalationKeywords: row.escalation_keywords,
    systemPrompt: row.system_prompt,
    model: row.model,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert camelCase AiSettings fields to snake_case for database writes. */
function toRow(fields: Partial<AiSettings>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.organizationId !== undefined) row.organization_id = fields.organizationId;
  if (fields.aiMode !== undefined) row.ai_mode = fields.aiMode;
  if (fields.confidenceThreshold !== undefined) row.confidence_threshold = fields.confidenceThreshold;
  if (fields.contextWindowSize !== undefined) row.context_window_size = fields.contextWindowSize;
  if (fields.maxConsecutiveFailures !== undefined) row.max_consecutive_failures = fields.maxConsecutiveFailures;
  if (fields.knowledgeSimilarityThreshold !== undefined) row.knowledge_similarity_threshold = fields.knowledgeSimilarityThreshold;
  if (fields.knowledgeRequired !== undefined) row.knowledge_required = fields.knowledgeRequired;
  if (fields.escalationKeywords !== undefined) row.escalation_keywords = fields.escalationKeywords;
  if (fields.systemPrompt !== undefined) row.system_prompt = fields.systemPrompt;
  if (fields.model !== undefined) row.model = fields.model;
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();

  return row;
}

export class AiSettingsRepository {
  constructor(private db: DatabaseClient) {}

  /** Find AI settings for an organization. Returns null if not configured. */
  async findByOrg(orgId: string): Promise<AiSettings | null> {
    const { data, error } = await this.db
      .from('ai_settings')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) {
      throw new Error(`AiSettingsRepository.findByOrg failed: ${error.message}`);
    }

    return data ? toAiSettings(data as AiSettingsRow) : null;
  }

  /** Create a new AI settings record for an organization. */
  async create(input: CreateAiSettingsInput): Promise<AiSettings> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
    };

    if (input.aiMode !== undefined) row.ai_mode = input.aiMode;
    if (input.confidenceThreshold !== undefined) row.confidence_threshold = input.confidenceThreshold;
    if (input.contextWindowSize !== undefined) row.context_window_size = input.contextWindowSize;
    if (input.maxConsecutiveFailures !== undefined) row.max_consecutive_failures = input.maxConsecutiveFailures;
    if (input.knowledgeSimilarityThreshold !== undefined) row.knowledge_similarity_threshold = input.knowledgeSimilarityThreshold;
    if (input.knowledgeRequired !== undefined) row.knowledge_required = input.knowledgeRequired;
    if (input.escalationKeywords !== undefined) row.escalation_keywords = input.escalationKeywords;
    if (input.systemPrompt !== undefined) row.system_prompt = input.systemPrompt;
    if (input.model !== undefined) row.model = input.model;

    const { data, error } = await this.db
      .from('ai_settings')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`AiSettingsRepository.create failed: ${error.message}`);
    }

    return toAiSettings(data as AiSettingsRow);
  }

  /** Update AI settings for an organization by settings id. */
  async update(id: string, updates: Partial<AiSettings>): Promise<AiSettings> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('ai_settings')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`AiSettingsRepository.update failed: ${error.message}`);
    }

    return toAiSettings(data as AiSettingsRow);
  }
}
