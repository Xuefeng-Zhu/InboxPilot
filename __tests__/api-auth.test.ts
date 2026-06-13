import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserFromToken } from '../app/api/functions/_auth';

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: {
    database: {
      from: vi.fn(),
    },
  },
}));

function createRequest(token: string | null) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null),
    },
    cookies: {
      get: () => undefined,
    },
  };
}

describe('API function auth', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_INSFORGE_URL = 'https://example.insforge.app';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_INSFORGE_URL;
  });

  it('rejects tokens that InsForge does not verify', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const user = await getUserFromToken(createRequest('forged-token') as any);

    expect(user).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/sessions/current'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer forged-token' },
      }),
    );
  });

  it('returns the verified InsForge user id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'user-1' } }),
    }));

    await expect(getUserFromToken(createRequest('valid-token') as any)).resolves.toEqual({ id: 'user-1' });
  });
});
