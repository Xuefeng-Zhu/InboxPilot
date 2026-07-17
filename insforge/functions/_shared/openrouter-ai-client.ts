import type { AiClient } from '../../../packages/support-core/src/interfaces/ai-client.ts';

const KEY_REQUEST_TIMEOUT_MS = 10_000;
const MODEL_REQUEST_TIMEOUT_MS = 60_000;

/** Build the worker's OpenRouter-backed AI boundary with invocation-local key caching. */
export function createOpenRouterAiClient(
  baseUrl: string,
  serviceRoleKey: string,
): AiClient {
  let openRouterKey: string | null = null;

  async function getOpenRouterKey(): Promise<string> {
    if (openRouterKey) return openRouterKey;
    const response = await fetch(`${baseUrl}/api/ai/openrouter/api-key`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
      signal: AbortSignal.timeout(KEY_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenRouter key: HTTP ${response.status}`);
    }
    const data = await response.json() as unknown;
    const apiKey = data && typeof data === 'object' && 'apiKey' in data
      ? (data as { apiKey?: unknown }).apiKey
      : null;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('OpenRouter key response did not include apiKey');
    }
    openRouterKey = apiKey;
    return openRouterKey;
  }

  return {
    async chatCompletion(params) {
      const key = await getOpenRouterKey();
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          response_format: params.responseFormat,
          temperature: params.temperature,
        }),
        signal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error');
        throw new Error(`AI chat completion failed: HTTP ${response.status} — ${errorBody}`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      const choices = Array.isArray(data.choices)
        ? data.choices as Array<{ message?: { content?: unknown } }>
        : [];
      const content = choices[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('AI chat completion response did not include message content');
      }
      return {
        content,
        usage: undefined,
      };
    },

    async createEmbedding(params) {
      const key = await getOpenRouterKey();
      const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: params.model, input: params.input }),
        signal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error');
        throw new Error(`AI embedding failed: HTTP ${response.status} — ${errorBody}`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      const embeddings = Array.isArray(data.data)
        ? data.data as Array<{ embedding?: unknown }>
        : [];
      const embedding = embeddings[0]?.embedding;
      if (
        !Array.isArray(embedding) ||
        embedding.length === 0 ||
        !embedding.every((value) => typeof value === 'number')
      ) {
        throw new Error('AI embedding response did not include a numeric vector');
      }
      return embedding;
    },
  };
}
