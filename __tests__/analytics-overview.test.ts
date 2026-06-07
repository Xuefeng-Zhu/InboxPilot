/**
 * Entry-point regression tests for HIGH-8 fix — analytics page no
 * longer silently truncates; metrics are computed server-side in SQL
 * with both date bounds enforced.
 *
 * Background (docs/QA_BUG_HUNT.md, HIGH-8):
 *   app/analytics/page.tsx used to issue two unbounded-then-truncated
 *   queries:
 *     1) conversations .gte('created_at', startIso).limit(10000)
 *        The end-date was filtered CLIENT-SIDE (line 101) — with
 *        more than 10k conversations in the period, the totals were
 *        silently wrong.
 *     2) messages .in('conversation_id', convIds.slice(0, 100))
 *          .limit(5000)
 *        Response-time was computed over the first 100 conversations
 *        and first 5k messages, not the full period.
 *   The fix is `insforge/functions/analytics-overview/index.ts` +
 *   `insforge/migrations/005_analytics_aggregation.sql`:
 *     - The page calls a serverless function over HTTP
 *     - The function validates input, verifies JWT, checks
 *       view_analytics permission, and calls `analytics_overview`
 *     - The RPC does the count + group-by + LATERAL response-time
 *       walk in SQL with both gte AND lte bounds
 *   The page no longer touches `conversations` or `messages` tables
 *   directly.
 *
 * What these tests prove:
 *   1. Happy path: the function accepts a {orgId, startDate, endDate}
 *      body, verifies the JWT, checks the view_analytics permission,
 *      and proxies a `analytics_overview` RPC with the converted
 *      timestamptz range.
 *   2. End-date is enforced SERVER-SIDE: the test inspects the
 *      outbound RPC body and asserts p_end is the end-of-day ISO
 *      string (not midnight), and p_start is the start-of-day ISO
 *      string. The SQL `AND created_at <= p_end` is the actual
 *      filter — the page no longer drops rows on the client.
 *   3. Response-time calc runs in SQL (via the LATERAL self-join in
 *      the RPC), not in the browser. The page's computeMetrics
 *      function no longer touches `messages`; this test intercepts
 *      the network and asserts the function makes exactly one RPC
 *      call to `analytics_overview` and zero calls to `messages`.
 *   4. RLS / org-scoping is honored: when verifyOrgAnalyticsPermission
 *      returns `forbidden`, the function returns 403 and never
 *      reaches the RPC. When it returns `insufficient_permissions`,
 *      the function returns 403 with a clear "your role (viewer)
 *      does not have view_analytics" message.
 *   5. Bad input: missing orgId, missing dates, malformed dates,
 *      start > end all return 400.
 *   6. Auth: a request with an invalid/expired JWT returns 401.
 *   7. Org-not-found: when the org doesn't exist, the function
 *      returns 404 (after JWT + DB lookup), never reaching the RPC.
 *
 * The page-level render test (that the page issues exactly one
 * `analytics-overview` HTTP call) lives in a separate file because it
 * needs jsdom + the @insforge/sdk mock; this file is the function-only
 * layer and parallels `__tests__/webhook-signing-secret-source.test.ts`
 * in style.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import analyticsOverview from '../insforge/functions/analytics-overview/index';

// ─── Fetch interceptor ─────────────────────────────────────────────

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

class MockResponse extends Response {
  constructor(body: unknown, init: { status?: number } = {}) {
    super(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

interface MockSpec {
  match: (url: string, method: string) => boolean;
  respond: (url: string, method: string, body: unknown) => MockResponse;
  expectedCallCount?: number;
}

const mocks: MockSpec[] = [];
const fetchCalls: Array<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}> = [];
const originalFetch = global.fetch;

function mockRpc(functionName: string, responseBody: unknown, status = 200) {
  mocks.push({
    match: (u, m) => m === 'POST' && u === `${FAKE_INSFORGE_URL}/rest/v1/rpc/${functionName}`,
    respond: () => new MockResponse(responseBody, { status }),
  });
}

function mockGet(url: string, responseBody: unknown, status = 200) {
  mocks.push({
    match: (u, m) => m === 'GET' && (u === url || u.startsWith(url)),
    respond: () => new MockResponse(responseBody, { status }),
  });
}

function mockPost(url: string, responseBody: unknown, status = 200) {
  mocks.push({
    match: (u, m) => m === 'POST' && (u === url || u.startsWith(url)),
    respond: () => new MockResponse(responseBody, { status }),
  });
}

function resetMocks() {
  mocks.length = 0;
  fetchCalls.length = 0;
}

beforeEach(() => {
  resetMocks();
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as HeadersInit;
      if (h instanceof Headers) {
        h.forEach((v, k) => (headers[k] = v));
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else {
        Object.assign(headers, h as Record<string, string>);
      }
    }
    let parsedBody: unknown = undefined;
    if (init?.body) {
      if (typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      } else {
        parsedBody = init.body;
      }
    }
    fetchCalls.push({ url, method, headers, body: parsedBody });

    for (const m of mocks) {
      if (m.match(url, method)) {
        return m.respond(url, method, parsedBody);
      }
    }
    throw new Error(
      `Unexpected fetch call to ${url} (method=${method}) — no mock registered. Registered mocks: ${mocks.length}, body=${JSON.stringify(parsedBody)}`,
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── Env setup ─────────────────────────────────────────────────────

const FAKE_INSFORGE_URL = 'http://127.0.0.1:54321';
const FAKE_ORG_ID = 'org-analytics-001';
const FAKE_USER_ID = 'user-analytics-001';
const FAKE_JWT = 'header.fake-payload.signature';
const FAKE_SERVICE_ROLE = 'test-service-role-key';

const ORIGINAL_BASE_URL = process.env.INSFORGE_BASE_URL;
const ORIGINAL_SERVICE_ROLE = process.env.INSFORGE_SERVICE_ROLE_KEY;
const ORIGINAL_WEBHOOK_URL = process.env.NEXT_PUBLIC_INSFORGE_URL;

beforeEach(() => {
  process.env.INSFORGE_BASE_URL = FAKE_INSFORGE_URL;
  process.env.INSFORGE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE;
  process.env.NEXT_PUBLIC_INSFORGE_URL = FAKE_INSFORGE_URL;
});

afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) delete process.env.INSFORGE_BASE_URL;
  else process.env.INSFORGE_BASE_URL = ORIGINAL_BASE_URL;
  if (ORIGINAL_SERVICE_ROLE === undefined) delete process.env.INSFORGE_SERVICE_ROLE_KEY;
  else process.env.INSFORGE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE;
  if (ORIGINAL_WEBHOOK_URL === undefined) delete process.env.NEXT_PUBLIC_INSFORGE_URL;
  else process.env.NEXT_PUBLIC_INSFORGE_URL = ORIGINAL_WEBHOOK_URL;
});

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Build a request with a Bearer token that the mocked verifyJwt
 * (stubbed in beforeEach for each test) will accept.
 */
function buildRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/functions/v1/analytics-overview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FAKE_JWT}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  organizationId: FAKE_ORG_ID,
  startDate: '2026-06-01',
  endDate: '2026-06-07',
};

/**
 * Stand-in for verifyJwt. We mock it via the fetch interceptor
 * because the entrypoint calls verifyJwt → which calls
 * `${baseUrl}/auth/v1/user` via fetch. A 200 with a `user.id` body
 * means "valid JWT". Anything else → return null.
 */
function stubJwtVerification(userId: string | null = FAKE_USER_ID) {
  if (userId === null) {
    mockGet(`${FAKE_INSFORGE_URL}/auth/v1/user`, { message: 'invalid' }, 401);
  } else {
    mockGet(`${FAKE_INSFORGE_URL}/auth/v1/user`, { id: userId, email: 'a@b.com' }, 200);
  }
}

/**
 * Stand-in for OrganizationRepository.findById → fetch /rest/v1/organizations?id=eq.<id>
 * (PostgREST .eq('id', id).maybeSingle() shape: returns the row or null).
 */
function stubOrgLookup(orgId = FAKE_ORG_ID, exists = true) {
  if (!exists) {
    mockGet(`${FAKE_INSFORGE_URL}/rest/v1/organizations`, null, 406);
  } else {
    mockGet(
      `${FAKE_INSFORGE_URL}/rest/v1/organizations`,
      { id: orgId, name: 'Test Org', slug: 'test-org' },
      200,
    );
  }
}

/**
 * Stand-in for MemberRepository.findByOrgAndUser → fetch
 * /rest/v1/organization_members?organization_id=eq.<orgId>&user_id=eq.<userId>
 * Returns the membership row with the given role, or null/406 for
 * "not a member".
 */
function stubMembership(role: 'owner' | 'admin' | 'agent' | 'viewer' | null) {
  if (role === null) {
    mockGet(`${FAKE_INSFORGE_URL}/rest/v1/organization_members`, null, 406);
  } else {
    mockGet(
      `${FAKE_INSFORGE_URL}/rest/v1/organization_members`,
      { id: 'mem-001', organization_id: FAKE_ORG_ID, user_id: FAKE_USER_ID, role },
      200,
    );
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('HIGH-8: analytics-overview function', () => {
  describe('happy path', () => {
    it('calls the SQL aggregation RPC and returns the metrics JSON', async () => {
      stubJwtVerification();
      stubOrgLookup();
      // view_analytics is granted to owner + admin only (rbac.ts:67-78).
      // Use admin to cover the non-owner happy path.
      stubMembership('admin');

      const rpcResponse = {
        totalConversations: 42,
        openConversations: 10,
        resolvedConversations: 25,
        escalatedConversations: 5,
        pendingConversations: 2,
        aiProcessedConversations: 30,
        aiAutoRepliedConversations: 20,
        aiAutoReplyRate: 0.6667,
        averageResponseTimeMs: 1234.5,
      };
      mockRpc('analytics_overview', rpcResponse);

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string; data: typeof rpcResponse };
      expect(body.status).toBe('ok');
      expect(body.data).toEqual(rpcResponse);
    });

    it('passes the date range as inclusive server-side bounds (start of day, end of day)', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('admin');
      mockRpc('analytics_overview', { totalConversations: 0 });

      await analyticsOverview(buildRequest(VALID_BODY));

      const rpcCall = fetchCalls.find(
        (c) => c.url === `${FAKE_INSFORGE_URL}/rest/v1/rpc/analytics_overview`,
      );
      expect(rpcCall).toBeDefined();
      expect(rpcCall?.method).toBe('POST');

      // The function maps the YYYY-MM-DD pair to:
      //   p_start: 00:00:00.000Z on the start date
      //   p_end:   23:59:59.999Z on the end date
      // This is the analogue of the OLD app/analytics/page.tsx:86
      // logic that did .toISOString() on the same range — except
      // now it happens in the function, and the SQL enforces both
      // bounds (`created_at >= p_start AND created_at <= p_end`).
      const body = rpcCall?.body as Record<string, string>;
      expect(body.p_organization_id).toBe(FAKE_ORG_ID);
      expect(body.p_start).toBe('2026-06-01T00:00:00.000Z');
      expect(body.p_end).toBe('2026-06-07T23:59:59.999Z');
    });

    it('does NOT query the conversations or messages tables directly (response-time calc is in SQL)', async () => {
      // The OLD page queried conversations (limit 10000) and messages
      // (limit 5000, .in('conversation_id', first-100-ids)). The new
      // path must not call those tables — the RPC does the work.
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('admin');
      mockRpc('analytics_overview', { totalConversations: 0 });

      await analyticsOverview(buildRequest(VALID_BODY));

      const conversationCalls = fetchCalls.filter((c) => /\/rest\/v1\/conversations(\?|$)/.test(c.url) && !c.url.includes('/rpc/'));
      const messageCalls = fetchCalls.filter((c) => /\/rest\/v1\/messages(\?|$)/.test(c.url) && !c.url.includes('/rpc/'));
      expect(conversationCalls).toHaveLength(0);
      expect(messageCalls).toHaveLength(0);
    });

    it('makes exactly one RPC call to analytics_overview (no extra round-trips for response time)', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('admin');
      mockRpc('analytics_overview', { totalConversations: 0 });

      await analyticsOverview(buildRequest(VALID_BODY));

      const rpcCalls = fetchCalls.filter(
        (c) => c.url === `${FAKE_INSFORGE_URL}/rest/v1/rpc/analytics_overview`,
      );
      expect(rpcCalls).toHaveLength(1);
    });

    it('grants access to org owners (full permission set per rbac.ts)', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('owner');
      mockRpc('analytics_overview', { totalConversations: 0 });

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(200);
    });
  });

  describe('auth + permission gating', () => {
    it('returns 401 when the JWT is invalid', async () => {
      stubJwtVerification(null); // auth/v1/user returns 401
      // NOTE: do NOT stub org/membership — we should never reach those.
      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Unauthorized');

      const rpcCalls = fetchCalls.filter((c) => c.url.includes('/rpc/analytics_overview'));
      expect(rpcCalls).toHaveLength(0);
    });

    it('returns 403 when the caller is not a member of the target org', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership(null); // not a member

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not a member/i);

      const rpcCalls = fetchCalls.filter((c) => c.url.includes('/rpc/analytics_overview'));
      expect(rpcCalls).toHaveLength(0);
    });

    it('returns 403 with a clear role/permission message when the caller is a viewer', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('viewer'); // viewer has no view_analytics

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toMatch(/insufficient permissions/i);
      expect(body.message).toMatch(/viewer/i);
      expect(body.message).toMatch(/view_analytics/i);

      const rpcCalls = fetchCalls.filter((c) => c.url.includes('/rpc/analytics_overview'));
      expect(rpcCalls).toHaveLength(0);
    });

    it('returns 403 when the caller is an agent (view_analytics is owner/admin only per rbac.ts)', async () => {
      // The OLD page did no permission check at all — every
      // authenticated user in the org could see every metric. The
      // new path narrows view_analytics to owner/admin. An agent
      // can reply to a conversation but cannot see org-wide metrics.
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('agent');

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.message).toMatch(/agent/i);
      expect(body.message).toMatch(/view_analytics/i);

      const rpcCalls = fetchCalls.filter((c) => c.url.includes('/rpc/analytics_overview'));
      expect(rpcCalls).toHaveLength(0);
    });

    it('returns 404 when the target org does not exist', async () => {
      stubJwtVerification();
      stubOrgLookup(FAKE_ORG_ID, false); // org not found

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/organization not found/i);

      const rpcCalls = fetchCalls.filter((c) => c.url.includes('/rpc/analytics_overview'));
      expect(rpcCalls).toHaveLength(0);
    });
  });

  describe('input validation', () => {
    it('returns 400 when organizationId is missing', async () => {
      const res = await analyticsOverview(
        buildRequest({ startDate: '2026-06-01', endDate: '2026-06-07' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when startDate is missing', async () => {
      const res = await analyticsOverview(
        buildRequest({ organizationId: FAKE_ORG_ID, endDate: '2026-06-07' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when endDate is missing', async () => {
      const res = await analyticsOverview(
        buildRequest({ organizationId: FAKE_ORG_ID, startDate: '2026-06-01' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when startDate is not YYYY-MM-DD', async () => {
      const res = await analyticsOverview(
        buildRequest({ ...VALID_BODY, startDate: '06/01/2026' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when endDate is not YYYY-MM-DD', async () => {
      const res = await analyticsOverview(
        buildRequest({ ...VALID_BODY, endDate: 'not-a-date' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when start > end', async () => {
      const res = await analyticsOverview(
        buildRequest({ ...VALID_BODY, startDate: '2026-06-07', endDate: '2026-06-01' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when the body is not valid JSON', async () => {
      const req = new Request('http://localhost/functions/v1/analytics-overview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${FAKE_JWT}`,
        },
        body: '{ this is not json',
      });
      const res = await analyticsOverview(req);
      expect(res.status).toBe(400);
    });
  });

  describe('downstream RPC errors', () => {
    it('returns 500 and surfaces the RPC error message when analytics_overview fails', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('admin');
      mockRpc('analytics_overview', { message: 'permission denied for function analytics_overview' }, 403);

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; details?: string };
      expect(body.error).toMatch(/failed to compute analytics/i);
      expect(body.details).toMatch(/permission denied/i);
    });

    it('passes through a null data field as an empty metrics object (empty result, not error)', async () => {
      stubJwtVerification();
      stubOrgLookup();
      stubMembership('admin');
      // PostgREST returns null body for a jsonb-returning RPC when
      // there are zero rows in the result set (rare for analytics_overview
      // since it always returns one row, but defensive).
      mockRpc('analytics_overview', null);

      const res = await analyticsOverview(buildRequest(VALID_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; data: Record<string, unknown> };
      expect(body.status).toBe('ok');
      expect(body.data).toEqual({});
    });
  });
});
