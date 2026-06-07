/**
 * Regression tests for CRITICAL-2 + HIGH-1: JWT-protected conversation
 * functions enforce org membership AND role-based permission.
 *
 * Background (docs/QA_BUG_HUNT.md):
 *
 * - CRITICAL-2: the JWT-authenticated serverless function entrypoints
 *   that mutate a conversation used to (1) verify the JWT, (2) load the
 *   conversation by `conversationId` from the request body, and (3)
 *   mutate it through a service-role-key DatabaseClient. There was no
 *   check that the caller belonged to the org that owned the
 *   conversation, so any authenticated user in any tenant could act on
 *   any conversation (real outbound SMS, audit-log forgery, etc.).
 *
 * - HIGH-1: the `rbac` module defined a complete permission matrix and
 *   was 100% unit-tested, but was NEVER imported by any function
 *   entrypoint, service, or page. Any authenticated user had the full
 *   permission set: agents could delete orgs, viewers could manage
 *   settings, etc.
 *
 * Fix (these tests verify): each of the six entrypoints
 * (`send-reply`, `approve-ai-draft`, `regenerate-ai-draft`,
 * `escalate-conversation`, `resolve-conversation`, `reopen-conversation`)
 * must call `requirePermission(db, userId, conversationId, '<perm>')`
 * BEFORE any mutation or side effect, and must return:
 *   - 403 forbidden when the caller is not a member of the conversation's org
 *   - 403 insufficient_permissions when the caller is a member but their
 *     role lacks the required permission
 *   - 404 when the conversation does not exist
 *
 * We invoke the entrypoint handlers directly. We mock the JWT verifier
 * (so the test does not need a real InsForge backend) and we mock the
 * `requirePermission` helper (so the test pins the *handler's* contract
 * — that it returns 403/404 from the helper's discriminated result —
 * without needing the full DB stack).
 *
 * If a future refactor removes the membership or permission check from
 * a function, at least one of these tests will fail and the regression
 * will be caught.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the shared JWT verifier: any token returns userId 'user-attacker'.
vi.mock('../insforge/functions/_shared/verify-jwt.js', () => ({
  verifyJwt: vi.fn().mockResolvedValue({ userId: 'user-attacker' }),
}));

// Mock the permission helper: each test sets the return value per-case.
// We also assert the handler called it with the right args.
const requirePermission = vi.fn();
vi.mock('../insforge/functions/_shared/require-permission.js', () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...args),
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
  requirePermission.mockReset();
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

describe('CRITICAL-2 + HIGH-1: every conversation-mutating function requires org membership AND permission', () => {
  describe('send-reply (requires reply_conversations)', () => {
    it('returns 403 forbidden when the caller is not a member of the org', async () => {
      requirePermission.mockResolvedValue({ kind: 'forbidden' });

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-victim', body: 'hello' }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/Forbidden/i);
      expect(body.error).toMatch(/member/i);
      // The handler must have called requirePermission with the
      // userId from the JWT, the conversationId from the body, and
      // the 'reply_conversations' permission.
      expect(requirePermission).toHaveBeenCalledTimes(1);
      const callArgs = requirePermission.mock.calls[0] as unknown[];
      expect(callArgs[1]).toBe('user-attacker'); // userId
      expect(callArgs[2]).toBe('conv-victim'); // conversationId
      expect(callArgs[3]).toBe('reply_conversations');
    });

    it('returns 403 insufficient_permissions when the role lacks the required permission (e.g. viewer)', async () => {
      requirePermission.mockResolvedValue({
        kind: 'insufficient_permissions',
        role: 'viewer',
        permission: 'reply_conversations',
      });

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-1', body: 'hello' }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string; message?: string };
      expect(body.error).toMatch(/insufficient permissions/i);
      // The message must include the role AND the permission so the
      // operator can see exactly why the call was rejected.
      expect(body.message).toMatch(/viewer/);
      expect(body.message).toMatch(/reply_conversations/);
    });

    it('returns 404 when the conversation does not exist', async () => {
      requirePermission.mockResolvedValue({ kind: 'conversation_not_found' });

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-missing', body: 'hello' }),
      );

      expect(res.status).toBe(404);
    });

    it('returns 401 when the JWT is invalid (permission check never runs)', async () => {
      // Reset the verifyJwt mock to return null for this test only.
      const { verifyJwt } = await import('../insforge/functions/_shared/verify-jwt.js');
      (verifyJwt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const res = await sendReply(
        buildAuthedRequest({ conversationId: 'conv-victim', body: 'hello' }),
      );

      expect(res.status).toBe(401);
      // Critical: the permission check must NOT run if the JWT check fails.
      expect(requirePermission).not.toHaveBeenCalled();
    });
  });

  describe('approve-ai-draft (requires manage_settings)', () => {
    it('returns 403 forbidden when the caller is not a member', async () => {
      requirePermission.mockResolvedValue({ kind: 'forbidden' });

      const res = await approveAiDraft(
        buildAuthedRequest({ conversationId: 'conv-victim', aiDecisionId: 'dec-1' }),
      );

      expect(res.status).toBe(403);
      expect(requirePermission).toHaveBeenCalledTimes(1);
      expect((requirePermission.mock.calls[0] as unknown[])[1]).toBe('user-attacker');
      expect((requirePermission.mock.calls[0] as unknown[])[2]).toBe('conv-victim');
      expect((requirePermission.mock.calls[0] as unknown[])[3]).toBe('manage_settings');
    });

    it('returns 403 insufficient_permissions for an agent (no manage_settings)', async () => {
      // Agents have reply_conversations + manage_conversations, but NOT
      // manage_settings. They must NOT be able to approve AI drafts
      // because approval sends a real outbound message and writes to
      // the audit log — admin-level decisions.
      requirePermission.mockResolvedValue({
        kind: 'insufficient_permissions',
        role: 'agent',
        permission: 'manage_settings',
      });

      const res = await approveAiDraft(
        buildAuthedRequest({ conversationId: 'conv-1', aiDecisionId: 'dec-1' }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { message?: string };
      expect(body.message).toMatch(/agent/);
      expect(body.message).toMatch(/manage_settings/);
    });
  });

  describe('regenerate-ai-draft (requires manage_settings)', () => {
    it('returns 403 forbidden when the caller is not a member', async () => {
      requirePermission.mockResolvedValue({ kind: 'forbidden' });

      const res = await regenerateAiDraft(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requirePermission).toHaveBeenCalledTimes(1);
      expect((requirePermission.mock.calls[0] as unknown[])[3]).toBe('manage_settings');
    });

    it('returns 403 insufficient_permissions for an agent', async () => {
      requirePermission.mockResolvedValue({
        kind: 'insufficient_permissions',
        role: 'agent',
        permission: 'manage_settings',
      });

      const res = await regenerateAiDraft(
        buildAuthedRequest({ conversationId: 'conv-1' }),
      );

      expect(res.status).toBe(403);
    });
  });

  describe('escalate-conversation (requires manage_conversations)', () => {
    it('returns 403 forbidden when the caller is not a member', async () => {
      requirePermission.mockResolvedValue({ kind: 'forbidden' });

      const res = await escalateConversation(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requirePermission).toHaveBeenCalledTimes(1);
      expect((requirePermission.mock.calls[0] as unknown[])[3]).toBe('manage_conversations');
    });

    it('returns 403 insufficient_permissions for a viewer (no manage_conversations)', async () => {
      // Viewers are read-only. They must NOT be able to escalate.
      requirePermission.mockResolvedValue({
        kind: 'insufficient_permissions',
        role: 'viewer',
        permission: 'manage_conversations',
      });

      const res = await escalateConversation(
        buildAuthedRequest({ conversationId: 'conv-1' }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { message?: string };
      expect(body.message).toMatch(/viewer/);
      expect(body.message).toMatch(/manage_conversations/);
    });
  });

  describe('resolve-conversation (requires manage_conversations)', () => {
    it('returns 403 forbidden when the caller is not a member', async () => {
      requirePermission.mockResolvedValue({ kind: 'forbidden' });

      const res = await resolveConversation(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requirePermission).toHaveBeenCalledTimes(1);
      expect((requirePermission.mock.calls[0] as unknown[])[3]).toBe('manage_conversations');
    });

    it('returns 403 insufficient_permissions for a viewer', async () => {
      requirePermission.mockResolvedValue({
        kind: 'insufficient_permissions',
        role: 'viewer',
        permission: 'manage_conversations',
      });

      const res = await resolveConversation(
        buildAuthedRequest({ conversationId: 'conv-1' }),
      );

      expect(res.status).toBe(403);
    });
  });

  describe('reopen-conversation (requires manage_conversations)', () => {
    it('returns 403 forbidden when the caller is not a member', async () => {
      requirePermission.mockResolvedValue({ kind: 'forbidden' });

      const res = await reopenConversation(
        buildAuthedRequest({ conversationId: 'conv-victim' }),
      );

      expect(res.status).toBe(403);
      expect(requirePermission).toHaveBeenCalledTimes(1);
      expect((requirePermission.mock.calls[0] as unknown[])[3]).toBe('manage_conversations');
    });

    it('returns 403 insufficient_permissions for a viewer', async () => {
      requirePermission.mockResolvedValue({
        kind: 'insufficient_permissions',
        role: 'viewer',
        permission: 'manage_conversations',
      });

      const res = await reopenConversation(
        buildAuthedRequest({ conversationId: 'conv-1' }),
      );

      expect(res.status).toBe(403);
    });
  });
});
