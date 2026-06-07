/**
 * Regression tests for CRITICAL-2: JWT-protected conversation functions
 * enforce org membership.
 *
 * Background (docs/QA_BUG_HUNT.md, finding CRITICAL-2): the six JWT-
 * authenticated serverless function entrypoints that mutate a
 * conversation used to (1) verify the JWT, (2) load the conversation by
 * `conversationId` from the request body, and (3) mutate it through a
 * service-role-key DatabaseClient. There was no check that the caller
 * belonged to the org that owned the conversation, so any authenticated
 * user in any tenant could act on any conversation (real outbound SMS,
 * audit-log forgery, etc.).
 *
 * Fix (these tests verify): each of the six entrypoints
 * (`send-reply`, `approve-ai-draft`, `regenerate-ai-draft`,
 * `escalate-conversation`, `resolve-conversation`, `reopen-conversation`)
 * must call `requireOrgMembership(db, userId, conversationId)` BEFORE any
 * mutation or side effect, and must return 403 when the caller is not a
 * member of the conversation's org.
 *
 * We invoke the entrypoint handlers directly. We mock the JWT verifier
 * (so the test does not need a real InsForge backend) and we mock the
 * `requireOrgMembership` helper (so the test pins the *handler's*
 * contract — that it returns 403/404 from the helper's discriminated
 * result — without needing the full DB stack).
 *
 * If a future refactor removes the membership check from a function, at
 * least one of these tests will fail and the regression will be caught.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the shared JWT verifier: any token returns userId 'user-attacker'.
vi.mock('../insforge/functions/_shared/verify-jwt.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ userId: 'user-attacker' }),
}));

// Mock the membership helper: each test sets the return value per-case.
// We also assert the handler called it with the right args.
const requireOrgMembership = vi.fn();
vi.mock('../insforge/functions/_shared/require-org-membership.js', () => ({
  requireOrgMembership: (...args: unknown[]) => requireOrgMembership(...args),
}));

// Mock the realtime publisher (it would otherwise call out to InsForge).
vi.mock('../insforge/functions/_shared/create-realtime-publisher.js', () => ({
  createRealtimePublisher: () => ({
    publish: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Import entrypoint handlers AFTER mocks are registered.
import sendReply from '../insforge/functions/send-reply/index.js';
import approveAiDraft from '../insforge/functions/approve-ai-draft/index.js';
import regenerateAiDraft from '../insforge/functions/regenerate-ai-draft/index.js';
import escalateConversation from '../insforge/functions/escalate-conversation/index.js';
import resolveConversation from '../insforge/functions/resolve-conversation/index.js';
import reopenConversation from '../insforge/functions/reopen-conversation/index.js';

const ORIGINAL_BASE_URL = process.env.INSFORGE_BASE_URL;
const ORIGINAL_SERVICE_ROLE = process.env.INSFORGE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.INSFORGE_BASE_URL = 'http://127.0.0.1:0';
  process.env.INSFORGE_SERVICE_ROLE_KEY = 'test-key-do-not-use';
  requireOrgMembership.mockReset();
});

afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) delete process.env.INSFORGE_BASE_URL;
  else process.env.INSFORGE_BASE_URL = ORIGINAL_BASE_URL;
  if (ORIGINAL_SERVICE_ROLE === undefined) delete process.env.INSFORGE_SERVICE_ROLE_KEY;
  else process.env.INSFORGE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE;
});

/** Build a POST Request with a Bearer token and JSON body. */
function buildAuthedRequest(body: object): Request {
  return new Request('http://localhost/functions/v1/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-jwt',
    },
    body: JSON.stringify(body),
  });
}

describe('CRITICAL-2: every conversation-mutating function requires org membership', () => {
  describe('send-reply', () => {
    it('returns 403 with a clear error when the caller is not a member of the org', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'forbidden' });

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-victim', body: 'hello' }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/Forbidden/i);
      expect(body.error).toMatch(/member/i);
      // The handler must have called requireOrgMembership with the
      // userId from the JWT and the conversationId from the body.
      expect(requireOrgMembership).toHaveBeenCalledTimes(1);
      const callArgs = requireOrgMembership.mock.calls[0] as unknown[];
      expect(callArgs[1]).toBe('user-attacker'); // userId
      expect(callArgs[2]).toBe('conv-victim'); // conversationId
    });

    it('returns 404 when the conversation does not exist', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'conversation_not_found' });

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-missing', body: 'hello' }),
      );

      expect(res.status).toBe(404);
    });

    it('returns 401 when the JWT is invalid (membership check never runs)', async () => {
      // Reset the verifyJwt mock to return null for this test only.
      const { verifyJwt } = await import('../insforge/functions/_shared/verify-jwt.js');
      (verifyJwt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-victim', body: 'hello' }),
      );

      expect(res.status).toBe(401);
      // Critical: the membership check must NOT run if the JWT check fails.
      expect(requireOrgMembership).not.toHaveBeenCalled();
    });
  });

  describe('approve-ai-draft', () => {
    it('returns 403 when the caller is not a member of the org', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'forbidden' });

      const res = await approveAiDraft(
        buildAuthedRequest({ conversationId: 'conv-victim', aiDecisionId: 'dec-1' }),
      );

      expect(res.status).toBe(403);
      expect(requireOrgMembership).toHaveBeenCalledTimes(1);
      expect((requireOrgMembership.mock.calls[0] as unknown[])[1]).toBe('user-attacker');
      expect((requireOrgMembership.mock.calls[0] as unknown[])[2]).toBe('conv-victim');
    });
  });

  describe('regenerate-ai-draft', () => {
    it('returns 403 when the caller is not a member of the org', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'forbidden' });

      const res = await regenerateAiDraft(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requireOrgMembership).toHaveBeenCalledTimes(1);
    });
  });

  describe('escalate-conversation', () => {
    it('returns 403 when the caller is not a member of the org', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'forbidden' });

      const res = await escalateConversation(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requireOrgMembership).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolve-conversation', () => {
    it('returns 403 when the caller is not a member of the org', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'forbidden' });

      const res = await resolveConversation(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requireOrgMembership).toHaveBeenCalledTimes(1);
    });
  });

  describe('reopen-conversation', () => {
    it('returns 403 when the caller is not a member of the org', async () => {
      requireOrgMembership.mockResolvedValue({ kind: 'forbidden' });

      const res = await reopenConversation(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requireOrgMembership).toHaveBeenCalledTimes(1);
    });
  });
});
