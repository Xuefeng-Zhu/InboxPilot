import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getSecret } from '@/lib/insforge-secrets';
import { createProviderRegistry } from '@/lib/provider-registry';
import { createInsforgeDbAdapter } from './_insforge-db-adapter';
import { OutboundMessageService } from '@support-core/services/outbound-message-service';
import { resolveOutboundProviderConfig as resolveProviderConfig } from '@support-core/services/outbound-provider-config';
import { ConversationRepository } from '@support-core/repositories/conversation-repository';
import { ContactRepository } from '@support-core/repositories/contact-repository';
import { MessageRepository } from '@support-core/repositories/message-repository';
import { SmsProviderAccountRepository } from '@support-core/repositories/sms-provider-account-repository';
import { EmailProviderAccountRepository } from '@support-core/repositories/email-provider-account-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';

/**
 * Resolve the active default account credentials for an outbound channel.
 *
 * Mock and webchat paths are credential-free. Inactive real accounts, missing
 * real-provider secrets, and database lookup failures are surfaced explicitly
 * so callers never send with an accidental empty configuration.
 */
export async function resolveOutboundProviderConfig(
  organizationId: string,
  channel: string,
): Promise<Record<string, unknown>> {
  if (channel !== 'sms' && channel !== 'email') return {};

  const db = createInsforgeDbAdapter();
  return resolveProviderConfig(organizationId, channel, {
    smsAccountRepo: new SmsProviderAccountRepository(db),
    emailAccountRepo: new EmailProviderAccountRepository(db),
    loadSecret: (secretId) => getSecret<Record<string, unknown>>(secretId),
  });
}

/** Construct the shared support-core dependency graph used by reply routes. */
export function createOutboundMessageService(): OutboundMessageService {
  const db = createInsforgeDbAdapter();
  return new OutboundMessageService(
    new ConversationRepository(db),
    new ContactRepository(db),
    new MessageRepository(db),
    createProviderRegistry(),
    new SmsProviderAccountRepository(db),
    new EmailProviderAccountRepository(db),
    new AuditLogRepository(db),
  );
}

/** Ensure an accepted dispatch has an append-only audit row for reconciliation. */
export async function writeDispatchReconciliationAudit(input: {
  organizationId: string;
  actorId: string;
  action: 'message_sent' | 'ai_draft_approved';
  resourceType: 'message' | 'ai_decision';
  resourceId: string | null;
  metadata: Record<string, unknown>;
}): Promise<string | null> {
  try {
    if (input.resourceId) {
      const existingResult = await insforge.database
        .from('audit_logs')
        .select('id')
        .eq('organization_id', input.organizationId)
        .eq('action', input.action)
        .eq('resource_type', input.resourceType)
        .eq('resource_id', input.resourceId)
        .limit(1);
      if (existingResult.error) return existingResult.error.message;
      const existing = Array.isArray(existingResult.data)
        ? existingResult.data[0]
        : existingResult.data;
      if (existing) return null;
    }

    const result = await insforge.database
      .from('audit_logs')
      .insert([{
        organization_id: input.organizationId,
        actor_id: input.actorId,
        actor_type: 'user',
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        metadata: input.metadata,
      }]);
    return result.error?.message ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown reconciliation audit error';
  }
}
