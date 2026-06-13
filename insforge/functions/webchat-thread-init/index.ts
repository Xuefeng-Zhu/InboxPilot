/**
 * webchat-thread-init — Initialize a webchat session for a visitor.
 *
 * Auth: Widget token via x-widget-token header (public identifier).
 * Origin: Verified against widget's allowed_domains.
 *
 * Creates a contact, conversation, and webchat thread; returns a visitor JWT.
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { signVisitorJwt } from '../_shared/verify-visitor-jwt.ts';
import { handleCorsPreFlight, corsJsonResponse } from '../_shared/cors.ts';

import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { WebchatWidgetRepository } from '../../../packages/support-core/src/repositories/webchat-widget-repository.ts';
import { WebchatThreadRepository } from '../../../packages/support-core/src/repositories/webchat-thread-repository.ts';
import { WebchatThreadService } from '../../../packages/support-core/src/services/webchat-thread-service.ts';

import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return corsJsonResponse(body, status);
}

function checkOriginAllowed(req: Request, allowedDomains: string[]): boolean {
  // Empty allowedDomains = allow all (dev mode)
  if (allowedDomains.length === 0) return true;

  const origin = req.headers.get('origin') ?? '';
  if (!origin) return true; // No origin header (non-browser request) — allow

  try {
    const originHost = new URL(origin).hostname;
    return allowedDomains.some((domain) => {
      // Support wildcard subdomains: *.example.com
      if (domain.startsWith('*.')) {
        const base = domain.slice(2);
        return originHost === base || originHost.endsWith(`.${base}`);
      }
      return originHost === domain || origin === domain;
    });
  } catch {
    return false;
  }
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

    // 1. Extract widget token
    const widgetToken = req.headers.get('x-widget-token');
    if (!widgetToken) {
      return jsonResponse({ error: 'Missing x-widget-token header' }, 400);
    }

    // 2. Create DB client
    const baseUrl =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
      process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
    const serviceRoleKey =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ?? '';

    const db = createDbClient(baseUrl, serviceRoleKey);

    // 3. Look up widget
    const widgetRepo = new WebchatWidgetRepository(db);
    const widget = await widgetRepo.findByWidgetToken(widgetToken);

    if (!widget || !widget.isActive) {
      return jsonResponse({ error: 'Invalid or inactive widget' }, 404);
    }

    // 4. Origin allowlist check
    if (!checkOriginAllowed(req, widget.allowedDomains)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403);
    }

    // 5. Parse request body
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is OK for thread init
    }

    const pageUrl = (body.page_url as string) ?? null;
    const referrer = (body.referrer as string) ?? null;
    const userAgent = (body.user_agent as string) ?? req.headers.get('user-agent') ?? null;
    const preChat = body.pre_chat as { name?: string; email?: string } | undefined;

    // 6. Create repositories and service
    const contactRepo = new ContactRepository(db);
    const conversationRepo = new ConversationRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const threadRepo = new WebchatThreadRepository(db);

    const threadService = new WebchatThreadService(
      contactRepo,
      conversationRepo,
      widgetRepo,
      threadRepo,
      auditLogRepo,
    );

    // 7. Init thread
    const result = await threadService.initThread({
      widgetId: widget.id,
      organizationId: widget.organizationId,
      pageUrl,
      referrer,
      userAgent,
      preChat,
    });

    // 8. Sign visitor JWT
    const visitorToken = await signVisitorJwt(
      {
        contactId: result.contact.id,
        organizationId: widget.organizationId,
        widgetId: widget.id,
        threadId: result.thread.id,
        jti: result.visitorTokenJti,
      },
      widget.hmacSecret,
    );

    // 9. Fetch message history for the conversation (for thread resumption)
    const { data: historyData } = await db
      .from('messages')
      .select('id,body,sender_type,created_at')
      .eq('conversation_id', result.conversation.id)
      .order('created_at', { ascending: true })
      .limit(50);

    const history = Array.isArray(historyData) ? historyData : [];

    // 10. If widget has a greeting and no messages exist, insert greeting as system message
    if (widget.greeting && history.length === 0) {
      const greetingCreatedAt = new Date().toISOString();
      await db.from('messages').insert({
        conversation_id: result.conversation.id,
        sender_type: 'system',
        direction: 'outbound',
        channel: 'webchat',
        body: widget.greeting,
        provider: 'webchat',
        external_message_id: `wc_greeting_${result.thread.id}`,
        delivery_status: 'sent',
        created_at: greetingCreatedAt,
      });

      await db
        .from('conversations')
        .update({
          last_message_at: greetingCreatedAt,
          updated_at: greetingCreatedAt,
        })
        .eq('id', result.conversation.id);

      history.push({
        id: 'greeting',
        body: widget.greeting,
        sender_type: 'system',
        created_at: greetingCreatedAt,
      });
    }

    return jsonResponse({
      status: 'ok',
      data: {
        visitorToken,
        threadId: result.thread.id,
        conversationId: result.conversation.id,
        contactId: result.contact.id,
        preChatEnabled: widget.preChatEnabled,
        history,
      },
    });
  } catch (err) {
    console.error('webchat-thread-init error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
