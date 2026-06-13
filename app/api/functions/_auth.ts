import { NextRequest } from 'next/server';
import { hasPermission, type Permission } from '@support-core/services/rbac';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';

/**
 * Verify the access token (cookie or header) with InsForge auth.
 * Do not trust a locally decoded JWT payload here: these route handlers use the
 * service role client, so they must reject forged, expired, or revoked tokens.
 */
export async function getUserFromToken(req: NextRequest): Promise<{ id: string } | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.replace('Bearer ', '')
    || req.cookies.get('insforge_access_token')?.value;
  if (!token) return null;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
    if (!baseUrl) return null;

    const res = await fetch(`${baseUrl}/api/auth/sessions/current`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return null;

    const payload = (await res.json()) as Record<string, unknown>;
    const user = (payload.user && typeof payload.user === 'object')
      ? payload.user as Record<string, unknown>
      : payload;
    const userId = user.id ?? user.sub;

    return typeof userId === 'string' && userId ? { id: userId } : null;
  } catch {
    return null;
  }
}

interface MembershipRow {
  id: string;
  role: 'owner' | 'admin' | 'agent' | 'viewer';
  organization_id: string;
}

export async function userHasOrgPermission(
  userId: string,
  organizationId: string | null | undefined,
  permission: Permission,
): Promise<boolean> {
  if (!organizationId) return false;

  const { data, error } = await insforge.database
    .from('organization_members')
    .select('id,role,organization_id')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const member = (Array.isArray(data) ? data[0] : data) as MembershipRow | undefined;
  return !!member && hasPermission(member.role, permission);
}
