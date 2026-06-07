/**
 * Unit tests for the requirePermission application-layer RBAC guard.
 *
 * Background (HIGH-1, docs/QA_BUG_HUNT.md): the `rbac` module
 * (`hasPermission` / `checkPermission`) was 100% unit-tested but was
 * NEVER imported by any function entrypoint. The net effect was that
 * any authenticated user had the full permission set.
 *
 * `requirePermission` closes that hole by composing the CRITICAL-2
 * cross-tenant membership check (the conversation's org) with the
 * HIGH-1 role check (the caller's role must grant the required
 * permission). These tests verify the helper's contract end to end.
 *
 * The mock helpers are factored out of `require-org-membership.test.ts`
 * so that future regressions in either guard are caught with a clear
 * "which guard failed" message.
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

function memberRow(role: 'owner' | 'admin' | 'agent' | 'viewer') {
  return {
    id: 'mem-1',
    organization_id: 'org-victim',
    user_id: 'user-caller',
    role,
    created_at: '2026-06-01T08:00:00.000Z',
    updated_at: '2026-06-01T08:00:00.000Z',
  };
}

describe('requirePermission (HIGH-1 application-layer RBAC guard)', () => {
  it("returns 'ok' with the conversation's orgId and the caller's role when the role grants the permission (agent → reply_conversations)", async () => {
    const { db, calls } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: memberRow('agent'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-1',
      'reply_conversations',
    );

    expect(result).toEqual({
      kind: 'ok',
      organizationId: 'org-victim',
      role: 'agent',
    });
    // Sanity check: both lookups happened.
    expect(calls).toHaveLength(2);
    expect(calls[0].table).toBe('conversations');
    expect(calls[1].table).toBe('organization_members');
  });

  it("returns 'ok' for an owner regardless of the permission (owner has everything)", async () => {
    const { db } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: memberRow('owner'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-1',
      'delete_org', // the strictest permission; only owner has it
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.role).toBe('owner');
    }
  });

  it("returns 'insufficient_permissions' when the role lacks the permission (viewer → reply_conversations)", async () => {
    // This is the canonical HIGH-1 regression: a viewer trying to
    // reply. The membership lookup succeeds (they are a member), but
    // hasPermission(viewer, 'reply_conversations') is false.
    const { db } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: memberRow('viewer'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-1',
      'reply_conversations',
    );

    expect(result).toEqual({
      kind: 'insufficient_permissions',
      role: 'viewer',
      permission: 'reply_conversations',
    });
  });

  it("returns 'insufficient_permissions' for an agent trying to approve an AI draft (no manage_settings)", async () => {
    const { db } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: memberRow('agent'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-1',
      'manage_settings',
    );

    expect(result).toEqual({
      kind: 'insufficient_permissions',
      role: 'agent',
      permission: 'manage_settings',
    });
  });

  it("returns 'ok' for an agent trying to escalate (agent has manage_conversations)", async () => {
    // Agents can escalate, resolve, and reopen — they're the
    // day-to-day operators. This test pins the contract so a future
    // refactor that drops manage_conversations from the agent role
    // is caught immediately.
    const { db } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: memberRow('agent'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-1',
      'manage_conversations',
    );

    expect(result).toEqual({
      kind: 'ok',
      organizationId: 'org-victim',
      role: 'agent',
    });
  });

  it("returns 'forbidden' when the conversation exists but the user is not a member", async () => {
    // The CRITICAL-2 cross-enant shape. The conversation lookup
    // succeeds, but the membership lookup returns null. This is the
    // "wrong tenant" attack: a user from another org tries to act on
    // a conversation they don't own.
    const { db, calls } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: null, error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-attacker',
      'conv-1',
      'reply_conversations',
    );

    expect(result).toEqual({ kind: 'forbidden' });
    // Both lookups should have happened — the helper must not
    // short-circuit just because the conversation exists.
    expect(calls).toHaveLength(2);
  });

  it("returns 'conversation_not_found' when no conversation matches the id", async () => {
    const { db, calls } = createSequencedDb([
      { data: null, error: null }, // conversation not found
      { data: memberRow('owner'), error: null }, // unused
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-doesnt-exist',
      'reply_conversations',
    );

    expect(result).toEqual({ kind: 'conversation_not_found' });
    // Only one DB call should have been made — no point checking
    // membership for a conversation that doesn't exist.
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('conversations');
  });

  it('propagates infrastructure errors from the conversation lookup', async () => {
    const { db } = createSequencedDb([
      { data: null, error: { message: 'connection refused' } },
      { data: memberRow('owner'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    await expect(
      requirePermission(db, 'user-caller', 'conv-1', 'reply_conversations'),
    ).rejects.toThrow(/connection refused/);
  });

  it('propagates infrastructure errors from the membership lookup', async () => {
    const { db } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      {
        data: null,
        error: { message: 'permission denied for table organization_members' },
      },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    await expect(
      requirePermission(db, 'user-caller', 'conv-1', 'reply_conversations'),
    ).rejects.toThrow(/permission denied/);
  });

  it('checks membership even when the user is the owner role of a different org', async () => {
    // A user can own MULTIPLE orgs. requirePermission must verify the
    // membership for the SPECIFIC org of the conversation — not any
    // membership the user has. This test pins that contract.
    const { db, calls } = createSequencedDb([
      // Conversation belongs to org-victim
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      // User is an owner of org-attacker (a different org), not
      // org-victim. The membership lookup MUST use org-victim.
      { data: null, error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-attacker',
      'conv-1',
      'reply_conversations',
    );

    expect(result).toEqual({ kind: 'forbidden' });
    // The membership lookup MUST have used org-victim, not org-attacker.
    expect(calls[1].eqFilters).toContainEqual(['organization_id', 'org-victim']);
  });

  it("checks the permission AFTER the role is loaded (not before)", async () => {
    // Verifies the order of operations: conversation first, then
    // membership, then hasPermission. A bug that flipped the order
    // (e.g. calling hasPermission before the role is loaded) would
    // always throw.
    const { db, calls } = createSequencedDb([
      { data: SAMPLE_CONVERSATION_ROW, error: null },
      { data: memberRow('agent'), error: null },
    ]);

    const { requirePermission } = await import(
      '../../../../insforge/functions/_shared/require-permission.js'
    );
    const result = await requirePermission(
      db,
      'user-caller',
      'conv-1',
      'manage_conversations', // agent has this
    );

    expect(result.kind).toBe('ok');
    // The two lookups happened in the right order.
    expect(calls.map((c) => c.table)).toEqual([
      'conversations',
      'organization_members',
    ]);
  });
});
