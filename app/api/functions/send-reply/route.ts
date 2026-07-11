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
 *  - the webchat realtime broadcast (the service skips it when no
 *    RealtimePublisher is injected — see OutboundMessageService webchat
 *    branch which gates on `webchatThreadRepo && realtimePublisher`)
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRequestJsonObject } from '@/lib/http-json';
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

// ─── Helpers ───────────────────────────────────────────────────────

interface SmsAccountRow {
  id: string;
  organization_id: string;
  provider: string;
  credentials_secret_id: string;
  is_active: boolean;
}

interface EmailAccountRow {
  id: string;
  organization_id: string;
  provider: string;
  credentials_secret_id: string;
  is_active: boolean;
}

/**
 * Find the default SMS phone number for the org, look up its provider
 * account, and load the secret payload to pass to the SMS adapter.
 *
 * Returns an empty object when:
 *  - no default phone is configured for the org
 *  - the provider is 'mock' (the mock adapter ignores providerConfig)
 *  - the provider account is inactive (`is_active = false` — the
 *    legitimate kill switch to disable a broken account without deleting)
 *  - the secret returns 404 (caller decides how to handle — empty
 *    config is the safe default and matches the prior `providerConfig: {}`
 *    behavior the route had)
 */
async function loadSmsProviderConfig(
  organizationId: string,
): Promise<Record<string, unknown>> {
  // 1. Find the default phone for the org.
  const { data: phoneData } = await insforge.database
    .from('sms_phone_numbers')
    .select('provider_account_id')
    .eq('organization_id', organizationId)
    .eq('is_default', true)
    .limit(1);
  const phoneRow = (Array.isArray(phoneData) ? phoneData[0] : phoneData) as
    | { provider_account_id: string }
    | undefined;
  if (!phoneRow) return {};

  // 2. Look up the provider account (could also be done in one query via
  //    `!inner` join, but the postgrest-js types treat embedded joins as
  //    arrays, which complicates narrowing — two queries is clearer here).
  const { data: acctData } = await insforge.database
    .from('sms_provider_accounts')
    .select('id, organization_id, provider, credentials_secret_id, is_active')
    .eq('id', phoneRow.provider_account_id)
    .limit(1);
  const account = (Array.isArray(acctData) ? acctData[0] : acctData) as
    | SmsAccountRow
    | undefined;
  if (!account || !account.is_active || account.provider === 'mock') return {};

  // 3. Load the credentials.
  const secret = await getSecret<Record<string, unknown>>(account.credentials_secret_id);
  return secret ?? {};
}

async function loadEmailProviderConfig(
  organizationId: string,
): Promise<Record<string, unknown>> {
  // 1. Find the default email address for the org.
  const { data: addrData } = await insforge.database
    .from('email_addresses')
    .select('provider_account_id')
    .eq('organization_id', organizationId)
    .eq('is_default', true)
    .limit(1);
  const addrRow = (Array.isArray(addrData) ? addrData[0] : addrData) as
    | { provider_account_id: string }
    | undefined;
  if (!addrRow) return {};

  // 2. Look up the provider account.
  const { data: acctData } = await insforge.database
    .from('email_provider_accounts')
    .select('id, organization_id, provider, credentials_secret_id, is_active')
    .eq('id', addrRow.provider_account_id)
    .limit(1);
  const account = (Array.isArray(acctData) ? acctData[0] : acctData) as
    | EmailAccountRow
    | undefined;
  if (!account || !account.is_active || account.provider === 'mock') return {};

  // 3. Load the credentials.
  const secret = await getSecret<Record<string, unknown>>(account.credentials_secret_id);
  return secret ?? {};
}

// ─── Route handler ────────────────────────────────────────────────

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
    const { data: convo } = await insforge.database
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .limit(1);
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

    // Load per-channel provider credentials (mock skips the secret fetch).
    let providerConfig: Record<string, unknown> = {};
    if (conversation.channel === 'sms') {
      providerConfig = await loadSmsProviderConfig(conversation.organization_id);
    } else if (conversation.channel === 'email') {
      providerConfig = await loadEmailProviderConfig(conversation.organization_id);
    }
    // webchat: no provider, no secret — pass `{}`.

    // Build the support-core dependency graph.
    const db = createInsforgeDbAdapter();
    const registry = createProviderRegistry();
    const conversationRepo = new ConversationRepository(db);
    const contactRepo = new ContactRepository(db);
    const messageRepo = new MessageRepository(db);
    const smsAccountRepo = new SmsProviderAccountRepository(db);
    const emailAccountRepo = new EmailProviderAccountRepository(db);
    const auditLogRepo = new AuditLogRepository(db);

    const outboundService = new OutboundMessageService(
      conversationRepo,
      contactRepo,
      messageRepo,
      registry,
      smsAccountRepo,
      emailAccountRepo,
      auditLogRepo,
      // webchatThreadRepo and realtimePublisher intentionally NOT passed —
      // the route owns the webchat realtime publish (see below) to keep
      // the service free of broadcast concerns and to avoid double-publish.
    );

    const message = await outboundService.sendReply(
      conversationId,
      body,
      { type: 'user', id: user.id },
      providerConfig,
    );

    // Webchat realtime broadcast — preserve the previous route's behavior.
    // OutboundMessageService's webchat branch is a no-op because we did not
    // inject `webchatThreadRepo` / `realtimePublisher`, so this is the only
    // publish path. Best-effort: failures are logged without failing the reply.
    if (conversation.channel === 'webchat') {
      const { data: threadData } = await insforge.database
        .from('webchat_threads')
        .select('widget_id, visitor_token_jti')
        .eq('conversation_id', conversationId)
        .limit(1);

      const thread = (Array.isArray(threadData) ? threadData[0] : threadData) as
        | { widget_id: string; visitor_token_jti: string }
        | undefined;

      if (thread) {
        try {
          await publishRealtimeMessage(
            `widget:${thread.widget_id}:${thread.visitor_token_jti}`,
            'new_message',
            { message, conversationId },
          );
        } catch (err) {
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
    const clearDraftResult = await insforge.database
      .from('conversations')
      .update({ ai_state: 'idle' })
      .eq('id', conversationId);
    assertInsforgeSuccess(clearDraftResult, 'send-reply failed to clear AI draft state');

    return NextResponse.json({ status: 'ok', data: message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
