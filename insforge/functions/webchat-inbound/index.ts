/**
 * webchat-inbound — Handles inbound webchat messages from visitors.
 *
 * Auth: Visitor JWT (HS256, per-widget secret) via Authorization: Bearer header.
 * Anti-flood: max 10 messages/minute per thread (in-memory per worker).
 *
 * Side effects:
 * - Insert inbound message (channel='webchat')
 * - Update conversation lastMessageAt
 * - Enqueue process_ai_message job
 * - Publish new_message on org:{orgId}
 * - Update webchat_threads.page_url + last_seen_at
 * - Write audit log entry
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.ts';
import { verifyVisitorJwt } from '../_shared/verify-visitor-jwt.ts';
import { handleCorsPreFlight, corsJsonResponse } from '../_shared/cors.ts';

import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { WebchatThreadRepository } from '../../../packages/support-core/src/repositories/webchat-thread-repository.ts';
import { InboundMessageService } from '../../../packages/support-core/src/services/inbound-message-service.ts';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.ts';

// ---------------------------------------------------------------------------
// Anti-flood: in-memory rate limiter (per worker instance)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;

function checkRateLimit(threadId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(threadId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(threadId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return corsJsonResponse(body, status);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') return handleCorsPreFlight();
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // 1. Create DB client
    const baseUrl =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
      process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
    const serviceRoleKey =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ?? '';

    const db = createDbClient(baseUrl, serviceRoleKey);

    // 2. Verify visitor JWT
    const verified = await verifyVisitorJwt(req, db);
    if (!verified) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { claims, widget, thread } = verified;

    // 3. Check widget is active
    if (!widget.isActive) {
      return jsonResponse({ error: 'Widget is inactive' }, 403);
    }

    // 4. Enforce pre-chat at the trusted boundary, not only in the iframe.
    if (widget.preChatEnabled && !thread.identifiedAt) {
      return jsonResponse({ error: 'Complete pre-chat identification before sending a message' }, 403);
    }

    // 5. Anti-flood rate limiting
    if (!checkRateLimit(claims.threadId)) {
      return jsonResponse({ error: 'Rate limit exceeded. Max 10 messages per minute.' }, 429);
    }

    // 6. Parse body
    const body = await req.json() as { text?: string; page_url?: string };
    const text = body.text?.trim();
    if (!text) {
      return jsonResponse({ error: 'Missing text field' }, 400);
    }

    // 7. Update thread page_url and last_seen_at
    const threadRepo = new WebchatThreadRepository(db);
    const threadUpdates: Record<string, unknown> = { lastSeenAt: new Date() };
    if (body.page_url) {
      threadUpdates.pageUrl = body.page_url;
    }
    await threadRepo.update(thread.id, threadUpdates as { lastSeenAt?: Date; pageUrl?: string });

    // 8. Process inbound message
    const contactRepo = new ContactRepository(db);
    const conversationRepo = new ConversationRepository(db);
    const messageRepo = new MessageRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const jobQueue = new PostgresJobQueue(db);

    const inboundService = new InboundMessageService(
      contactRepo,
      conversationRepo,
      messageRepo,
      jobQueue,
      auditLogRepo,
    );

    const message = await inboundService.processInboundWebchat({
      conversationId: thread.conversationId,
      contactId: claims.contactId,
      body: text,
      orgId: claims.organizationId,
    });

    // 9. Publish new_message realtime event to the org channel (for agent inbox)
    const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
    await realtimePublisher.publish(`org:${claims.organizationId}`, 'new_message', {
      message,
      conversationId: thread.conversationId,
    });

    // 10. The AI job is enqueued above. The `process-jobs` function picks it
    // up on its next cron tick (currently 10 seconds — see schedules in
    // InsForge dashboard). Function-to-function triggers within the same
    // Deno deployment are blocked by 508 LOOP_DETECTED, so a direct trigger
    // from this function is not possible. A Postgres http_post-based trigger
    // was attempted but the `http` extension is unreliable in this project.
    // The 10s cron cadence is the practical equivalent of event-driven.

    // 11. Return success
    return jsonResponse({
      status: 'ok',
      data: { message, conversationId: thread.conversationId },
    });
  } catch (err) {
    console.error('webchat-inbound error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
