/**
 * webchat-identify — Identify a visitor by email/name.
 *
 * Auth: Visitor JWT via Authorization: Bearer header.
 * Calls WebchatThreadService.identifyThread, which rotates the visitor token JTI.
 * Returns a new visitor JWT (the old one is invalidated).
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { verifyVisitorJwt, signVisitorJwt } from '../_shared/verify-visitor-jwt.ts';
import { handleCorsPreFlight, corsJsonResponse } from '../_shared/cors.ts';

import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { WebchatWidgetRepository } from '../../../packages/support-core/src/repositories/webchat-widget-repository.ts';
import { WebchatThreadRepository } from '../../../packages/support-core/src/repositories/webchat-thread-repository.ts';
import { WebchatThreadService } from '../../../packages/support-core/src/services/webchat-thread-service.ts';

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

    // 3. Parse body
    const body = await req.json() as { email?: string; name?: string };
    if (!body.email?.trim()) {
      return jsonResponse({ error: 'Missing email field' }, 400);
    }

    // 4. Identify thread
    const contactRepo = new ContactRepository(db);
    const conversationRepo = new ConversationRepository(db);
    const widgetRepo = new WebchatWidgetRepository(db);
    const threadRepo = new WebchatThreadRepository(db);
    const auditLogRepo = new AuditLogRepository(db);

    const threadService = new WebchatThreadService(
      contactRepo,
      conversationRepo,
      widgetRepo,
      threadRepo,
      auditLogRepo,
    );

    const result = await threadService.identifyThread(thread.id, {
      email: body.email.trim(),
      name: body.name?.trim(),
    });

    // 5. Sign new visitor JWT with the rotated JTI
    const newVisitorToken = await signVisitorJwt(
      {
        contactId: claims.contactId,
        organizationId: claims.organizationId,
        widgetId: claims.widgetId,
        threadId: claims.threadId,
        jti: result.newJti,
      },
      widget.hmacSecret,
    );

    return jsonResponse({
      status: 'ok',
      data: {
        visitorToken: newVisitorToken,
        contact: {
          id: result.contact.id,
          name: result.contact.name,
          email: result.contact.email,
        },
      },
    });
  } catch (err) {
    console.error('webchat-identify error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
