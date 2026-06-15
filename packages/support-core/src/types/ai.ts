/**
 * AI client I/O types.
 *
 * These are the shapes passed to and returned by the `AiClient` interface
 * (in `./interfaces/ai-client`). The portable `AiClient` contract is
 * provider-agnostic; concrete model parameters (temperature, JSON mode,
 * token usage) flow through these types so adapters can map them onto
 * OpenAI / Anthropic / OpenRouter specifics without leaking provider
 * concerns into services.
 */

import type { EmbeddingModelId, ModelId } from './ai-models';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: ModelId;
  messages: ChatMessage[];
  responseFormat?: { type: 'json_object' };
  temperature?: number;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingParams {
  model: EmbeddingModelId;
  input: string;
}
