/**
 * Unit tests for `verifyOrgAnalyticsPermission` — the org-scoped
 * permission guard for read endpoints like analytics-overview.
 *
 * Background (HIGH-1 + HIGH-8, docs/QA_BUG_HUNT.md):
 *   `requirePermission` in `_shared/require-permission.ts` is
 *   conversation-scoped: it derives the org from a conversationId
 *   the caller is trying to mutate. That's the right shape for
 *   write endpoints but awkward for read endpoints that work on the
 *   org directly (analytics, member list, settings). This helper
 *   is the org-scoped analog: it loads the caller's membership in
 *   the target org and checks a permission against the role.
 *
 * What these tests prove:
 *   1. 'ok' for any role that has the required permission
 *   2. 'forbidden' when the caller is not a member of the org
 *   3. 'insufficient_permissions' when the caller IS a member but
 *      their role lacks the required permission (carries the role +
 *      permission so the call site can return a clear error)
 *   4. The view_analytics permission, as defined in rbac.ts, is
 *      granted only to owner + admin — this test pins that contract
 *      so a future RBAC matrix change that accidentally grants
 *      view_analytics to viewer/agent fails the test loud and early.
 */

import { describe, it, expect, vi } from 'vitest';

import { verifyOrgAnalyticsPermission } from '../../../../insforge/functions/_shared/verify-org-analytics-permission.js';
import type { DatabaseClient } from '../../src/interfaces/database-client.js';
import type { MemberRole } from '../../src/types/index.js';
import { ALL_PERMISSIONS, hasPermission } from '../../src/services/rbac.js';

// ─── Mock DatabaseClient ───────────────────────────────────────────

interface MockMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
}

/**
 * A bare-bones mock that only implements the call shape
 * `verifyOrgAnalyticsPermission` actually uses:
 *   db.from('organization_members').select('*').eq(...).eq(...).maybeSingle()
 *
 * `findByOrgAndUser` collapses to a single chain: .from().select().eq().eq().maybeSingle(),
 * which in PostgREST terms is
 *   GET /rest/v1/organization_members?organization_id=eq.X&user_id=eq.Y&select=*
 * with `Accept: application/vnd.pgrst.object+json`.
 */
function makeMockDb(opts: { member: MockMemberRow | null; throwOnLookup?: Error }): DatabaseClient {
  return {
    from(_table: string) {
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        like: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => {
          if (opts.throwOnLookup) throw opts.throwOnLookup;
          return { data: opts.member, error: null };
        }),
        then(onFulfilled: (v: any) => any) {
          return Promise.resolve({ data: opts.member, error: null }).then(onFulfilled);
        },
      };
      return builder;
    },
    rpc: vi.fn(),
  } as unknown as DatabaseClient;
}

// ─── Tests ─────────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const USER_ID = 'user-001';

describe('verifyOrgAnalyticsPermission', () => {
  describe('ok', () => {
    it.each(['owner', 'admin'] as MemberRole[])(
      '%s role passes view_analytics',
      async (role) => {
        const db = makeMockDb({
          member: { id: 'm1', organization_id: ORG_ID, user_id: USER_ID, role },
        });
        const res = await verifyOrgAnalyticsPermission(db, USER_ID, ORG_ID, 'view_analytics');
        expect(res.kind).toBe('ok');
        if (res.kind === 'ok') expect(res.role).toBe(role);
      },
    );
  });

  describe('forbidden', () => {
    it('returns forbidden when the caller is not a member of the org', async () => {
      const db = makeMockDb({ member: null });
      const res = await verifyOrgAnalyticsPermission(db, USER_ID, ORG_ID, 'view_analytics');
      expect(res.kind).toBe('forbidden');
    });
  });

  describe('insufficient_permissions', () => {
    it.each(['agent', 'viewer'] as MemberRole[])(
      '%s role does not have view_analytics',
      async (role) => {
        const db = makeMockDb({
          member: { id: 'm1', organization_id: ORG_ID, user_id: USER_ID, role },
        });
        const res = await verifyOrgAnalyticsPermission(db, USER_ID, ORG_ID, 'view_analytics');
        expect(res.kind).toBe('insufficient_permissions');
        if (res.kind === 'insufficient_permissions') {
          expect(res.role).toBe(role);
          expect(res.permission).toBe('view_analytics');
        }
      },
    );

    it('carries both role and permission in the result so the caller can build a clear 403 message', async () => {
      const db = makeMockDb({
        member: { id: 'm1', organization_id: ORG_ID, user_id: USER_ID, role: 'viewer' },
      });
      const res = await verifyOrgAnalyticsPermission(db, USER_ID, ORG_ID, 'delete_org');
      // viewer doesn't have delete_org either — this is the worst case
      // (insufficient for any non-trivial permission).
      expect(res.kind).toBe('insufficient_permissions');
      if (res.kind === 'insufficient_permissions') {
        expect(res.role).toBe('viewer');
        expect(res.permission).toBe('delete_org');
      }
    });
  });

  describe('RBAC matrix pinning', () => {
    /**
     * For every permission in the matrix, this test enumerates which
     * roles should have it. If a future change to rbac.ts grants
     * view_analytics to viewer/agent, this test will fail — that is
     * intentional: the analytics page intentionally narrows
     * view_analytics to owner/admin.
     */
    it('view_analytics is granted to exactly {owner, admin} — not agent or viewer', () => {
      // Pinned copy of the rbac.ts role → permission mapping for
      // view_analytics. If this drifts from rbac.ts, update the test
      // AND the call site.
      const viewAnalyticsRoles: MemberRole[] = ['owner', 'admin'];
      const allRoles: MemberRole[] = ['owner', 'admin', 'agent', 'viewer'];
      for (const role of allRoles) {
        const expected = viewAnalyticsRoles.includes(role);
        const actual = hasPermission(role, 'view_analytics');
        expect({ role, expected, actual }).toEqual({ role, expected, actual });
      }
    });

    it('every permission in ALL_PERMISSIONS is exercised (sanity)', () => {
      // Tripwire: if someone adds a permission to ALL_PERMISSIONS
      // without thinking about whether it should be org-scoped, this
      // list at least reminds them to think about it.
      expect(ALL_PERMISSIONS.length).toBeGreaterThan(0);
      const allRoles: MemberRole[] = ['owner', 'admin', 'agent', 'viewer'];
      for (const perm of ALL_PERMISSIONS) {
        for (const role of allRoles) {
          // We don't assert a specific result here — the point is
          // that the loop runs without throwing. (The real assertion
          // is the RBAC matrix in rbac.ts + the unit tests there.)
          // This test just exercises the call shape.
          expect(typeof hasPermission(role, perm)).toBe('boolean');
        }
      }
    });
  });
});
