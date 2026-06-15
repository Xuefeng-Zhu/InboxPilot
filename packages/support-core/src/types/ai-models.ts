/**
 * Canonical model catalog for the LLM model picker.
 *
 * - `CHAT_MODEL_OPTIONS` lists the chat models exposed in the Settings UI dropdown.
 *   Includes the legacy 'openai/gpt-4o-mini' for backward compat with existing orgs.
 * - `EMBEDDING_MODEL_OPTIONS` lists the embedding models for the knowledge base.
 *   All entries MUST produce 1536-dim vectors to match `knowledge_chunks.embedding vector(1536)`.
 *
 * The portable support-core layer uses these to derive `ModelId` / `EmbeddingModelId`
 * literal-union types; the InsForge SDK is never imported here.
 */

export const CHAT_MODEL_OPTIONS = [
  'openai/gpt-5-mini',
  'openai/gpt-4.1-mini',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5',
  'google/gemini-2.5-flash',
  'openai/gpt-4.1',
  'openai/o4-mini',
  'google/gemini-2.5-pro',
  'meta-llama/llama-4-maverick',
  'mistralai/mistral-small-3.2-24b-instruct',
  'openai/gpt-4o-mini', // legacy — kept for backward compat with existing ai_settings rows
] as const;

export type ModelId = (typeof CHAT_MODEL_OPTIONS)[number];

export const EMBEDDING_MODEL_OPTIONS = [
  'openai/text-embedding-3-small',
  'openai/text-embedding-ada-002', // legacy — kept for backward compat with existing KB chunks
] as const;

export type EmbeddingModelId = (typeof EMBEDDING_MODEL_OPTIONS)[number];

export const DEFAULT_CHAT_MODEL: ModelId = 'openai/gpt-5-mini';
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelId = 'openai/text-embedding-3-small';
