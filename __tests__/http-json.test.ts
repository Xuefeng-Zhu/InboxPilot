import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRequestJsonObject, readResponseJsonObject } from '@/lib/http-json';

describe('HTTP JSON helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads object responses and treats blank responses as empty objects', async () => {
    await expect(
      readResponseJsonObject(new Response('{"status":"ok"}')),
    ).resolves.toEqual({ status: 'ok' });
    await expect(readResponseJsonObject(new Response(''))).resolves.toEqual({});
  });

  it('warns and returns an empty object for malformed or non-object responses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      readResponseJsonObject(new Response('not json'), 'provider response'),
    ).resolves.toEqual({});
    await expect(
      readResponseJsonObject(new Response('[1,2,3]'), 'provider response'),
    ).resolves.toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('distinguishes invalid request bodies from blank request bodies', async () => {
    await expect(
      readRequestJsonObject(new Request('https://example.test', {
        method: 'POST',
        body: '',
      })),
    ).resolves.toEqual({});
    await expect(
      readRequestJsonObject(new Request('https://example.test', {
        method: 'POST',
        body: 'not json',
      })),
    ).resolves.toBeNull();
    await expect(
      readRequestJsonObject(new Request('https://example.test', {
        method: 'POST',
        body: '[1,2,3]',
      })),
    ).resolves.toBeNull();
  });
});
