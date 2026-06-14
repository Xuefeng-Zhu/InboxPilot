/**
 * POST /api/functions/remove-member
 *
 * Body: { organizationId: string, memberId: string }
 * Required permission: 'manage_members'
 *
 * P1: removing an owner is owner-only (admins can demote/remove admins and
 * agents/viewers, but cannot remove the owner — that would amount to an
 * ownership transfer via removal). The gate below enforces that.
 *
 * Delegates to OrganizationService.removeMember, which:
 *  - prevents removing the last owner
 *  - records a 'member_removed' audit log entry (with the caller as actor)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { insforgeAdmin } from '@/lib/insforge-admin';
import { createInsforgeDbAdapter } from '../_insforge-db-adapter';
import { OrganizationService } from '@support-core/services/organization-service';
import { OrganizationRepository } from '@support-core/repositories/organization-repository';
import { MemberRepository } from '@support-core/repositories/member-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';

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

    const { organizationId, memberId } = (await req.json()) as {
      organizationId?: unknown;
      memberId?: unknown;
    };

    if (typeof organizationId !== 'string' || typeof memberId !== 'string') {
      return NextResponse.json(
        { error: 'organizationId and memberId are required' },
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

    // P1: owner removal is owner-only.
    if (await targetIsOwner(organizationId, memberId)) {
      const callerIsOwner = await userHasOrgPermission(
        user.id,
        organizationId,
        'delete_org', // owner-only permission per rbac.ts
      );
      if (!callerIsOwner) {
        return NextResponse.json(
          { error: 'Only the current owner can remove the owner' },
          { status: 403 },
        );
      }
    }

    const db = createInsforgeDbAdapter();
    const orgRepo = new OrganizationRepository(db);
    const memberRepo = new MemberRepository(db);
    const auditRepo = new AuditLogRepository(db);
    const orgService = new OrganizationService(orgRepo, memberRepo, auditRepo);

    await orgService.removeMember(organizationId, memberId, user.id);

    return NextResponse.json({ data: { removed: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.toLowerCase().includes('cannot')
      || message.toLowerCase().includes('not found')
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
