/**
 * analytics-overview — Returns the per-org support analytics for the
 * given date range, computed entirely in SQL.
 *
 * Closes HIGH-8 from docs/QA_BUG_HUNT.md.
 *
 * Background (HIGH-8):
 *   app/analytics/page.tsx used to issue two unbounded-then-truncated
 *   queries against the conversations and messages tables:
 *     1) .limit(10000) on conversations (gated only on start_date;
 *        end_date was filtered in JS) — silently wrong when the period
 *        contained more than 10k conversations.
 *     2) .limit(5000) on messages for the first 100 conversations —
 *        response-time was computed over a 1% sample, not the period.
 *   This function is the server-side replacement: it runs
 *   `analytics_overview(p_org, p_start, p_end)` (see
 *   insforge/migrations/005_analytics_aggregation.sql), which performs
 *   the count + group-by + LATERAL response-time walk in SQL with both
 *   date bounds enforced server-side, and returns the metrics as a
 *   single JSONB object.
 *
 * Auth:
 *   - JWT (Bearer) — verified by `verifyJwt`
 *   - `requireOrgMembership` — caller must be a member of the org
 *     whose analytics they are asking for (CRITICAL-2 guard,
 *     reproduced for the analytics surface)
 *   - `requirePermission(db, userId, orgId, 'view_analytics')` — the
 *     caller's role in that org must grant view_analytics. The
 *     existing `requirePermission` helper is conversation-scoped
 *     (it derives the org from a conversationId), so for an
 *     org-direct endpoint we hand-construct the check using the
 *     same `MemberRepository` and `hasPermission` from
 *     `support-core/src/services/rbac.ts` — see _shared/verify-org-analytics-permission.ts.
 *
 * Flow:
 *   1. Parse { organizationId, startDate, endDate } from JSON body
 *   2. Verify JWT
 *   3. Resolve caller's role in the target org and check view_analytics
 *   4. Call analytics_overview via PostgREST RPC
 *   5. Return 200 with the metrics JSON
 *
 * Why a dedicated function instead of letting the page call RPC
 * directly: PostgREST exposes `analytics_overview` over the same API
 * as the table endpoints, which means the caller's RLS context would
 * filter the conversations the RPC can see. With SECURITY INVOKER +
 * RLS that's still correct (a non-member sees zero rows), but the
 * RLS policy for `conversations` is keyed off auth.uid() → that works
 * too. The wrapper exists so we can:
 *   - Validate the input dates (caller could pass `start > end` etc.)
 *   - Translate the page's `{ start, end }` ISO date strings into the
 *     timestamptz bounds the RPC expects
 *   - Pin the view_analytics permission at the application layer
 *     (HIGH-1 — the rbac module is dead code unless an entrypoint
 *     actually calls it)
 *   - Return a stable error shape to the page (the RPC has no way to
 *     express "you are not a member")
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { verifyJwt } from '../_shared/verify-jwt.js';
import { verifyOrgAnalyticsPermission } from '../_shared/verify-org-analytics-permission.js';

import { OrganizationRepository } from '../../../packages/support-core/src/repositories/organization-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Validate that the date-range string is a real ISO date the user
 * could have typed in a `<input type="date">` field, then convert to
 * a timestamptz pair the RPC expects. We anchor the end at end-of-day
 * in UTC so a "to" date of 2026-06-07 includes all of 2026-06-07
 * 23:59:59.999 — matching the previous (buggy) JS behavior in
 * app/analytics/page.tsx:86 (which used T23:59:59.999Z).
 *
 * Returns null on any parse error; the caller maps to 400.
 */
function parseDateRange(
  startDate: string,
  endDate: string,
): { start: string; end: string } | null {
  if (typeof startDate !== 'string' || typeof endDate !== 'string') {
    return null;
  }
  // YYYY-MM-DD — the shape the date input emits
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return null;
  }
  // Reject Naive-Date inputs that don't parse to a real Date.
  const sMs = Date.parse(startDate + 'T00:00:00.000Z');
  const eMs = Date.parse(endDate + 'T23:59:59.999Z');
  if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) {
    return null;
  }
  if (sMs > eMs) {
    return null;
  }
  return { start: new Date(sMs).toISOString(), end: new Date(eMs).toISOString() };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  try {
    // 1. Parse body
    let payload: { organizationId?: string; startDate?: string; endDate?: string };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const { organizationId, startDate, endDate } = payload;
    if (!organizationId || typeof organizationId !== 'string') {
      return jsonResponse({ error: 'Missing or invalid organizationId' }, 400);
    }

    const range = parseDateRange(startDate ?? '', endDate ?? '');
    if (!range) {
      return jsonResponse(
        { error: 'Missing or invalid date range (expected YYYY-MM-DD strings, start <= end)' },
        400,
      );
    }

    // 2. Verify JWT
    const baseUrl =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
      process.env.NEXT_PUBLIC_INSFORGE_URL ??
      '';
    const serviceRoleKey =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ??
      '';

    const verifiedUser = await verifyJwt(req, baseUrl, serviceRoleKey);
    if (!verifiedUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const { userId } = verifiedUser;

    // 3. Verify the org exists + caller is a member with view_analytics
    const db = createDbClient(baseUrl, serviceRoleKey);
    const orgRepo = new OrganizationRepository(db);
    const org = await orgRepo.findById(organizationId);
    if (!org) {
      return jsonResponse({ error: 'Organization not found' }, 404);
    }

    const auth = await verifyOrgAnalyticsPermission(db, userId, organizationId, 'view_analytics');
    if (auth.kind === 'forbidden') {
      return jsonResponse(
        { error: 'Forbidden: not a member of this organization' },
        403,
      );
    }
    if (auth.kind === 'insufficient_permissions') {
      return jsonResponse(
        {
          error: 'Forbidden: insufficient permissions',
          message: `Your role "${auth.role}" does not have "${auth.permission}" permission`,
        },
        403,
      );
    }

    // 4. Call the aggregation RPC
    const { data, error } = await db.rpc('analytics_overview', {
      p_organization_id: organizationId,
      p_start: range.start,
      p_end: range.end,
    });

    if (error) {
      console.error('analytics_overview rpc error:', error);
      return jsonResponse(
        { error: 'Failed to compute analytics', details: error.message },
        500,
      );
    }

    // 5. Return the metrics. PostgREST returns the jsonb as a parsed
    // object (not a string) when the function returns jsonb.
    const metrics = (data ?? {}) as Record<string, unknown>;
    return jsonResponse({ status: 'ok', data: metrics });
  } catch (err) {
    console.error('analytics-overview error:', err);
    return jsonResponse(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
}
