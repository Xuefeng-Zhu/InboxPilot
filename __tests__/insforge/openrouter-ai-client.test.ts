import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterAiClient } from '../../insforge/functions/_shared/openrouter-ai-client';

describe('createOpenRouterAiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches the gateway key and maps chat and embedding responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiKey: 'openrouter-key' }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2] }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createOpenRouterAiClient('https://backend.test', 'service-key');

    await expect(client.chatCompletion({
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: 'hello' }],
    })).resolves.toMatchObject({ content: '{"ok":true}' });
    await expect(client.createEmbedding({
      model: 'openai/text-embedding-3-small',
      input: 'hello',
    })).resolves.toEqual([0.1, 0.2]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/api/ai/openrouter/api-key'),
    )).toHaveLength(1);
  });

  it('surfaces provider error bodies for failed model requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiKey: 'openrouter-key' }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createOpenRouterAiClient('https://backend.test', 'service-key');

    await expect(client.chatCompletion({
      model: 'openai/gpt-5-mini',
      messages: [{ role: 'user', content: 'hello' }],
    })).rejects.toThrow('HTTP 429 — rate limited');
  });

  it('rejects malformed gateway credentials instead of sending an undefined key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    ));
    const client = createOpenRouterAiClient('https://backend.test', 'service-key');

    await expect(client.createEmbedding({
      model: 'openai/text-embedding-3-small',
      input: 'hello',
    })).rejects.toThrow('did not include apiKey');
  });
});
