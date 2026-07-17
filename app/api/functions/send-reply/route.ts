/**
 * POST /api/functions/send-reply
 *
 * Body: { conversationId: string, body: string }
 * Required permission: 'reply_conversations'
 *
 * Delegates message persistence, provider dispatch, audit logging, and
 * conversation timestamp updates to OutboundMessageService.sendReply.
 *
 * The route is responsible for:
 *  - auth + RBAC (via _auth.ts)
 *  - resolving the conversation → org → channel
 *  - loading per-channel provider credentials from the InsForge secrets
 *    store and passing them as `providerConfig` to the service
 *  - constructing the support-core dependency graph (repos + ProviderRegistry)
 *  - the webchat realtime broadcast (support-core deliberately leaves all
 *    realtime delivery to its runtime caller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRequestJsonObject } from '@/lib/http-json';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { publishRealtimeMessage } from '@/lib/realtime-publisher';
import { assertInsforgeSuccess } from '@/lib/insforge-result';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { OutboundMessagePostDispatchError } from '@support-core/services/outbound-message-service';
import { ProviderSendOutcomeUnknownError } from '@support-core/adapters/provider-send-outcome-unknown-error';
import type { Message } from '@support-core/types';
import {
  createOutboundMessageService,
  resolveOutboundProviderConfig,
  writeDispatchReconciliationAudit,
} from '../_outbound-service';

// ─── Route handler ────────────────────────────────────────────────

async function clearDraftState(conversationId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await insforge.database
        .from('conversations')
        .update({ ai_state: 'idle' })
        .eq('id', conversationId);
      if (!result.error) return null;
      if (attempt === 1) {
        return `Reply was accepted, but the draft state could not be cleared: ${result.error.message}`;
      }
    } catch (error) {
      if (attempt === 1) {
        const detail = error instanceof Error ? error.message : String(error);
        return `Reply was accepted, but the draft state could not be cleared: ${detail}`;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const requestBody = await readRequestJsonObject(req);
    if (!requestBody) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { conversationId, body } = requestBody;

    if (typeof conversationId !== 'string' || typeof body !== 'string') {
      return NextResponse.json(
        { error: 'Missing conversationId or body' },
        { status: 400 },
      );
    }

    // Load conversation to determine org + channel (and for RBAC).
    const conversationResult = await insforge.database
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .limit(1);
    assertInsforgeSuccess(conversationResult, 'send-reply failed to load conversation');
    const { data: convo } = conversationResult;
    const conversation = (Array.isArray(convo) ? convo[0] : convo) as
      | { id: string; organization_id: string; channel: string }
      | undefined;

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const allowed = await userHasOrgPermission(
      user.id,
      conversation.organization_id,
      'reply_conversations',
    );
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const providerConfig = await resolveOutboundProviderConfig(
      conversation.organization_id,
      conversation.channel,
    );
    const outboundService = createOutboundMessageService();
    const warnings: string[] = [];
    let message: Message | null = null;
    try {
      message = await outboundService.sendReply(
        conversationId,
        body,
        { type: 'user', id: user.id },
        providerConfig,
      );
    } catch (sendError) {
      if (sendError instanceof ProviderSendOutcomeUnknownError) {
        warnings.push(
          `The ${sendError.providerId} request outcome is unknown; automatic retry was suppressed to avoid a duplicate reply.`,
        );
        const reconciliationError = await writeDispatchReconciliationAudit({
          organizationId: conversation.organization_id,
          actorId: user.id,
          action: 'message_sent',
          resourceType: 'message',
          resourceId: null,
          metadata: {
            conversationId,
            reconciliationRequired: true,
            providerOutcomeUnknown: true,
            provider: sendError.providerId,
            failureStage: sendError.stage,
            error: sendError.message,
          },
        });
        if (reconciliationError) {
          warnings.push(`Dispatch reconciliation audit failed: ${reconciliationError}`);
        }
        const draftWarning = await clearDraftState(conversationId);
        if (draftWarning) warnings.push(draftWarning);
        return NextResponse.json(
          { status: 'accepted', warning: warnings.join(' '), data: null },
          { status: 202 },
        );
      }
      if (!(sendError instanceof OutboundMessagePostDispatchError)) throw sendError;
      warnings.push(sendError.message);
      message = sendError.dispatchedMessage;
      const reconciliationError = await writeDispatchReconciliationAudit({
        organizationId: conversation.organization_id,
        actorId: user.id,
        action: 'message_sent',
        resourceType: 'message',
        resourceId: message?.id ?? null,
        metadata: {
          conversationId,
          reconciliationRequired: true,
          finalizationStage: sendError.stage,
          dispatchReceipt: sendError.receipt,
        },
      });
      if (reconciliationError) {
        warnings.push(`Dispatch reconciliation audit failed: ${reconciliationError}`);
        console.error(
          'send-reply: failed to persist dispatch reconciliation audit',
          reconciliationError,
        );
      }
      if (!message) {
        const draftWarning = await clearDraftState(conversationId);
        if (draftWarning) warnings.push(draftWarning);
        return NextResponse.json(
          { status: 'accepted', warning: warnings.join(' '), data: null },
          { status: 202 },
        );
      }
    }

    // Webchat realtime broadcast — preserve the previous route's behavior.
    // OutboundMessageService's webchat branch is a no-op because we did not
    // inject `webchatThreadRepo` / `realtimePublisher`, so this is the only
    // publish path. Best-effort: failures are logged without failing the reply.
    if (conversation.channel === 'webchat') {
      let thread: { widget_id: string; visitor_token_jti: string } | undefined;
      try {
        const threadResult = await insforge.database
          .from('webchat_threads')
          .select('widget_id, visitor_token_jti')
          .eq('conversation_id', conversationId)
          .limit(1);
        if (threadResult.error) {
          warnings.push(`Realtime recipient lookup failed: ${threadResult.error.message}`);
        }
        const { data: threadData } = threadResult;
        thread = (Array.isArray(threadData) ? threadData[0] : threadData) as
          | { widget_id: string; visitor_token_jti: string }
          | undefined;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        warnings.push(`Realtime recipient lookup failed: ${detail}`);
      }

      if (thread) {
        try {
          await publishRealtimeMessage(
            `widget:${thread.widget_id}:${thread.visitor_token_jti}`,
            'new_message',
            { message, conversationId },
          );
        } catch (err) {
          warnings.push('Realtime delivery failed; the persisted reply will be recovered by refresh.');
          console.warn(
            'send-reply: failed to publish webchat realtime message',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // Agent reply consumes any pending AI draft — clear ai_state so the
    // AiDraftPanel + DRAFTED header pill stop rendering. Mirrors the
    // approve-ai-draft flow at app/api/functions/approve-ai-draft/route.ts:78-81.
    // (OutboundMessageService.sendReply already updates last_message_at.)
    const draftWarning = await clearDraftState(conversationId);
    if (draftWarning) warnings.push(draftWarning);

    return NextResponse.json(
      {
        status: warnings.length > 0 ? 'accepted' : 'ok',
        data: message,
        ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
      },
      { status: warnings.length > 0 ? 202 : 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
