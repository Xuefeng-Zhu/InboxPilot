/**
 * POST /api/functions/team-member-info
 *
 * Body: { organizationId: string }
 * Required permission: any org member (we check via view_conversations)
 *
 * Returns public profile information (email, name, avatar_url) for every
 * member of the given organization, so the team page can display meaningful
 * identifiers instead of raw InsForge auth user IDs.
 *
 * Implementation:
 *   1. List user_ids for the org from `organization_members`.
 *   2. Call the InsForge admin `GET /api/auth/users` endpoint with the
 *      service-role key to fetch the full user records (including email).
 *   3. Filter to the org's user_ids and return the projection.
 *
 * If the admin call fails (no service-role key, network error, the endpoint
 * isn't accessible to the service role in this environment), we fall back
 * to name-only profiles — the team page still renders, just without emails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRequestJsonObject } from '@/lib/http-json';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { insforgeAdmin } from '@/lib/insforge-admin';

interface AdminUserRow {
  id: string;
  email: string;
  emailVerified?: boolean;
  providers?: string[];
  createdAt?: string;
  updatedAt?: string;
  profile?: { name?: string; avatar_url?: string } | null;
}

export interface TeamMemberInfo {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

const ADMIN_LIST_LIMIT = 1000;

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await readRequestJsonObject(req);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const organizationId = body.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json(
        { error: 'organizationId is required' },
        { status: 400 },
      );
    }

    // The team list (and the member emails that decorate it) is already
    // visible to every org member via the RLS-protected `organization_members`
    // table — we just enrich the rows with the auth-user's email/name so the
    // panel can show something friendlier than a truncated UUID. Gate on the
    // same permission required to see the conversation list, which every
    // role (owner/admin/agent/viewer) has. Mutation routes still gate on
    // `manage_members` separately.
    const allowed = await userHasOrgPermission(
      user.id,
      organizationId,
      'view_conversations',
    );
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // 1. Get the user_ids for the org.
    const { data: memberRows, error: memberErr } = await insforgeAdmin.database
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId);
    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    const userIds = (Array.isArray(memberRows) ? memberRows : [])
      .map((r) => (r as { user_id: string }).user_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (userIds.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // 2. Fetch full user records (including email) via the admin REST
    //    endpoint with the service-role key.
    const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
    const adminKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
    if (!baseUrl || !adminKey) {
      // Without the admin credentials we can't fetch emails; fall back to
      // name-only profiles so the panel still renders.
      return NextResponse.json({
        data: userIds.map((userId) => ({
          id: userId,
          email: null,
          name: null,
          avatarUrl: null,
        })),
      });
    }

    let byId: Map<string, AdminUserRow>;
    try {
      const listRes = await fetch(
        `${baseUrl}/api/auth/users?limit=${ADMIN_LIST_LIMIT}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${adminKey}` },
          // Disable Next.js fetch caching — we want fresh user data on every call.
          cache: 'no-store',
        },
      );

      if (!listRes.ok) {
        throw new Error(`Admin user list returned ${listRes.status}`);
      }

      const listJson = (await listRes.json()) as { data?: AdminUserRow[] };
      const allUsers = Array.isArray(listJson.data) ? listJson.data : [];
      byId = new Map<string, AdminUserRow>();
      for (const u of allUsers) {
        if (u && typeof u.id === 'string') byId.set(u.id, u);
      }
    } catch {
      // Admin call failed (network, auth, or unsupported in this env).
      // Fall back to name-only profiles — the team page still works.
      return NextResponse.json({
        data: userIds.map((userId) => ({
          id: userId,
          email: null,
          name: null,
          avatarUrl: null,
        })),
      });
    }

    // 3. Project just the team members' user_ids.
    const profiles: TeamMemberInfo[] = userIds.map((userId) => {
      const u = byId.get(userId);
      if (!u) {
        return { id: userId, email: null, name: null, avatarUrl: null };
      }
      return {
        id: u.id,
        email: u.email ?? null,
        name: u.profile?.name ?? null,
        avatarUrl: u.profile?.avatar_url ?? null,
      };
    });

    return NextResponse.json({ data: profiles });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
