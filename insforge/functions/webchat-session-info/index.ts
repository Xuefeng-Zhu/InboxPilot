/**
 * webchat-session-info — Returns thread, contact, and message history for thread resumption.
 *
 * Auth: Visitor JWT via Authorization: Bearer header.
 * Used by the widget iframe on reload to restore prior messages.
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { verifyVisitorJwt } from '../_shared/verify-visitor-jwt.ts';
import { handleCorsPreFlight, corsJsonResponse } from '../_shared/cors.ts';

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
    if (req.method !== 'GET') {
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

    const { claims, thread } = verified;

    // 3. Fetch contact info
    const { data: contactData } = await db
      .from('contacts')
      .select('id,name,email,phone')
      .eq('id', claims.contactId)
      .maybeSingle();

    // 4. Fetch message history
    const { data: messagesData } = await db
      .from('messages')
      .select('id,body,sender_type,direction,created_at')
      .eq('conversation_id', thread.conversationId)
      .order('created_at', { ascending: true })
      .limit(100);

    const history = Array.isArray(messagesData) ? messagesData : [];

    // 5. Return
    return jsonResponse({
      status: 'ok',
      data: {
        thread: {
          id: thread.id,
          conversationId: thread.conversationId,
          pageUrl: thread.pageUrl,
          identifiedAt: thread.identifiedAt,
        },
        contact: contactData,
        history,
      },
    });
  } catch (err) {
    console.error('webchat-session-info error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
