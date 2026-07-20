import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@/insforge/functions/_shared/create-db-client';
import { ContactRepository } from '@support-core/repositories/contact-repository';
import { ConversationRepository } from '@support-core/repositories/conversation-repository';
import { MessageRepository } from '@support-core/repositories/message-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import { SmsProviderAccountRepository } from '@support-core/repositories/sms-provider-account-repository';
import { EmailProviderAccountRepository } from '@support-core/repositories/email-provider-account-repository';
import { ProviderRegistry } from '@support-core/interfaces/provider-registry';
import { MockSmsAdapter } from '@support-core/adapters/mock-sms-adapter';
import { MockEmailAdapter } from '@support-core/adapters/mock-email-adapter';
import { OutboundMessageService } from '@support-core/services/outbound-message-service';
import type { Message } from '@support-core/types';

const RUN_LIVE = process.env.INBOXPILOT_LIVE_INTEGRATION === '1';
const PRODUCTION_HOST = 'https://y39ezar3.us-east.insforge.app';

interface LinkedProject {
  project_name?: string;
  oss_host?: string;
  api_key?: string;
  branched_from?: { project_id?: string };
}

function loadDisposableProject(): Required<Pick<LinkedProject, 'oss_host' | 'api_key'>> {
  const project = JSON.parse(
    readFileSync(resolve(process.cwd(), '.insforge/project.json'), 'utf8'),
  ) as LinkedProject;
  if (
    !project.branched_from?.project_id ||
    !project.project_name?.startsWith('qa-') ||
    !project.oss_host ||
    !project.api_key ||
    project.oss_host === PRODUCTION_HOST
  ) {
    throw new Error(
      'Live outbound tests require a linked disposable qa-* InsForge branch; refusing to mutate the current project.',
    );
  }
  return { oss_host: project.oss_host, api_key: project.api_key };
}

describe.skipIf(!RUN_LIVE)('Integration: Outbound Message Flow', () => {
  const organizationId = randomUUID();
  const organizationWithoutProviderId = randomUUID();
  const smsContactId = randomUUID();
  const emailContactId = randomUUID();
  const missingProviderContactId = randomUUID();
  const smsConversationId = randomUUID();
  const emailConversationId = randomUUID();
  const missingProviderConversationId = randomUUID();
  const smsAccountId = randomUUID();
  const emailAccountId = randomUUID();
  const suffix = Date.now().toString(36);
  const actor = { type: 'user', id: `qa-agent-${suffix}` } as const;

  let db: ReturnType<typeof createDbClient>;
  let conversationRepo: ConversationRepository;
  let messageRepo: MessageRepository;
  let service: OutboundMessageService;
  let smsAdapter: MockSmsAdapter;
  let emailAdapter: MockEmailAdapter;
  let smsMessage: Message;
  let emailMessage: Message;

  beforeAll(async () => {
    const project = loadDisposableProject();
    db = createDbClient(project.oss_host, project.api_key);
    conversationRepo = new ConversationRepository(db);
    messageRepo = new MessageRepository(db);
    const registry = new ProviderRegistry();
    smsAdapter = new MockSmsAdapter();
    emailAdapter = new MockEmailAdapter();
    registry.registerSmsAdapter('mock', smsAdapter);
    registry.registerEmailAdapter('mock', emailAdapter);
    service = new OutboundMessageService(
      conversationRepo,
      new ContactRepository(db),
      messageRepo,
      registry,
      new SmsProviderAccountRepository(db),
      new EmailProviderAccountRepository(db),
      new AuditLogRepository(db),
    );

    const organizations = await db.from('organizations').insert([
      { id: organizationId, name: 'QA Outbound', slug: `qa-outbound-${suffix}` },
      {
        id: organizationWithoutProviderId,
        name: 'QA Outbound Missing Provider',
        slug: `qa-outbound-missing-${suffix}`,
      },
    ]).select('*');
    if (organizations.error) throw new Error(organizations.error.message);

    const contacts = await db.from('contacts').insert([
      {
        id: smsContactId,
        organization_id: organizationId,
        name: 'SMS Recipient',
        email: null,
        phone: '+14155550111',
      },
      {
        id: emailContactId,
        organization_id: organizationId,
        name: 'Email Recipient',
        email: 'recipient@example.test',
        phone: null,
      },
      {
        id: missingProviderContactId,
        organization_id: organizationWithoutProviderId,
        name: 'Missing Provider Recipient',
        email: null,
        phone: '+14155550222',
      },
    ]).select('*');
    if (contacts.error) throw new Error(contacts.error.message);

    const conversations = await db.from('conversations').insert([
      {
        id: smsConversationId,
        organization_id: organizationId,
        contact_id: smsContactId,
        channel: 'sms',
        status: 'open',
        ai_state: 'idle',
        subject: null,
      },
      {
        id: emailConversationId,
        organization_id: organizationId,
        contact_id: emailContactId,
        channel: 'email',
        status: 'open',
        ai_state: 'idle',
        subject: 'Live email subject',
      },
      {
        id: missingProviderConversationId,
        organization_id: organizationWithoutProviderId,
        contact_id: missingProviderContactId,
        channel: 'sms',
        status: 'open',
        ai_state: 'idle',
        subject: null,
      },
    ]).select('*');
    if (conversations.error) throw new Error(conversations.error.message);

    const smsAccount = await db.from('sms_provider_accounts').insert({
      id: smsAccountId,
      organization_id: organizationId,
      provider: 'mock',
      label: 'QA Mock SMS',
      credentials_secret_id: `qa-sms-secret-${suffix}`,
    }).select('*').single();
    if (smsAccount.error) throw new Error(smsAccount.error.message);
    const smsNumber = await db.from('sms_phone_numbers').insert({
      provider_account_id: smsAccountId,
      organization_id: organizationId,
      phone_number: '+14155550999',
      is_default: true,
    }).select('*').single();
    if (smsNumber.error) throw new Error(smsNumber.error.message);

    const emailAccount = await db.from('email_provider_accounts').insert({
      id: emailAccountId,
      organization_id: organizationId,
      provider: 'mock',
      label: 'QA Mock Email',
      credentials_secret_id: `qa-email-secret-${suffix}`,
    }).select('*').single();
    if (emailAccount.error) throw new Error(emailAccount.error.message);
    const emailAddress = await db.from('email_addresses').insert({
      provider_account_id: emailAccountId,
      organization_id: organizationId,
      email_address: 'support@example.test',
      is_default: true,
    }).select('*').single();
    if (emailAddress.error) throw new Error(emailAddress.error.message);

    smsMessage = await service.sendReply(smsConversationId, 'Live SMS reply', actor);
    emailMessage = await service.sendReply(emailConversationId, 'Live email reply', actor);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await db.from('organizations')
      .delete()
      .in('id', [organizationId, organizationWithoutProviderId]);
  }, 30_000);

  it('sends SMS and email through mock adapters and persists provider receipts', () => {
    expect(smsAdapter.sentMessages).toEqual([{
      to: '+14155550111',
      from: '+14155550999',
      body: 'Live SMS reply',
      externalMessageId: 'mock_sms_1',
    }]);
    expect(emailAdapter.sentEmails).toEqual([{
      to: 'recipient@example.test',
      from: 'support@example.test',
      subject: 'Live email subject',
      bodyText: 'Live email reply',
      externalMessageId: 'mock_email_1',
    }]);
    expect(smsMessage).toMatchObject({
      provider: 'mock',
      providerAccountId: smsAccountId,
      externalMessageId: 'mock_sms_1',
      deliveryStatus: 'queued',
    });
    expect(emailMessage).toMatchObject({
      provider: 'mock',
      providerAccountId: emailAccountId,
      externalMessageId: 'mock_email_1',
      deliveryStatus: 'queued',
    });
  });

  it('updates conversation timestamps and records one message_sent audit per reply', async () => {
    const [smsConversation, emailConversation] = await Promise.all([
      conversationRepo.findById(smsConversationId),
      conversationRepo.findById(emailConversationId),
    ]);
    const audits = await db.from('audit_logs')
      .select('resource_id,metadata')
      .eq('organization_id', organizationId)
      .eq('action', 'message_sent');

    expect(smsConversation?.lastMessageAt).not.toBeNull();
    expect(emailConversation?.lastMessageAt).not.toBeNull();
    expect(audits.error).toBeNull();
    expect(audits.data).toHaveLength(2);
    expect(new Set((audits.data as Array<{ resource_id: string }>).map(({ resource_id }) => resource_id)))
      .toEqual(new Set([smsMessage.id, emailMessage.id]));
  });

  it('fails before dispatch when the organization has no default sender', async () => {
    await expect(
      service.sendReply(missingProviderConversationId, 'Cannot send', actor),
    ).rejects.toThrow('No default SMS phone number configured');
    expect(await messageRepo.listByConversation(missingProviderConversationId)).toHaveLength(0);
  });
});
