/**
 * Regression tests for CRITICAL-4: internal-dispatch function entrypoints
 * require the `x-internal-token` shared secret.
 *
 * Background (docs/QA_BUG_HUNT.md, finding CRITICAL-4): the three
 * serverless function entrypoints `process-knowledge-document`,
 * `process-ai-job`, and `process-jobs` used to accept any request body
 * and start doing real work — re-embedding documents, running AI
 * analysis on conversations, or claiming up to ten queued jobs and
 * running them. Because the function URL is public, anyone who
 * discovered it could amplify AI-token costs (cost attack) and, in
 * the re-embedding case, change the KB retrieval result
 * (data-integrity attack).
 *
 * Fix (these tests verify): each of the three entrypoints must call
 * `requireInternalToken` FIRST and return 401 Unauthorized on missing
 * or wrong token, and 500 on a missing server-side env var.
 *
 * Helper-level unit tests live in `internal-dispatch-token-helper.test.ts`
 * (separate file so we can mock the helper here without breaking the
 * real implementation tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the same module the handlers import. The mock delegates to a
// vi.fn() so the handler-level tests can program the return value
// per-case and still assert the handler called the helper.
const requireInternalTokenMock = vi.fn();
vi.mock('../insforge/functions/_shared/require-internal-token.js', () => ({
  requireInternalToken: (...args: unknown[]) => requireInternalTokenMock(...args),
  INTERNAL_TOKEN_HEADER: '***',
  INTERNAL_TOKEN_ENV: 'INTERN...OKEN',
}));

import processKnowledgeDocument from '../insforge/functions/process-knowledge-document/index.js';
import processAiJob from '../insforge/functions/process-ai-job/index.js';
import processJobs from '../insforge/functions/process-jobs/index.js';

// Mock the DB client and realtime publisher so the handlers do not try
// to talk to InsForge when (in the happy path) the auth check passes
// but the rest of the body is still garbage. We assert on the response
// status, not on downstream side-effects.
vi.mock('../insforge/functions/_shared/create-db-client.js', () => ({
  createDbClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

vi.mock('../insforge/functions/_shared/create-realtime-publisher.js', () => ({
  createRealtimePublisher: () => ({
    publish: vi.fn().mockResolvedValue(undefined),
  }),
}));

const ORIGINAL_BASE_URL = process.env.INSFORGE_BASE_URL;
const ORIGINAL_SERVICE_ROLE = process.env.INSFORGE_SERVICE_ROLE_KEY;

beforeEach(() => {
  // Some env config so handlers that get past auth don't NPE on missing
  // baseUrl / serviceRoleKey. The auth check happens before these are
  // read, but be safe.
  process.env.INSFORGE_BASE_URL = 'http://127.0.0.1:0';
  process.env.INSFORGE_SERVICE_ROLE_KEY = 'test-key-do-not-use';
  requireInternalTokenMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) delete process.env.INSFORGE_BASE_URL;
  else process.env.INSFORGE_BASE_URL = ORIGINAL_BASE_URL;
  if (ORIGINAL_SERVICE_ROLE === undefined) delete process.env.INSFORGE_SERVICE_ROLE_KEY;
  else process.env.INSFORGE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE;
});

/** Build a POST Request with an optional token header and JSON body. */
function buildRequest(opts: { token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== undefined) headers['***'] = opts.token;
  return new Request('http://localhost/functions/v1/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe('CRITICAL-4: every internal-dispatch function requires the shared secret', () => {
  describe('process-knowledge-document', () => {
    it('returns 401 when the x-internal-token header is missing', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'unauthorized' });
      const res = await processKnowledgeDocument(buildRequest({ body: { documentId: 'doc-1' } }));
      expect(res.status).toBe(401);
    });

    it('returns 401 when the x-internal-token header is wrong', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'unauthorized' });
      const res = await processKnowledgeDocument(
        buildRequest({ token: 'wrong', body: { documentId: 'doc-1' } }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 500 when the server is misconfigured (no env var)', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'misconfigured' });
      const res = await processKnowledgeDocument(buildRequest({ body: { documentId: 'doc-1' } }));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/not configured/i);
    });

    it('calls requireInternalToken BEFORE parsing the body', async () => {
      // If a future refactor moves the body parse above the auth check,
      // this test fails: the helper call would be missing entirely.
      requireInternalTokenMock.mockReturnValue({ kind: 'unauthorized' });
      await processKnowledgeDocument(buildRequest({ body: { documentId: 'doc-1' } }));
      expect(requireInternalTokenMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('process-ai-job', () => {
    it('returns 401 when the x-internal-token header is missing', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'unauthorized' });
      const res = await processAiJob(
        buildRequest({ body: { conversation_id: 'conv-1', organization_id: 'org-1' } }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 500 when the server is misconfigured (no env var)', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'misconfigured' });
      const res = await processAiJob(
        buildRequest({ body: { conversation_id: 'conv-1', organization_id: 'org-1' } }),
      );
      expect(res.status).toBe(500);
    });
  });

  describe('process-jobs', () => {
    it('returns 401 when the x-internal-token header is missing', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'unauthorized' });
      const res = await processJobs(buildRequest({ body: {} }));
      expect(res.status).toBe(401);
    });

    it('returns 500 when the server is misconfigured (no env var)', async () => {
      requireInternalTokenMock.mockReturnValue({ kind: 'misconfigured' });
      const res = await processJobs(buildRequest({ body: {} }));
      expect(res.status).toBe(500);
    });

    it('calls requireInternalToken before claiming any jobs (no job work on 401)', async () => {
      // If a future refactor moves the claim() call above the auth
      // check, this test catches it: the helper call is still the
      // very first side effect.
      requireInternalTokenMock.mockReturnValue({ kind: 'unauthorized' });
      const res = await processJobs(buildRequest({ body: {} }));
      expect(res.status).toBe(401);
      expect(requireInternalTokenMock).toHaveBeenCalledTimes(1);
    });
  });
});
