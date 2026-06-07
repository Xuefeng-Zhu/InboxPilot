/**
 * Unit tests for the requirePermission RBAC enforcement helper.
 *
 * Background (HIGH-1, docs/QA_BUG_HUNT.md): the rbac module existed
 * and was property-tested, but the `hasPermission` / `checkPermission`
 * functions were never called from any entrypoint, service, or page.
 * A viewer with a valid JWT could invoke any JWT-protected endpoint.
 *
 * These tests verify the requirePermission helper itself: it looks up
 * the caller's role in the org, delegates to the in-memory
 * checkPermission, and returns the right discriminated result. The
 * end-to-end "viewer cannot call approve-ai-draft" coverage is at
 * the entrypoint level (see the docstring of endpoint-permissions.ts
 * for the per-endpoint map and a smoke test plan for the entrypoint
 * call sites).
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  DatabaseClient,
  QueryBuilder,
  QueryResult,
} from '../../src/interfaces/database-client.js';

/**
 * Build a DatabaseClient mock that records every (table, eq) pair and
 * returns a pre-programmed result for each call. Calls are matched in
 * order against `responses`; the helper under test issues exactly one
 * lookup (against `organization_members`), so the wiring is trivial.
 */
function createSequencedDb(responses: QueryResult[]): {
  db: DatabaseClient;
  calls: Array<{ table: string; eqFilters: Array<[string, unknown]> }>;
} {
  const calls: Array<{ table: string; eqFilters: Array<[string, unknown]> }> = [];
  let idx = 0;

  function makeBuilder(table: string): QueryBuilder {
    const eqFilters: Array<[string, unknown]> = [];
    const builder: QueryBuilder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((col: string, val: unknown) => {
        eqFilters.push([col, val]);
        return builder;
      }),
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
      maybeSingle: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve) => {
        const result = responses[idx++];
        calls.push({ table, eqFilters: [...eqFilters] });
        return Promise.resolve(resolve?.(result));
      }),
    };
    return builder;
  }

  const db: DatabaseClient = {
    from: vi.fn().mockImplementation((table: string) => makeBuilder(table)),
    rpc: vi.fn(),
  };

  return { db, calls };
}

const SAMPLE_MEMBER_ROW = {
  id: 'mem-1',
  organization_id: 'org-1',
  user_id: 'user-1',
  role: 'agent' as const,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
};

describe('requirePermission (HIGH-1 RBAC enforcement helper)', () => {
  it("returns 'ok' when the caller's role grants the required permission", async () => {
    // An agent has reply_conversations → requirePermission should allow
    // the action and return 'ok'.
    const { db, calls } = createSequencedDb([{ data: SAMPLE_MEMBER_ROW, error: null }]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(db, 'user-1', 'org-1', 'reply_conversations');

    expect(result).toEqual({ kind: 'ok' });

    // Verify the helper looked up the right table with both filters.
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('organization_members');
    expect(calls[0].eqFilters).toContainEqual(['organization_id', 'org-1']);
    expect(calls[0].eqFilters).toContainEqual(['user_id', 'user-1']);
  });

  it("returns 'forbidden' when the caller's role lacks the required permission", async () => {
    // An agent does NOT have manage_settings → requirePermission should
    // refuse. This is the core of HIGH-1: before this helper, no
    // entrypoint ever asked the question, so the agent was allowed.
    const { db } = createSequencedDb([{ data: SAMPLE_MEMBER_ROW, error: null }]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(db, 'user-1', 'org-1', 'manage_settings');

    expect(result.kind).toBe('forbidden');
    if (result.kind === 'forbidden') {
      // The reason message should mention the role and the missing
      // permission so the operator can audit who was denied and why.
      expect(result.reason).toMatch(/agent/);
      expect(result.reason).toMatch(/manage_settings/);
    }
  });

  it("returns 'forbidden' for a viewer calling any mutating endpoint", async () => {
    // Viewers have only view_conversations + view_knowledge. Every other
    // permission must be denied. This is the table-test for the bug
    // the QA report flagged: previously, ALL permissions were granted
    // because the rbac module was dead code.
    const viewerRow = { ...SAMPLE_MEMBER_ROW, role: 'viewer' as const };

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );

    // Every mutating permission must be denied. Each iteration uses a
    // fresh mock DB so the helper's single membership lookup always
    // gets a fresh, well-typed response.
    const deniedPerms = [
      'reply_conversations',
      'manage_conversations',
      'manage_settings',
      'manage_knowledge',
      'manage_org',
      'manage_members',
      'delete_org',
    ] as const;
    for (const perm of deniedPerms) {
      const { db } = createSequencedDb([{ data: viewerRow, error: null }]);
      const result = await requirePermission(db, 'user-1', 'org-1', perm);
      expect(result.kind).toBe('forbidden');
    }
  });

  it("returns 'ok' for a viewer calling a view-only permission (sanity)", async () => {
    // The denied list above would be useless if it also returned
    // forbidden for view_* permissions — make sure the helper still
    // allows the legitimate view-only operations.
    const viewerRow = { ...SAMPLE_MEMBER_ROW, role: 'viewer' as const };

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );

    for (const perm of ['view_conversations', 'view_knowledge'] as const) {
      const { db } = createSequencedDb([{ data: viewerRow, error: null }]);
      const result = await requirePermission(db, 'user-1', 'org-1', perm);
      expect(result.kind).toBe('ok');
    }
  });

  it("returns 'ok' for an owner on every permission (no permission is owner-only)", async () => {
    // Sanity check: owners have the full permission set. This guards
    // against a future regression where the new 'manage_conversations'
    // perm is added to a role's list but not to the owner list.
    const ownerRow = { ...SAMPLE_MEMBER_ROW, role: 'owner' as const };

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );

    // Sample a representative subset; the rbac.prop.test.ts already
    // exhaustively covers this at the matrix level.
    for (const perm of [
      'manage_settings',
      'manage_conversations',
      'reply_conversations',
      'delete_org',
    ] as const) {
      const { db } = createSequencedDb([{ data: ownerRow, error: null }]);
      const result = await requirePermission(db, 'user-1', 'org-1', perm);
      expect(result.kind).toBe('ok');
    }
  });

  it("returns 'forbidden' for an admin on 'delete_org'", async () => {
    // The 'admin has all except delete_org' invariant from the role
    // matrix must be preserved. Previously the rbac module was the
    // only place this lived, and nothing used it.
    const adminRow = { ...SAMPLE_MEMBER_ROW, role: 'admin' as const };
    const { db } = createSequencedDb([{ data: adminRow, error: null }]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(db, 'user-1', 'org-1', 'delete_org');
    expect(result.kind).toBe('forbidden');
  });

  it("returns 'role_not_found' when the membership row vanished between checks", async () => {
    // Defensive case: requireOrgMembership returned 'ok' a moment ago,
    // but by the time requirePermission runs the row is gone. Should
    // be unreachable in practice (the orgId came from the row that
    // just disappeared), but the helper must handle it without
    // throwing. The 500 mapping in the call site is the operator's
    // signal that something is wrong.
    const { db } = createSequencedDb([{ data: null, error: null }]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(db, 'user-1', 'org-1', 'reply_conversations');
    expect(result).toEqual({ kind: 'role_not_found' });
  });

  it('propagates infrastructure errors from the membership lookup (does NOT swallow them as forbidden)', async () => {
    // A DB outage is NOT a permission denial. The helper must throw so
    // the call site can map it to a 500, mirroring requireOrgMembership.
    const { db } = createSequencedDb([
      { data: null, error: { message: 'connection refused' } },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    await expect(requirePermission(db, 'user-1', 'org-1', 'reply_conversations')).rejects.toThrow(
      /connection refused/,
    );
  });

  it("uses the caller-supplied orgId (NOT the caller's first org membership)", async () => {
    // A user might belong to multiple orgs. The helper must use the
    // orgId passed in, not derive one from a separate lookup. This is
    // the test that pins the contract: orgId is a TRUSTED INPUT
    // because requireOrgMembership produced it.
    const memberInOtherOrg = {
      ...SAMPLE_MEMBER_ROW,
      organization_id: 'org-OTHER',
      role: 'admin' as const,
    };
    const { db, calls } = createSequencedDb([{ data: memberInOtherOrg, error: null }]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    // The membership lookup MUST be against org-X (passed in), not
    // org-OTHER. If the helper queried for "any of the user's orgs"
    // it would return 'ok' here even though the user has no
    // membership in org-X.
    const result = await requirePermission(db, 'user-1', 'org-X', 'reply_conversations');
    expect(calls[0].eqFilters).toContainEqual(['organization_id', 'org-X']);
    // The actual role found is admin (from org-OTHER), but that
    // doesn't matter — the helper still says 'ok' because the row
    // was returned for the right filters. The important thing is
    // the FILTER is correct.
    expect(['ok', 'forbidden']).toContain(result.kind);
  });
});
