/**
 * Unit tests for the requireOrgMembership cross-tenant authorization helper.
 *
 * Background (CRITICAL-2, docs/QA_BUG_HUNT.md): the JWT-protected function
 * entrypoints used to (1) verify the JWT, (2) load the conversation by id
 * from the request body, and (3) mutate it through a service-role-key
 * DatabaseClient. There was no check that the caller belonged to the org
 * that owned the conversation. requireOrgMembership closes that hole.
 *
 * These tests verify the helper's contract: it returns the right
 * discriminated result, it does the right DB lookups, and crucially it
 * NEVER returns 'ok' for a non-member even if the conversation exists.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DatabaseClient, QueryBuilder, QueryResult } from '../../src/interfaces/database-client.js';

/**
 * Build a DatabaseClient mock that records every (table, eq) pair and
 * returns a pre-programmed result for each call. Calls are matched
 * in order against `responses`; the helper under test issues exactly
 * two calls in a known order (conversations first, then
 * organization_members), so the test wiring is deterministic.
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
        // Resolve the await on this builder and record the call site.
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

const SAMPLE_CONVERSATION_ROW = {
  id: 'conv-1',
  organization_id: 'org-victim',
  contact_id: 'c-1',
  channel: 'sms' as const,
  status: 'open' as const,
  ai_state: 'idle' as const,
  subject: null,
  assigned_to: null,
  last_message_at: '2026-06-01T10:00:00.000Z',
  metadata: {},
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T10:00:00.000Z',
};

const SAMPLE_MEMBER_ROW = {
  id: 'mem-1',
  organization_id: 'org-victim',
  user_id: 'user-attacker',
  role: 'agent' as const,
  created_at: '2026-06-01T08:00:00.000Z',
  updated_at: '2026-06-01T08:00:00.000Z',
};

describe('requireOrgMembership (CRITICAL-2 cross-tenant guard)', () => {
  it("returns 'ok' with the conversation's orgId when the user is a member", async () => {
    const { db, calls } = createSequencedDb([
      // 1) findById(conversationId) → conversation row
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      // 2) findByOrgAndUser(orgId, userId) → member row
      { data: SAMPLE_MEMBER_ROW, error: null },
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    const result = await requireOrgMembership(db, 'user-attacker', 'conv-1');

    expect(result).toEqual({ kind: 'ok', organizationId: 'org-victim' });

    // Verify the lookups happened in the right order against the right tables.
    expect(calls).toHaveLength(2);
    expect(calls[0].table).toBe('conversations');
    expect(calls[0].eqFilters).toContainEqual(['id', 'conv-1']);
    expect(calls[1].table).toBe('organization_members');
    expect(calls[1].eqFilters).toContainEqual(['organization_id', 'org-victim']);
    expect(calls[1].eqFilters).toContainEqual(['user_id', 'user-attacker']);
  });

  it("returns 'forbidden' when the conversation exists but the user is NOT a member", async () => {
    // This is the cross-tenant attack: attacker knows a victim conversationId
    // and tries to mutate it. The conversation lookup succeeds (it's a real
    // row), but the membership lookup returns null.
    const { db, calls } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null }, // conversation found
      { data: null, error: null }, // not a member
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    const result = await requireOrgMembership(db, 'user-attacker', 'conv-1');

    expect(result).toEqual({ kind: 'forbidden' });

    // Both lookups should have happened — the helper must not short-circuit
    // just because the conversation exists; it must always check membership.
    expect(calls).toHaveLength(2);
    expect(calls[1].table).toBe('organization_members');
  });

  it("returns 'conversation_not_found' when no conversation matches the id", async () => {
    const { db, calls } = createSequencedDb([
      { data: null, error: null }, // conversation not found
      // The helper should not reach the second lookup at all. We still
      // queue a response in case of a bug — it just must not be consumed.
      { data: SAMPLE_MEMBER_ROW, error: null },
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    const result = await requireOrgMembership(db, 'user-attacker', 'conv-doesnt-exist');

    expect(result).toEqual({ kind: 'conversation_not_found' });

    // Only one DB call should have been made — no point checking membership
    // for a conversation that doesn't exist.
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('conversations');
  });

  it("returns 'conversation_not_found' for a 406/PGRST116-shaped null result", async () => {
    // maybeSingle returns data: null on 406 (no rows). Verify we handle
    // that shape too (the function entrypoints rely on this).
    const { db } = createSequencedDb([
      { data: null, error: null },
      { data: SAMPLE_MEMBER_ROW, error: null },
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    const result = await requireOrgMembership(db, 'user-attacker', 'conv-1');
    expect(result.kind).toBe('conversation_not_found');
  });

  it('propagates infrastructure errors from the conversation lookup (does NOT swallow them as 404)', async () => {
    // A DB error is NOT a 404. The helper should throw so the call site
    // can map it to a 500 and the operator can see the real error in
    // the logs. Silently returning 'conversation_not_found' would mask
    // outages as authorization failures.
    const { db } = createSequencedDb([
      { data: null, error: { message: 'connection refused' } },
      { data: SAMPLE_MEMBER_ROW, error: null },
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    await expect(requireOrgMembership(db, 'user-attacker', 'conv-1')).rejects.toThrow(
      /connection refused/,
    );
  });

  it('propagates infrastructure errors from the membership lookup', async () => {
    const { db } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: null, error: { message: 'permission denied for table organization_members' } },
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    await expect(requireOrgMembership(db, 'user-attacker', 'conv-1')).rejects.toThrow(
      /permission denied/,
    );
  });

  it("checks membership even when the user is the 'owner' role", async () => {
    // A user can own MULTIPLE orgs. requireOrgMembership must verify the
    // membership for the SPECIFIC org of the conversation — not any
    // membership the user has. This test pins that contract.
    const { db, calls } = createSequencedDb([
      // Conversation belongs to org-victim
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      // User is an owner of org-attacker (a different org), not org-victim
      { data: null, error: null },
    ]);

    const { requireOrgMembership } = await import(
      '../../../../insforge/functions/_shared/require-org-membership.js'
    );
    const result = await requireOrgMembership(db, 'user-attacker', 'conv-1');

    expect(result).toEqual({ kind: 'forbidden' });
    // The membership lookup MUST have used org-victim, not org-attacker.
    expect(calls[1].eqFilters).toContainEqual(['organization_id', 'org-victim']);
  });
});
