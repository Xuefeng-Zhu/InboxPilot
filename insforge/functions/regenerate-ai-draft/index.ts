/**
 * regenerate-ai-draft — Regenerates an AI draft for a conversation.
 *
 * Auth: JWT verification (Bearer token in Authorization header).
 *
 * Flow:
 * 1. Parse request body as JSON — expect { conversationId }
 * 2. Verify JWT authentication — return 401 if invalid
 * 3. Create database client, repositories, and job queue
 * 4. Enqueue a new process_ai_message job
 * 5. Set conversation ai_state to "thinking"
 * 6. Record audit log entry for "ai_draft_regenerated"
 * 7. Publish conversation_updated realtime event
 * 8. Return 200 OK
 *
 * Requirements: 16.1, 16.2, 16.3, 22.1
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { verifyJwt } from '../_shared/verify-jwt.js';

import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.js';

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

    // 3. Create database client, repositories, and job queue
    const db = createDbClient(baseUrl, serviceRoleKey);

    const conversationRepo = new ConversationRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const jobQueue = new PostgresJobQueue(db);

    // Load conversation to get orgId and validate it exists
    const conversation = await conversationRepo.findById(conversationId);
    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }

    // 4. Enqueue a new process_ai_message job
    const job = await jobQueue.enqueue(
      'process_ai_message',
      { conversationId, organizationId: conversation.organizationId },
      conversation.organizationId,
    );

    // 5. Set conversation ai_state to "thinking"
    const updatedConversation = await conversationRepo.update(conversationId, {
      aiState: 'thinking',
    });

    // 6. Record audit log entry
    await auditLogRepo.create({
      organizationId: conversation.organizationId,
      actorId: userId,
      actorType: 'user',
      action: 'ai_draft_regenerated',
      resourceType: 'conversation',
      resourceId: conversationId,
      metadata: {
        jobId: job.id,
      },
    });

    // 7. Publish conversation_updated realtime event
    const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
    await realtimePublisher.publish(
      `org:${conversation.organizationId}`,
      'conversation_updated',
      {
        conversationId,
        status: updatedConversation.status,
        aiState: updatedConversation.aiState,
      },
    );

    // 8. Return 200 OK
    return jsonResponse({
      status: 'ok',
      data: { conversation: updatedConversation, jobId: job.id },
    });
  } catch (err) {
    console.error('regenerate-ai-draft error:', err);
    return jsonResponse(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
}
