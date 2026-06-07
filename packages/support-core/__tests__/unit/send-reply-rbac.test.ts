/**
 * End-to-end wiring test for the HIGH-1 RBAC enforcement.
 *
 * This test imports the actual `send-reply` entrypoint handler and
 * invokes it with a fake Request. It mocks the two I/O surfaces
 * (JWT verify + database) and asserts that a viewer (the QA-flagged
 * "any authenticated user" case) receives a 403 instead of having
 * the outbound message sent.
 *
 * Background (HIGH-1, docs/QA_BUG_HUNT.md): before this change, the
 * rbac module was 100% property-tested but 0% enforced. A viewer
 * with a valid JWT could call `send-reply` with another tenant's
 * conversationId and trigger real outbound SMS/email. The unit
 * tests for `requirePermission` and `endpoint-permissions` cover
 * the helper and the map; this test pins the WIRING — that the
 * `send-reply` entrypoint actually calls the helper with the
 * permission the map says it should.
 *
 * The other six endpoints (approve-ai-draft, regenerate-ai-draft,
 * escalate/resolve/reopen-conversation, test-channel-connection)
 * share the exact same wiring pattern. They are not tested
 * individually here because the helper is the unit of enforcement
 * and each entrypoint's only variation is the value passed to
 * `getRequiredPermission(...)` — which the `endpoint-permissions`
 * unit test pins exhaustively.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the JWT verifier so we don't need a real InsForge auth endpoint.
const verifyJwtMock = vi.fn();
vi.mock('../../../../insforge/functions/_shared/verify-jwt.js', () => ({
  verifyJwt: (...args: unknown[]) => verifyJwtMock(...args),
}));

// Build a fake DatabaseClient that returns pre-programmed rows for
// the queries the entrypoint makes. The order is:
//   1) conversations.findById
//   2) organization_members.findByOrgAndUser
// Any further calls return benign defaults so the test does not
// throw on incidental queries from OutboundMessageService etc.
const dbCallLog: Array<{ table: string; eqFilters: Array<[string, unknown]> }> = [];

interface FakeRow {
  [key: string]: unknown;
}

const queuedRows: FakeRow[] = [];

function enqueueResponse(row: FakeRow) {
  queuedRows.push(row);
}

function takeNextResponse(): FakeRow {
  const r = queuedRows.shift();
  if (r === undefined) {
    return {}; // benign default — OutboundMessageService may query more
  }
  return r;
}

const fakeDb: any = {
  from: vi.fn().mockImplementation((table: string) => {
    const eqFilters: Array<[string, unknown]> = [];
    const builder: any = {
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
      then: (resolve: (v: unknown) => void) => {
        dbCallLog.push({ table, eqFilters: [...eqFilters] });
        const data = takeNextResponse();
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return builder;
  }),
  rpc: vi.fn(),
};

vi.mock('../../../../insforge/functions/_shared/create-db-client.js', () => ({
  createDbClient: () => fakeDb,
}));

// Stub the realtime publisher so it does not actually try to fetch.
vi.mock('../../../../insforge/functions/_shared/create-realtime-publisher.js', () => ({
  createRealtimePublisher: () => ({
    publish: vi.fn().mockResolvedValue(undefined),
  }),
}));

const SAMPLE_CONVERSATION: FakeRow = {
  id: 'conv-1',
  organization_id: 'org-victim',
  contact_id: 'c-1',
  channel: 'sms',
  status: 'open',
  ai_state: 'idle',
  subject: null,
  assigned_to: null,
  last_message_at: '2026-06-01T10:00:00.000Z',
  metadata: {},
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T10:00:00.000Z',
};

function enqueueViewerConversation(): void {
  // The entrypoint issues these queries in order:
  //   1) requireOrgMembership.conversationRepo.findById
  //   2) requireOrgMembership.memberRepo.findByOrgAndUser
  //   3) requirePermission.memberRepo.findByOrgAndUser
  // All three must return the right row. Queueing them explicitly
  // keeps the test deterministic even if the helper changes its
  // query order.
  enqueueResponse(SAMPLE_CONVERSATION);
  enqueueResponse({
    id: 'mem-1',
    organization_id: 'org-victim',
    user_id: 'user-viewer',
    role: 'viewer',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  });
  enqueueResponse({
    id: 'mem-1',
    organization_id: 'org-victim',
    user_id: 'user-viewer',
    role: 'viewer',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  });
  // (any further calls return benign empty defaults via takeNextResponse)
}

describe('send-reply endpoint (HIGH-1 wiring test)', () => {
  beforeEach(() => {
    verifyJwtMock.mockReset();
    dbCallLog.length = 0;
    queuedRows.length = 0;
    process.env.NEXT_PUBLIC_INSFORGE_URL = 'https://test.local';
    process.env.INSFORGE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('returns 403 Forbidden when a viewer calls send-reply on a conversation in their org', async () => {
    // The QA report's core scenario: any authenticated user can
    // call any JWT-protected endpoint. The viewer IS a member of
    // the org (org-membership check passes) but the entrypoint
    // must still refuse because the role does not include
    // reply_conversations.
    verifyJwtMock.mockResolvedValue({ userId: 'user-viewer' });
    enqueueViewerConversation();

    const { default: handler } = await import(
      '../../../../insforge/functions/send-reply/index.ts'
    );

    const req = new Request('https://test.local/functions/v1/send-reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-jwt',
      },
      body: JSON.stringify({ conversationId: 'conv-1', body: 'test reply' }),
    });

    const res = await handler(req);
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error?: string; reason?: string };
    expect(body.error).toMatch(/Forbidden/);
    // The reason should name the role and the missing permission
    // so an operator reading the log sees why.
    expect(body.reason).toMatch(/viewer/);
    expect(body.reason).toMatch(/reply_conversations/);
  });

  it('returns 401 Unauthorized before any permission check when the JWT is invalid', async () => {
    // The permission gate must be AFTER the auth gate. If a future
    // refactor moves the check before verifyJwt, an unauthenticated
    // caller could trigger a DB lookup (timing oracle) just by
    // knowing a conversationId.
    verifyJwtMock.mockResolvedValue(null);

    const { default: handler } = await import(
      '../../../../insforge/functions/send-reply/index.ts'
    );

    const req = new Request('https://test.local/functions/v1/send-reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bad-jwt',
      },
      body: JSON.stringify({ conversationId: 'conv-1', body: 'test reply' }),
    });

    const res = await handler(req);
    expect(res.status).toBe(401);
    // No DB calls should have been made — verifyJwt short-circuited.
    expect(dbCallLog).toHaveLength(0);
  });
});
