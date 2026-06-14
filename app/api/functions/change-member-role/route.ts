/**
 * POST /api/functions/change-member-role
 *
 * Body: { organizationId: string, memberId: string, newRole: MemberRole }
 * Required permission: 'manage_members'
 *
 * Delegates to OrganizationService.changeMemberRole, which:
 *  - enforces the single-owner invariant
 *  - records a 'member_role_changed' audit log entry
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { insforgeAdmin } from '@/lib/insforge-admin';
import { createInsforgeDbAdapter } from '../_insforge-db-adapter';
import { OrganizationService } from '@support-core/services/organization-service';
import { OrganizationRepository } from '@support-core/repositories/organization-repository';
import { MemberRepository } from '@support-core/repositories/member-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import type { MemberRole } from '@support-core/types';

const VALID_ROLES: ReadonlyArray<MemberRole> = ['owner', 'admin', 'agent', 'viewer'];

/**
 * Return true if the given memberId currently holds the owner role in the
 * organization. Used by the route to gate ownership-transfer attempts behind
 * an owner-only check (see P1 note in the handler).
 */
async function targetIsOwner(organizationId: string, memberId: string): Promise<boolean> {
  const { data } = await insforgeAdmin.database
    .from('organization_members')
    .select('role')
    .eq('id', memberId)
    .eq('organization_id', organizationId)
    .limit(1);
  const row = Array.isArray(data) ? data[0] : data;
  return !!row && (row as { role?: string }).role === 'owner';
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { organizationId, memberId, newRole } = (await req.json()) as {
      organizationId?: unknown;
      memberId?: unknown;
      newRole?: unknown;
    };

    if (
      typeof organizationId !== 'string' ||
      typeof memberId !== 'string' ||
      typeof newRole !== 'string'
    ) {
      return NextResponse.json(
        { error: 'organizationId, memberId and newRole are required' },
        { status: 400 },
      );
    }

    if (!VALID_ROLES.includes(newRole as MemberRole)) {
      return NextResponse.json(
        { error: `newRole must be one of: ${VALID_ROLES.join(', ')}` },
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

    // P1: ownership transfer is owner-only. `manage_members` is granted to
    // admins, but the service silently demotes the current owner when
    // `newRole === 'owner'`, which would let an admin self-promote. Also
    // gate demoting an existing owner to the same set. Both directions of
    // an ownership change require the caller to currently be an owner.
    if (newRole === 'owner' || await targetIsOwner(organizationId, memberId)) {
      const callerIsOwner = await userHasOrgPermission(
        user.id,
        organizationId,
        'delete_org', // owner-only permission per rbac.ts
      );
      if (!callerIsOwner) {
        return NextResponse.json(
          { error: 'Only the current owner can promote members to owner or change an owner\'s role' },
          { status: 403 },
        );
      }
    }

    const db = createInsforgeDbAdapter();
    const orgRepo = new OrganizationRepository(db);
    const memberRepo = new MemberRepository(db);
    const auditRepo = new AuditLogRepository(db);
    const orgService = new OrganizationService(orgRepo, memberRepo, auditRepo);

    const updated = await orgService.changeMemberRole(
      organizationId,
      memberId,
      newRole as MemberRole,
      user.id,
    );

    return NextResponse.json({ data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    // Surface known business-rule errors as 4xx, the rest as 500.
    const status = message.toLowerCase().includes('cannot')
      || message.toLowerCase().includes('not found')
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
