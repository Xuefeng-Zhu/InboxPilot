import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  fetch: vi.fn(),
  memberRows: [{ user_id: 'user-2' }, { user_id: 'user-3' }] as unknown,
  memberError: null as { message: string } | null,
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
}));

vi.mock('@/app/api/functions/_auth', () => ({
  getUserFromToken: mocks.getUserFromToken,
  userHasOrgPermission: mocks.userHasOrgPermission,
}));

import { POST as postTeamMemberInfo } from '../../app/api/functions/team-member-info/route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/functions/team-member-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return new Request('http://localhost/api/functions/team-member-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  }) as NextRequest;
}

function createMemberBuilder() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.then.mockImplementation((onfulfilled, onrejected) => (
    Promise.resolve({ data: mocks.memberRows, error: mocks.memberError })
      .then(onfulfilled, onrejected)
  ));
  return builder;
}

describe('team-member-info route', () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const originalServiceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberRows = [{ user_id: 'user-2' }, { user_id: 'user-3' }];
    mocks.memberError = null;
    mocks.from.mockImplementation(() => createMemberBuilder());
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    process.env.NEXT_PUBLIC_INSFORGE_URL = 'https://api.example.test';
    process.env.INSFORGE_SERVICE_ROLE_KEY = 'service-key';
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), {
      status: 200,
    }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_INSFORGE_URL;
    } else {
      process.env.NEXT_PUBLIC_INSFORGE_URL = originalBaseUrl;
    }
    if (originalServiceKey === undefined) {
      delete process.env.INSFORGE_SERVICE_ROLE_KEY;
    } else {
      process.env.INSFORGE_SERVICE_ROLE_KEY = originalServiceKey;
    }
    vi.unstubAllGlobals();
  });

  it('rejects anonymous callers before reading member rows', async () => {
    mocks.getUserFromToken.mockResolvedValue(null);

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await postTeamMemberInfo(makeInvalidJsonRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('requires an organization id', async () => {
    const response = await postTeamMemberInfo(makeRequest({}));

    expect(response.status).toBe(400);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
  });

  it('does not disclose member profiles outside the caller organization', async () => {
    mocks.userHasOrgPermission.mockResolvedValue(false);

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-foreign',
    }));

    expect(response.status).toBe(403);
    expect(mocks.userHasOrgPermission).toHaveBeenCalledWith(
      'user-1',
      'org-foreign',
      'view_conversations',
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('surfaces membership query failures', async () => {
    mocks.memberError = { message: 'membership query unavailable' };

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'membership query unavailable',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns an empty list without calling the admin API when the org has no members', async () => {
    mocks.memberRows = [];

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('falls back to identifier-only rows when admin credentials are unavailable', async () => {
    delete process.env.INSFORGE_SERVICE_ROLE_KEY;

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        { id: 'user-2', email: null, name: null, avatarUrl: null },
        { id: 'user-3', email: null, name: null, avatarUrl: null },
      ],
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns only profiles belonging to the authorized organization', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [
        {
          id: 'user-2',
          email: 'two@example.com',
          profile: { name: 'User Two', avatar_url: 'https://cdn.example.test/2.png' },
        },
        {
          id: 'user-foreign',
          email: 'foreign@example.com',
          profile: { name: 'Foreign User' },
        },
      ],
    }), { status: 200 }));

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'user-2',
          email: 'two@example.com',
          name: 'User Two',
          avatarUrl: 'https://cdn.example.test/2.png',
        },
        { id: 'user-3', email: null, name: null, avatarUrl: null },
      ],
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/users?limit=1000',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer service-key' },
      }),
    );
  });

  it('falls back safely when the admin user request fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('network unavailable'));

    const response = await postTeamMemberInfo(makeRequest({
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        { id: 'user-2', email: null, name: null, avatarUrl: null },
        { id: 'user-3', email: null, name: null, avatarUrl: null },
      ],
    });
  });
});
