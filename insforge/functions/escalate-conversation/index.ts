/**
 * escalate-conversation — Escalates a conversation to human agents.
 *
 * Auth: JWT verification (Bearer token in Authorization header).
 *
 * Flow:
 * 1. Parse request body as JSON — expect { conversationId }
 * 2. Verify JWT authentication — return 401 if invalid
 * 3. Create database client, repositories
 * 4. Set conversation status to "escalated" and ai_state to "needs_human"
 * 5. Record audit log entry for "conversation_escalated"
 * 6. Publish conversation_updated realtime event on org:{orgId} channel
 * 7. Return 200 OK
 *
 * Requirements: 5.5, 5.6, 5.7, 16.1, 16.2, 16.3, 22.1
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { log, logError, newRequestContext, withRequest, withRequestIdHeader } from '../_shared/logger.js';
import { requireOrgMembership } from '../_shared/require-org-membership.js';
import { requirePermission } from '../_shared/require-permission.js';
import { getRequiredPermission } from '../_shared/endpoint-permissions.js';
import { verifyJwt } from '../_shared/verify-jwt.js';

import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';

// ---------------------------------------------------------------------------
// Helper: JSON response builder
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  const ctx = newRequestContext('escalate-conversation', req);
  try {
    const response = await withRequest(ctx, async () => {
      // 1. Parse request body as JSON
      let payload: { conversationId?: string };
      try {
        payload = await req.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const { conversationId } = payload;

      if (!conversationId || typeof conversationId !== 'string') {
        return jsonResponse({ error: 'Missing or invalid conversationId' }, 400);
      }

      // 2. Verify JWT authentication
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
      ctx.user_id = userId;

      // 3. Create database client and repositories
      const db = createDbClient(baseUrl, serviceRoleKey);

      // CRITICAL-2: enforce org membership before mutating the conversation.
      // requireOrgMembership returns the conversation's organizationId on
      // success.
      const membership = await requireOrgMembership(db, userId, conversationId);
      if (membership.kind === 'conversation_not_found') {
        return jsonResponse({ error: 'Conversation not found' }, 404);
      }
      if (membership.kind === 'forbidden') {
        return jsonResponse({ error: 'Forbidden: not a member of this conversation\'s organization' }, 403);
      }
      const orgId = membership.organizationId;
      ctx.org_id = orgId;

      // HIGH-1: enforce the per-endpoint RBAC permission. Escalation
      // changes the conversation's status and routing, so it's an admin+
      // operation (manage_conversations). Agents can reply but should
      // not be able to flip the status of a conversation they don't own.
      const permission = await requirePermission(
        db,
        userId,
        orgId,
        getRequiredPermission('escalate-conversation'),
      );
      if (permission.kind === 'role_not_found') {
        return jsonResponse({ error: 'Forbidden: member has no role' }, 500);
      }
      if (permission.kind === 'forbidden') {
        return jsonResponse(
          { error: 'Forbidden', reason: permission.reason },
          403,
        );
      }

      const conversationRepo = new ConversationRepository(db);
      const auditLogRepo = new AuditLogRepository(db);

      // 4. Set conversation status to "escalated" and ai_state to "needs_human"
      const conversation = await conversationRepo.update(conversationId, {
        status: 'escalated',
        aiState: 'needs_human',
      });
      log({ ...ctx, level: 'info', msg: 'conversation escalated', status_after: conversation.status });

      // 5. Record audit log entry
      await auditLogRepo.create({
        organizationId: orgId,
        actorId: userId,
        actorType: 'user',
        action: 'conversation_escalated',
        resourceType: 'conversation',
        resourceId: conversationId,
      });

      // 6. Publish conversation_updated realtime event
      const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
      await realtimePublisher.publish(`org:${orgId}`, 'conversation_updated', {
        conversationId,
        status: conversation.status,
        aiState: conversation.aiState,
      });

      // 7. Return 200 OK
      return jsonResponse({ status: 'ok', data: conversation });
    });
    return withRequestIdHeader(ctx, response);
  } catch (err) {
    return jsonResponse(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
}
