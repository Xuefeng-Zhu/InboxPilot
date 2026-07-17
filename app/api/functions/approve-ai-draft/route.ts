import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { publishRealtimeMessage } from '@/lib/realtime-publisher';
import { assertInsforgeSuccess } from '@/lib/insforge-result';
import { readRequestJsonObject } from '@/lib/http-json';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { OutboundMessagePostDispatchError } from '@support-core/services/outbound-message-service';
import { ProviderSendOutcomeUnknownError } from '@support-core/adapters/provider-send-outcome-unknown-error';
import type { Message } from '@support-core/types';
import {
  createOutboundMessageService,
  resolveOutboundProviderConfig,
  writeDispatchReconciliationAudit,
} from '../_outbound-service';

async function transitionClaimedDraft(
  conversationId: string,
  aiState: 'drafted' | 'idle',
  context: string,
): Promise<void> {
  // A provider send may already have succeeded when the state transition is
  // attempted. Retry one transient database failure so the conversation does
  // not remain stranded in the internal `thinking` claim state.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await insforge.database
        .from('conversations')
        .update({ ai_state: aiState })
        .eq('id', conversationId)
        .eq('ai_state', 'thinking');
      if (!result.error) return;
      if (attempt === 1) {
        assertInsforgeSuccess(result, context);
      }
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
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
    const { conversationId, aiDecisionId, body: bodyOverride } = requestBody;
    if (typeof conversationId !== 'string' || typeof aiDecisionId !== 'string') {
      return NextResponse.json({ error: 'Missing conversationId or aiDecisionId' }, { status: 400 });
    }
    if (bodyOverride !== undefined && (typeof bodyOverride !== 'string' || bodyOverride.trim() === '')) {
      return NextResponse.json({ error: 'body override must be a non-empty string when provided' }, { status: 400 });
    }

    // Load AI decision
    const decisionResult = await insforge.database
      .from('ai_decisions')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('id', aiDecisionId)
      .order('created_at', { ascending: false })
      .limit(1);
    assertInsforgeSuccess(decisionResult, 'approve-ai-draft failed to load AI decision');
    const { data: decisions } = decisionResult;

    const decision = Array.isArray(decisions) ? decisions[0] : decisions;
    if (!decision || !decision.response_text) {
      return NextResponse.json({ error: 'AI decision not found or has no response' }, { status: 404 });
    }

    // Load conversation
    const conversationResult = await insforge.database
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .limit(1);
    assertInsforgeSuccess(conversationResult, 'approve-ai-draft failed to load conversation');
    const { data: convo } = conversationResult;

    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const allowed = await userHasOrgPermission(
      user.id,
      conversation.organization_id as string,
      'reply_conversations',
    );
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const approvedBody = bodyOverride ?? decision.response_text;
    const providerConfig = await resolveOutboundProviderConfig(
      conversation.organization_id as string,
      conversation.channel as string,
    );

    // Atomically claim the draft before contacting an external provider. Two
    // approval requests can otherwise both send the same SMS/email before
    // either request clears the draft.
    const claimResult = await insforge.database
      .from('conversations')
      .update({ ai_state: 'thinking' })
      .eq('id', conversationId)
      .eq('ai_state', 'drafted')
      .select('id');
    assertInsforgeSuccess(claimResult, 'approve-ai-draft failed to claim draft');
    const claimedRows = Array.isArray(claimResult.data)
      ? claimResult.data
      : claimResult.data
        ? [claimResult.data]
        : [];
    if (claimedRows.length === 0) {
      return NextResponse.json(
        { error: 'Draft is already being sent or is no longer pending' },
        { status: 409 },
      );
    }

    const outboundService = createOutboundMessageService();
    const warnings: string[] = [];
    let postDispatchError: OutboundMessagePostDispatchError | null = null;
    let approvalAuditRecorded = false;

    // The outbound service performs the real provider dispatch before this
    // route clears the pending draft. A provider failure therefore leaves the
    // draft available for retry.
    let message: Message | null = null;
    try {
      message = await outboundService.sendReply(
        conversationId,
        approvedBody,
        { type: 'ai', id: user.id },
        providerConfig,
        { writeAuditLog: false },
      );
    } catch (sendError) {
      const providerAccepted = sendError instanceof OutboundMessagePostDispatchError;
      const providerOutcomeUnknown = sendError instanceof ProviderSendOutcomeUnknownError;
      const retryUnsafe = providerAccepted || providerOutcomeUnknown;
      try {
        await transitionClaimedDraft(
          conversationId,
          retryUnsafe ? 'idle' : 'drafted',
          retryUnsafe
            ? 'approve-ai-draft failed to clear draft after post-dispatch failure'
            : 'approve-ai-draft failed to restore draft after provider failure',
        );
      } catch (transitionError) {
        if (retryUnsafe) {
          const detail = transitionError instanceof Error
            ? transitionError.message
            : String(transitionError);
          warnings.push(`Reply was accepted, but the draft state could not be cleared: ${detail}`);
        }
        console.error(
          retryUnsafe
            ? 'approve-ai-draft: failed to clear draft after post-dispatch failure'
            : 'approve-ai-draft: failed to restore draft after provider failure',
          transitionError instanceof Error
            ? transitionError.message
            : String(transitionError),
        );
      }
      if (!retryUnsafe) throw sendError;

      if (providerOutcomeUnknown) {
        warnings.push(
          `The ${sendError.providerId} request outcome is unknown; automatic retry was suppressed to avoid a duplicate reply.`,
        );
        const reconciliationError = await writeDispatchReconciliationAudit({
          organizationId: conversation.organization_id,
          actorId: user.id,
          action: 'ai_draft_approved',
          resourceType: 'ai_decision',
          resourceId: aiDecisionId,
          metadata: {
            conversationId,
            messageId: null,
            body_preview: approvedBody.slice(0, 200),
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
        return NextResponse.json(
          { status: 'accepted', warning: warnings.join(' '), data: { message: null } },
          { status: 202 },
        );
      }

      postDispatchError = sendError;
      warnings.push(sendError.message);
      message = sendError.dispatchedMessage;
      const reconciliationError = await writeDispatchReconciliationAudit({
        organizationId: conversation.organization_id,
        actorId: user.id,
        action: 'ai_draft_approved',
        resourceType: 'ai_decision',
        resourceId: aiDecisionId,
        metadata: {
          conversationId,
          messageId: message?.id ?? null,
          body_preview: approvedBody.slice(0, 200),
          reconciliationRequired: true,
          finalizationStage: sendError.stage,
          dispatchReceipt: sendError.receipt,
        },
      });
      approvalAuditRecorded = reconciliationError === null;
      if (reconciliationError) {
        warnings.push(`Dispatch reconciliation audit failed: ${reconciliationError}`);
        console.error(
          'approve-ai-draft: failed to persist dispatch reconciliation audit',
          reconciliationError,
        );
      }
      if (!message) {
        return NextResponse.json(
          { status: 'accepted', warning: warnings.join(' '), data: { message: null } },
          { status: 202 },
        );
      }
    }

    // Clear the draft only after provider delivery and message persistence.
    try {
      await transitionClaimedDraft(
        conversationId,
        'idle',
        'approve-ai-draft failed to update conversation',
      );
    } catch (transitionError) {
      const warning = transitionError instanceof Error
        ? transitionError.message
        : String(transitionError);
      warnings.push(`Reply was accepted, but the draft state could not be cleared: ${warning}`);
      console.error('approve-ai-draft: failed to clear accepted draft', warning);
    }

    // For webchat: publish to the visitor's realtime channel
    if (conversation.channel === 'webchat') {
      let thread: { widget_id: string; visitor_token_jti: string } | undefined;
      try {
        const threadResult = await insforge.database
          .from('webchat_threads')
          .select('widget_id,visitor_token_jti')
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
            'approve-ai-draft: failed to publish webchat realtime message',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // The reconciliation helper already wrote the approval audit for a typed
    // post-dispatch failure. Otherwise write the normal approval event here.
    if (!approvalAuditRecorded) {
      try {
        const auditResult = await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: conversation.organization_id,
            actor_id: user.id,
            actor_type: 'user',
            action: 'ai_draft_approved',
            resource_type: 'ai_decision',
            resource_id: aiDecisionId,
            metadata: {
              conversationId,
              messageId: message.id,
              body_preview: approvedBody.slice(0, 200),
              ...(postDispatchError
                ? {
                    reconciliationRequired: true,
                    finalizationStage: postDispatchError.stage,
                    dispatchReceipt: postDispatchError.receipt,
                  }
                : {}),
            },
          }]);
        if (auditResult.error) {
          warnings.push(`Reply was accepted, but its approval audit failed: ${auditResult.error.message}`);
          console.error('approve-ai-draft: failed to write approval audit', auditResult.error.message);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        warnings.push(`Reply was accepted, but its approval audit failed: ${detail}`);
        console.error('approve-ai-draft: failed to write approval audit', detail);
      }
    }

    return NextResponse.json(
      {
        status: warnings.length > 0 ? 'accepted' : 'ok',
        data: { message },
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
