import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  createInsforgeDbAdapter: vi.fn(),
  changeMemberRole: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  removeWidget: vi.fn(),
  fetch: vi.fn(),
  targetRole: 'agent',
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
}));

vi.mock('@/app/api/functions/_auth', () => ({
  getUserFromToken: mocks.getUserFromToken,
  userHasOrgPermission: mocks.userHasOrgPermission,
}));

vi.mock('@/app/api/functions/_insforge-db-adapter', () => ({
  createInsforgeDbAdapter: mocks.createInsforgeDbAdapter,
}));

vi.mock('@support-core/services/organization-service', () => ({
  OrganizationService: class {
    changeMemberRole = mocks.changeMemberRole;
    inviteMember = mocks.inviteMember;
    removeMember = mocks.removeMember;
  },
}));

vi.mock('@support-core/services/webchat-widget-service', () => ({
  WebchatWidgetService: class {
    removeWidget = mocks.removeWidget;
  },
}));

vi.mock('@support-core/repositories/organization-repository', () => ({
  OrganizationRepository: class {},
}));

vi.mock('@support-core/repositories/member-repository', () => ({
  MemberRepository: class {},
}));

vi.mock('@support-core/repositories/audit-log-repository', () => ({
  AuditLogRepository: class {},
}));

vi.mock('@support-core/repositories/webchat-widget-repository', () => ({
  WebchatWidgetRepository: class {},
}));

import { POST as postChangeMemberRole } from '../../app/api/functions/change-member-role/route';
import { POST as postDeleteWidget } from '../../app/api/functions/delete-widget/route';
import { POST as postInviteMember } from '../../app/api/functions/invite-member/route';
import { POST as postRemoveMember } from '../../app/api/functions/remove-member/route';

function makeRequest(
  path: string,
  body: Record<string, unknown>,
): NextRequest {
  return new Request(`http://localhost/api/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function makeInvalidJsonRequest(path: string): NextRequest {
  return new Request(`http://localhost/api/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  }) as NextRequest;
}

function createOwnerLookupBuilder() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.then.mockImplementation((onfulfilled, onrejected) => (
    Promise.resolve({ data: [{ role: mocks.targetRole }], error: null })
      .then(onfulfilled, onrejected)
  ));
  return builder;
}

const requests = [
  {
    name: 'change-member-role',
    post: postChangeMemberRole,
    body: { organizationId: 'org-1', memberId: 'member-1', newRole: 'admin' },
  },
  {
    name: 'invite-member',
    post: postInviteMember,
    body: { organizationId: 'org-1', email: 'new@example.com', role: 'agent' },
  },
  {
    name: 'remove-member',
    post: postRemoveMember,
    body: { organizationId: 'org-1', memberId: 'member-1' },
  },
  {
    name: 'delete-widget',
    post: postDeleteWidget,
    body: { organizationId: 'org-1', widgetId: 'widget-1' },
  },
] as const;

describe('member and widget action routes', () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const originalServiceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.targetRole = 'agent';
    mocks.from.mockImplementation(() => createOwnerLookupBuilder());
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    mocks.createInsforgeDbAdapter.mockReturnValue({});
    mocks.changeMemberRole.mockResolvedValue({ id: 'member-1', role: 'admin' });
    mocks.inviteMember.mockResolvedValue({ id: 'member-2', role: 'agent' });
    mocks.removeMember.mockResolvedValue(undefined);
    mocks.removeWidget.mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_INSFORGE_URL = 'https://api.example.test';
    process.env.INSFORGE_SERVICE_ROLE_KEY = 'service-key';
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'target-user', email: 'new@example.com' }],
    }), { status: 200 }));
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

  it.each(requests)('$name rejects anonymous callers', async ({ post, name, body }) => {
    mocks.getUserFromToken.mockResolvedValue(null);

    const response = await post(makeRequest(name, body));

    expect(response.status).toBe(401);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
  });

  it.each(requests)('$name rejects callers without permission', async ({ post, name, body }) => {
    mocks.userHasOrgPermission.mockResolvedValue(false);

    const response = await post(makeRequest(name, body));

    expect(response.status).toBe(403);
    expect(mocks.changeMemberRole).not.toHaveBeenCalled();
    expect(mocks.inviteMember).not.toHaveBeenCalled();
    expect(mocks.removeMember).not.toHaveBeenCalled();
    expect(mocks.removeWidget).not.toHaveBeenCalled();
  });

  it('validates role-change input', async () => {
    const response = await postChangeMemberRole(makeRequest('change-member-role', {
      organizationId: 'org-1',
      memberId: 'member-1',
      newRole: 'super-admin',
    }));

    expect(response.status).toBe(400);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
  });

  it('validates invite input', async () => {
    const response = await postInviteMember(makeRequest('invite-member', {
      organizationId: 'org-1',
      email: 'not-an-email',
      role: 'owner',
    }));

    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('validates member-removal input', async () => {
    const response = await postRemoveMember(makeRequest('remove-member', {
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(400);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
  });

  it('validates widget-deletion input', async () => {
    const response = await postDeleteWidget(makeRequest('delete-widget', {
      organizationId: 'org-1',
    }));

    expect(response.status).toBe(400);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'invite-member', post: postInviteMember },
    { name: 'delete-widget', post: postDeleteWidget },
  ])('$name rejects malformed JSON', async ({ name, post }) => {
    const response = await post(makeInvalidJsonRequest(name));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('delegates authorized role changes with the authenticated actor', async () => {
    const response = await postChangeMemberRole(makeRequest('change-member-role', {
      organizationId: 'org-1',
      memberId: 'member-1',
      newRole: 'admin',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'member-1', role: 'admin' },
    });
    expect(mocks.changeMemberRole).toHaveBeenCalledWith(
      'org-1',
      'member-1',
      'admin',
      'user-1',
    );
  });

  it('requires owner permission for ownership promotion', async () => {
    mocks.userHasOrgPermission
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await postChangeMemberRole(makeRequest('change-member-role', {
      organizationId: 'org-1',
      memberId: 'member-1',
      newRole: 'owner',
    }));

    expect(response.status).toBe(403);
    expect(mocks.userHasOrgPermission).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'org-1',
      'delete_org',
    );
    expect(mocks.changeMemberRole).not.toHaveBeenCalled();
  });

  it('resolves invite emails exactly and delegates with the authenticated actor', async () => {
    const response = await postInviteMember(makeRequest('invite-member', {
      organizationId: 'org-1',
      email: '  NEW@example.com ',
      role: 'agent',
    }));

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/users?search=new%40example.com&limit=1000',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer service-key' },
      }),
    );
    expect(mocks.inviteMember).toHaveBeenCalledWith(
      'org-1',
      'target-user',
      'agent',
      'user-1',
    );
  });

  it('does not invite a partial admin-search match', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'other-user', email: 'new+other@example.com' }],
    }), { status: 200 }));

    const response = await postInviteMember(makeRequest('invite-member', {
      organizationId: 'org-1',
      email: 'new@example.com',
      role: 'viewer',
    }));

    expect(response.status).toBe(404);
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });

  it('requires owner permission to remove an owner', async () => {
    mocks.targetRole = 'owner';
    mocks.userHasOrgPermission
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await postRemoveMember(makeRequest('remove-member', {
      organizationId: 'org-1',
      memberId: 'owner-member',
    }));

    expect(response.status).toBe(403);
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it('delegates authorized member removal with the authenticated actor', async () => {
    const response = await postRemoveMember(makeRequest('remove-member', {
      organizationId: 'org-1',
      memberId: 'member-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { removed: true } });
    expect(mocks.removeMember).toHaveBeenCalledWith(
      'org-1',
      'member-1',
      'user-1',
    );
  });

  it('delegates authorized widget deletion with the authenticated actor', async () => {
    const response = await postDeleteWidget(makeRequest('delete-widget', {
      organizationId: 'org-1',
      widgetId: 'widget-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { deleted: true } });
    expect(mocks.removeWidget).toHaveBeenCalledWith(
      'org-1',
      'widget-1',
      'user-1',
    );
  });

  it('maps a cross-organization widget lookup to not found', async () => {
    mocks.removeWidget.mockRejectedValue(new Error('Widget widget-foreign not found'));

    const response = await postDeleteWidget(makeRequest('delete-widget', {
      organizationId: 'org-1',
      widgetId: 'widget-foreign',
    }));

    expect(response.status).toBe(404);
    expect(mocks.removeWidget).toHaveBeenCalledWith(
      'org-1',
      'widget-foreign',
      'user-1',
    );
  });
});
