/**
 * POST /api/functions/invite-member
 *
 * Body: { organizationId: string, email: string, role: MemberRole }
 * Required permission: 'manage_members'
 *
 * Resolves the target `user_id` from the provided email by querying the
 * InsForge admin user list, then delegates to OrganizationService.inviteMember,
 * which records a 'member_added' audit log entry.
 *
 * Note: 'owner' is intentionally not a valid invite role — ownership is
 * transferred, not assigned. OrganizationService rejects this with a 400
 * either way; we surface a friendlier message at the API boundary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { createInsforgeDbAdapter } from '../_insforge-db-adapter';
import { OrganizationService } from '@support-core/services/organization-service';
import { OrganizationRepository } from '@support-core/repositories/organization-repository';
import { MemberRepository } from '@support-core/repositories/member-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import type { MemberRole } from '@support-core/types';

const VALID_ROLES: ReadonlyArray<MemberRole> = ['admin', 'agent', 'viewer'];
// 'owner' is excluded — ownership is transferred via changeMemberRole, not invite.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AdminUserRow {
  id: string;
  email: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      organizationId?: unknown;
      email?: unknown;
      role?: unknown;
    };

    const organizationId = body.organizationId;
    const email = body.email;
    const role = body.role;

    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json(
        { error: 'organizationId is required' },
        { status: 400 },
      );
    }
    if (
      typeof email !== 'string' ||
      email.trim().length > 254 ||
      !EMAIL_REGEX.test(email.trim())
    ) {
      return NextResponse.json(
        { error: 'A valid email is required' },
        { status: 400 },
      );
    }
    if (typeof role !== 'string' || !VALID_ROLES.includes(role as MemberRole)) {
      return NextResponse.json(
        { error: `role must be one of: ${VALID_ROLES.join(', ')}` },
        { status: 400 },
      );
    }

    const allowed = await userHasOrgPermission(
      user.id,
      organizationId,
      'manage_members',
    );
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Resolve user_id from email via the admin REST endpoint.
    const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
    const adminKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
    if (!baseUrl || !adminKey) {
      return NextResponse.json(
        { error: 'InsForge admin credentials not configured' },
        { status: 500 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    // Pull a large page; we then exact-match in code so the email-of-record
    // is unambiguous regardless of how the server's `search` param works
    // (prefix/substring/etc.) and whether the target is in the first
    // handful of results. 1000 mirrors the team-member-info limit.
    const searchRes = await fetch(
      `${baseUrl}/api/auth/users?search=${encodeURIComponent(normalizedEmail)}&limit=1000`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminKey}` },
        cache: 'no-store',
      },
    );

    if (!searchRes.ok) {
      return NextResponse.json(
        { error: `Admin user search failed: ${searchRes.status}` },
        { status: 502 },
      );
    }

    const searchJson = (await searchRes.json()) as { data?: AdminUserRow[] };
    const matched = (Array.isArray(searchJson.data) ? searchJson.data : []).find(
      (u) => typeof u.email === 'string' && u.email.toLowerCase() === normalizedEmail,
    );

    if (!matched) {
      return NextResponse.json(
        {
          error:
            'No InsForge account with that email. They must sign up before they can be invited.',
        },
        { status: 404 },
      );
    }

    const db = createInsforgeDbAdapter();
    const orgRepo = new OrganizationRepository(db);
    const memberRepo = new MemberRepository(db);
    const auditRepo = new AuditLogRepository(db);
    const orgService = new OrganizationService(orgRepo, memberRepo, auditRepo);

    const member = await orgService.inviteMember(
      organizationId,
      matched.id,
      role as MemberRole,
      user.id,
    );

    return NextResponse.json({ data: member });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status =
      message.toLowerCase().includes('cannot') ||
      message.toLowerCase().includes('not found') ||
      message.toLowerCase().includes('already')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
