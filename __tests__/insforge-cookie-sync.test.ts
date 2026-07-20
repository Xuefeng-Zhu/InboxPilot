/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkState = vi.hoisted(() => ({
  fetch: undefined as typeof fetch | undefined,
}));

vi.mock('@insforge/sdk', () => ({
  createClient: (options: { fetch?: typeof fetch }) => {
    sdkState.fetch = options.fetch;
    return {};
  },
}));

describe('InsForge access-token cookie synchronization', () => {
  beforeEach(() => {
    vi.resetModules();
    sdkState.fetch = undefined;
    document.cookie = 'insforge_access_token=; path=/; max-age=0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mirrors the token returned by the SDK session refresh endpoint', async () => {
    const originalFetch = vi.fn(async () => new Response(
      JSON.stringify({ accessToken: 'fresh-session-token' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ));
    vi.stubGlobal('fetch', originalFetch);

    const { getAccessToken } = await import('@/lib/insforge');
    const sdkFetch = sdkState.fetch;
    expect(sdkFetch).toBeDefined();

    await sdkFetch?.('https://project.insforge.app/api/auth/sessions/current');

    expect(originalFetch).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBe('fresh-session-token');
  });
});
