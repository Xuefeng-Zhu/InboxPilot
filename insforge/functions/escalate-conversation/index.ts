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
import { requirePermission } from '../_shared/require-permission.js';
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
  try {
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

    // 3. Create database client and repositories
    const db = createDbClient(baseUrl, serviceRoleKey);

    // HIGH-1: enforce org membership AND permission before mutating the
    // conversation. requirePermission returns the conversation's
    // organizationId on success. 'manage_conversations' is the dedicated
    // permission for conversation state changes (escalate / resolve /
    // reopen). It is granted to owner, admin, AND agent — agents are the
    // day-to-day operators who triage tickets.
    const check = await requirePermission(db, userId, conversationId, 'manage_conversations');
    if (check.kind === 'conversation_not_found') {
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }
    if (check.kind === 'forbidden') {
      return jsonResponse({ error: 'Forbidden: not a member of this conversation\'s organization' }, 403);
    }
    if (check.kind === 'insufficient_permissions') {
      return jsonResponse(
        {
          error: 'Forbidden: insufficient permissions',
          message: `Your role "${check.role}" does not have "${check.permission}" permission`,
        },
        403,
      );
    }
    const orgId = check.organizationId;

    const conversationRepo = new ConversationRepository(db);
    const auditLogRepo = new AuditLogRepository(db);

    // 4. Set conversation status to "escalated" and ai_state to "needs_human"
    const conversation = await conversationRepo.update(conversationId, {
      status: 'escalated',
      aiState: 'needs_human',
    });

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
  } catch (err) {
    console.error('escalate-conversation error:', err);
    return jsonResponse(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
}
