/**
 * send-reply — Sends a reply message on an existing conversation.
 *
 * Auth: JWT verification (Bearer token in Authorization header).
 * Delegates to: OutboundMessageService.sendReply
 *
 * Flow:
 * 1. Parse request body as JSON — expect { conversationId, body }
 * 2. Verify JWT authentication — return 401 if invalid
 * 3. Create database client, repositories, provider registry, and OutboundMessageService
 * 4. Call outboundService.sendReply(conversationId, body, userId)
 * 5. Publish new_message realtime event on org:{orgId} channel
 * 6. Return 200 OK with the message data
 *
 * Requirements: 16.1, 16.2, 16.3, 16.5
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { log, logError, newRequestContext, withRequest, withRequestIdHeader } from '../_shared/logger.js';
import { requireOrgMembership } from '../_shared/require-org-membership.js';
import { requirePermission } from '../_shared/require-permission.js';
import { getRequiredPermission } from '../_shared/endpoint-permissions.js';
import { verifyJwt } from '../_shared/verify-jwt.js';

import { ProviderRegistry } from '../../../packages/support-core/src/interfaces/provider-registry.js';
import { MockSmsAdapter } from '../../../packages/support-core/src/adapters/mock-sms-adapter.js';
import { MockEmailAdapter } from '../../../packages/support-core/src/adapters/mock-email-adapter.js';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.js';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';
import { SmsProviderAccountRepository } from '../../../packages/support-core/src/repositories/sms-provider-account-repository.js';
import { EmailProviderAccountRepository } from '../../../packages/support-core/src/repositories/email-provider-account-repository.js';
import { OutboundMessageService } from '../../../packages/support-core/src/services/outbound-message-service.js';

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
  const ctx = newRequestContext('send-reply', req);
  try {
    const response = await withRequest(ctx, async () => {
      // 1. Parse request body as JSON
      let payload: { conversationId?: string; body?: string };
      try {
        payload = await req.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const { conversationId, body } = payload;

      if (!conversationId || typeof conversationId !== 'string') {
        return jsonResponse({ error: 'Missing or invalid conversationId' }, 400);
      }

      if (!body || typeof body !== 'string') {
        return jsonResponse({ error: 'Missing or invalid body' }, 400);
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

      // 3. Create database client, repositories, provider registry, and service
      const db = createDbClient(baseUrl, serviceRoleKey);

      // CRITICAL-2: enforce org membership before any mutation. JWT alone is
      // not enough — any authenticated user in any tenant could otherwise
      // pass another tenant's conversationId and trigger real outbound
      // SMS/email. requireOrgMembership returns the conversation's
      // organizationId on success, so we reuse it for the realtime publish
      // (avoids a redundant findById).
      const membership = await requireOrgMembership(db, userId, conversationId);
      if (membership.kind === 'conversation_not_found') {
        return jsonResponse({ error: 'Conversation not found' }, 404);
      }
      if (membership.kind === 'forbidden') {
        return jsonResponse({ error: 'Forbidden: not a member of this conversation\'s organization' }, 403);
      }
      const orgId = membership.organizationId;
      ctx.org_id = orgId;

      // HIGH-1: enforce the per-endpoint RBAC permission. The map in
      // `endpoint-permissions.ts` is the single source of truth for which
      // permission this endpoint requires. Without this check, any member
      // of the org (including viewers) could call send-reply, because the
      // rbac module was previously 100% property-tested but 0% enforced
      // (see docs/QA_BUG_HUNT.md, HIGH-1).
      const permission = await requirePermission(
        db,
        userId,
        orgId,
        getRequiredPermission('send-reply'),
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
      const contactRepo = new ContactRepository(db);
      const messageRepo = new MessageRepository(db);
      const auditLogRepo = new AuditLogRepository(db);
      const smsAccountRepo = new SmsProviderAccountRepository(db);
      const emailAccountRepo = new EmailProviderAccountRepository(db);

      // Register both mock SMS and email adapters since the conversation
      // could be on either channel
      const registry = new ProviderRegistry();
      registry.registerSmsAdapter('mock', new MockSmsAdapter());
      registry.registerEmailAdapter('mock', new MockEmailAdapter());

      const outboundService = new OutboundMessageService(
        conversationRepo,
        contactRepo,
        messageRepo,
        registry,
        smsAccountRepo,
        emailAccountRepo,
        auditLogRepo,
      );

      // 4. Send the reply
      const message = await outboundService.sendReply(conversationId, body, userId);
      log({ ...ctx, level: 'info', msg: 'reply sent', message_id: message.id });

      // 5. Publish new_message realtime event on the org channel we
      // already validated the caller is a member of.
      if (orgId) {
        const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
        await realtimePublisher.publish(`org:${orgId}`, 'new_message', {
          message,
          conversationId: message.conversationId,
        });
      }

      // 6. Return 200 OK with the message data
      return jsonResponse({ status: 'ok', data: message });
    });
    return withRequestIdHeader(ctx, response);
  } catch (err) {
    // withRequest already emitted a structured `error` event with the
    // serialized stack. This catch only shapes the HTTP response.
    return jsonResponse(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
}
