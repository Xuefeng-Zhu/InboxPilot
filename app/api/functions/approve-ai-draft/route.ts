import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getSecret } from '@/lib/insforge-secrets';
import { publishRealtimeMessage } from '@/lib/realtime-publisher';
import { assertInsforgeSuccess } from '@/lib/insforge-result';
import { createProviderRegistry } from '@/lib/provider-registry';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { createInsforgeDbAdapter } from '../_insforge-db-adapter';
import { OutboundMessageService } from '@support-core/services/outbound-message-service';
import { ConversationRepository } from '@support-core/repositories/conversation-repository';
import { ContactRepository } from '@support-core/repositories/contact-repository';
import { MessageRepository } from '@support-core/repositories/message-repository';
import { SmsProviderAccountRepository } from '@support-core/repositories/sms-provider-account-repository';
import { EmailProviderAccountRepository } from '@support-core/repositories/email-provider-account-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';

interface SmsAccountRow {
  provider: string;
  credentials_secret_id: string;
  is_active: boolean;
}

interface EmailAccountRow {
  provider: string;
  credentials_secret_id: string;
  is_active: boolean;
}

async function transitionClaimedDraft(
  conversationId: string,
  aiState: 'drafted' | 'idle',
  context: string,
): Promise<void> {
  // A provider send may already have succeeded when the state transition is
  // attempted. Retry one transient database failure so the conversation does
  // not remain stranded in the internal `thinking` claim state.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await insforge.database
      .from('conversations')
      .update({ ai_state: aiState })
      .eq('id', conversationId)
      .eq('ai_state', 'thinking');
    if (!result.error) return;
    if (attempt === 1) {
      assertInsforgeSuccess(result, context);
    }
  }
}

async function loadProviderConfig(
  organizationId: string,
  channel: string,
): Promise<Record<string, unknown>> {
  if (channel === 'sms') {
    const { data: phoneData } = await insforge.database
      .from('sms_phone_numbers')
      .select('provider_account_id')
      .eq('organization_id', organizationId)
      .eq('is_default', true)
      .limit(1);
    const phone = (Array.isArray(phoneData) ? phoneData[0] : phoneData) as
      | { provider_account_id: string }
      | undefined;
    if (!phone) return {};

    const { data: accountData } = await insforge.database
      .from('sms_provider_accounts')
      .select('provider, credentials_secret_id, is_active')
      .eq('id', phone.provider_account_id)
      .limit(1);
    const account = (Array.isArray(accountData) ? accountData[0] : accountData) as
      | SmsAccountRow
      | undefined;
    if (!account || !account.is_active || account.provider === 'mock') return {};

    return await getSecret<Record<string, unknown>>(account.credentials_secret_id) ?? {};
  }

  if (channel === 'email') {
    const { data: addressData } = await insforge.database
      .from('email_addresses')
      .select('provider_account_id')
      .eq('organization_id', organizationId)
      .eq('is_default', true)
      .limit(1);
    const address = (Array.isArray(addressData) ? addressData[0] : addressData) as
      | { provider_account_id: string }
      | undefined;
    if (!address) return {};

    const { data: accountData } = await insforge.database
      .from('email_provider_accounts')
      .select('provider, credentials_secret_id, is_active')
      .eq('id', address.provider_account_id)
      .limit(1);
    const account = (Array.isArray(accountData) ? accountData[0] : accountData) as
      | EmailAccountRow
      | undefined;
    if (!account || !account.is_active || account.provider === 'mock') return {};

    return await getSecret<Record<string, unknown>>(account.credentials_secret_id) ?? {};
  }

  return {};
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId, aiDecisionId, body: bodyOverride } = await req.json();
    if (!conversationId || !aiDecisionId) {
      return NextResponse.json({ error: 'Missing conversationId or aiDecisionId' }, { status: 400 });
    }
    if (bodyOverride !== undefined && (typeof bodyOverride !== 'string' || bodyOverride.trim() === '')) {
      return NextResponse.json({ error: 'body override must be a non-empty string when provided' }, { status: 400 });
    }

    // Load AI decision
    const { data: decisions } = await insforge.database
      .from('ai_decisions')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('id', aiDecisionId)
      .order('created_at', { ascending: false })
      .limit(1);

    const decision = Array.isArray(decisions) ? decisions[0] : decisions;
    if (!decision || !decision.response_text) {
      return NextResponse.json({ error: 'AI decision not found or has no response' }, { status: 404 });
    }

    // Load conversation
    const { data: convo } = await insforge.database
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .limit(1);

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
    const providerConfig = await loadProviderConfig(
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

    const db = createInsforgeDbAdapter();
    const outboundService = new OutboundMessageService(
      new ConversationRepository(db),
      new ContactRepository(db),
      new MessageRepository(db),
      createProviderRegistry(),
      new SmsProviderAccountRepository(db),
      new EmailProviderAccountRepository(db),
      new AuditLogRepository(db),
    );

    // The outbound service performs the real provider dispatch before this
    // route clears the pending draft. A provider failure therefore leaves the
    // draft available for retry.
    let message;
    try {
      message = await outboundService.sendReply(
        conversationId,
        approvedBody,
        { type: 'ai', id: user.id },
        providerConfig,
        { writeAuditLog: false },
      );
    } catch (sendError) {
      try {
        await transitionClaimedDraft(
          conversationId,
          'drafted',
          'approve-ai-draft failed to restore draft after send failure',
        );
      } catch (restoreError) {
        console.error(
          'approve-ai-draft: failed to restore draft after send failure',
          restoreError instanceof Error ? restoreError.message : String(restoreError),
        );
      }
      throw sendError;
    }

    // Clear the draft only after provider delivery and message persistence.
    await transitionClaimedDraft(
      conversationId,
      'idle',
      'approve-ai-draft failed to update conversation',
    );

    // For webchat: publish to the visitor's realtime channel
    if (conversation.channel === 'webchat') {
      const { data: threadData } = await insforge.database
        .from('webchat_threads')
        .select('widget_id,visitor_token_jti')
        .eq('conversation_id', conversationId)
        .limit(1);

      const thread = Array.isArray(threadData) ? threadData[0] : threadData;
      if (thread) {
        try {
          await publishRealtimeMessage(
            `widget:${thread.widget_id}:${thread.visitor_token_jti}`,
            'new_message',
            { message, conversationId },
          );
        } catch (err) {
          console.warn(
            'approve-ai-draft: failed to publish webchat realtime message',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // Audit log
    const auditResult = await insforge.database
      .from('audit_logs')
      .insert([{
        organization_id: conversation.organization_id,
        actor_id: user.id,
        actor_type: 'user',
        action: 'ai_draft_approved',
        resource_type: 'ai_decision',
        resource_id: aiDecisionId,
        metadata: { conversationId, messageId: message.id, body_preview: approvedBody.slice(0, 200) },
      }]);
    assertInsforgeSuccess(auditResult, 'approve-ai-draft failed to write audit log');

    return NextResponse.json({ status: 'ok', data: { message } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
