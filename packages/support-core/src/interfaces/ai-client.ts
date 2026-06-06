/**
 * Provider-neutral AI client interface.
 *
 * Wraps LLM chat completion and embedding generation behind a portable
 * contract. The InsForge AI gateway (OpenRouter) is one implementation;
 * others (OpenAI direct, Anthropic, local models) can be swapped in.
 */

import type {
  ChatCompletionParams,
  ChatCompletionResult,
  EmbeddingParams,
} from '../types/index.js';

export interface AiClient {
  /** Generate a chat completion from the given messages. */
  chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>;

  /** Create an embedding vector for the given input text. */
  createEmbedding(params: EmbeddingParams): Promise<number[]>;
}
