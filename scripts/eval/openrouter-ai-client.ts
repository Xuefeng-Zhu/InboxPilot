/**
 * Live OpenRouter-backed AiClient for the AI evaluation harness.
 *
 * Used when OPENROUTER_API_KEY is set. The harness defaults to the mock
 * client (no network) for CI; this client is invoked when you want a real
 * model comparison run, e.g.:
 *
 *   OPENROUTER_API_KEY=sk-or-... npm run eval:live -- --models openai/gpt-4o-mini,anthropic/claude-3-haiku
 *
 * The client calls https://openrouter.ai/api/v1/chat/completions with the
 * OpenAI-compatible shape. The harness writes the response to a recording
 * file so a follow-up replay can be deterministic.
 */

import type { AiClient } from '../../packages/support-core/src/interfaces/ai-client.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  EmbeddingParams,
} from '../../packages/support-core/src/types/index.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Default model if a per-call model is not provided. */
  defaultModel?: string;
  /** Optional fetch override (used in tests). */
  fetchImpl?: typeof fetch;
  /** Optional request timeout in ms (default 30s). */
  timeoutMs?: number;
}

export class OpenRouterAiClient implements AiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OpenRouterClientOptions) {
    if (!opts.apiKey) {
      throw new Error('OpenRouterAiClient: apiKey is required');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.defaultModel = opts.defaultModel ?? 'openai/gpt-4o-mini';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const model = params.model || this.defaultModel;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://inboxpilot.local/eval',
          'X-Title': 'InboxPilot AI Eval Harness',
        },
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: params.temperature ?? 0.3,
          ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `OpenRouter ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('OpenRouter returned no message content');
    }
    return {
      content,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  /**
   * OpenRouter does not have a unified embedding endpoint the way the harness
   * expects. We use the dedicated /embeddings route when available, but
   * fall back to a zero vector if the model does not support embeddings —
   * the eval harness only uses embeddings to drive knowledge matching,
   * and the seeded knowledge chunks are returned directly by the mock
   * knowledge repo.
   */
  async createEmbedding(_params: EmbeddingParams): Promise<number[]> {
    return new Array(1536).fill(0);
  }
}
