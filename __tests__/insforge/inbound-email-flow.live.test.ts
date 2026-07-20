import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient } from '@/insforge/functions/_shared/create-db-client';
import { ContactRepository } from '@support-core/repositories/contact-repository';
import { ConversationRepository } from '@support-core/repositories/conversation-repository';
import { MessageRepository } from '@support-core/repositories/message-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import { PostgresJobQueue } from '@support-core/services/postgres-job-queue';
import { InboundMessageService } from '@support-core/services/inbound-message-service';
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
      'Live inbound email tests require a linked disposable qa-* InsForge branch; refusing to mutate the current project.',
    );
  }
  return { oss_host: project.oss_host, api_key: project.api_key };
}

describe.skipIf(!RUN_LIVE)('Integration: Inbound Email Flow', () => {
  const organizationId = randomUUID();
  const suffix = Date.now().toString(36);
  const provider = `qa-email-${suffix}`;

  let db: ReturnType<typeof createDbClient>;
  let contactRepo: ContactRepository;
  let conversationRepo: ConversationRepository;
  let messageRepo: MessageRepository;
  let firstMessage: Message;
  let secondMessage: Message;
  let duplicateMessage: Message;

  beforeAll(async () => {
    const project = loadDisposableProject();
    db = createDbClient(project.oss_host, project.api_key);
    contactRepo = new ContactRepository(db);
    conversationRepo = new ConversationRepository(db);
    messageRepo = new MessageRepository(db);
    const service = new InboundMessageService(
      contactRepo,
      conversationRepo,
      messageRepo,
      new PostgresJobQueue(db),
      new AuditLogRepository(db),
    );

    const organizationResult = await db.from('organizations').insert({
      id: organizationId,
      name: 'QA Inbound Email',
      slug: `qa-inbound-email-${suffix}`,
    }).select('*').single();
    if (organizationResult.error) throw new Error(organizationResult.error.message);

    firstMessage = await service.processInboundEmail({
      from: 'Customer@Example.COM',
      to: 'support@example.test',
      subject: 'Live billing question',
      bodyText: 'First live email',
      bodyHtml: '<p>First live email</p>',
      externalMessageId: `email-first-${suffix}`,
      rawPayload: { probe: suffix },
    }, organizationId, provider);
    secondMessage = await service.processInboundEmail({
      from: 'customer@example.com',
      to: 'support@example.test',
      subject: 'Re: Live billing question',
      bodyText: 'Second live email',
      externalMessageId: `email-second-${suffix}`,
      rawPayload: { probe: suffix },
    }, organizationId, provider);
    duplicateMessage = await service.processInboundEmail({
      from: 'customer@example.com',
      to: 'support@example.test',
      subject: 'Duplicate delivery',
      bodyText: 'Duplicate delivery should be ignored',
      externalMessageId: `email-first-${suffix}`,
      rawPayload: { retry: true },
    }, organizationId, provider);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await db.from('organizations').delete().eq('id', organizationId);
  }, 30_000);

  it('creates a lowercase contact and persists the email subject on the conversation and message', async () => {
    const contact = await contactRepo.findByEmail(organizationId, 'customer@example.com');
    const conversation = contact
      ? await conversationRepo.findOpenByContactAndChannel(contact.id, 'email')
      : null;

    expect(contact?.email).toBe('customer@example.com');
    expect(conversation?.id).toBe(firstMessage.conversationId);
    expect(conversation?.subject).toBe('Live billing question');
    expect(firstMessage).toMatchObject({
      direction: 'inbound',
      channel: 'email',
      subject: 'Live billing question',
      body: 'First live email',
      provider,
      deliveryStatus: 'delivered',
    });
  });

  it('appends later email from the normalized sender to the open conversation', async () => {
    expect(secondMessage.conversationId).toBe(firstMessage.conversationId);
    const messages = await messageRepo.listByConversation(firstMessage.conversationId);
    expect(messages.map(({ body }) => body)).toEqual(['First live email', 'Second live email']);
  });

  it('deduplicates provider retries while retaining one job and audit per unique message', async () => {
    expect(duplicateMessage.id).toBe(firstMessage.id);
    const messages = await messageRepo.listByConversation(firstMessage.conversationId);
    expect(messages).toHaveLength(2);

    const jobs = await db.from('support_jobs')
      .select('id,payload')
      .eq('organization_id', organizationId)
      .eq('job_type', 'process_ai_message');
    const audits = await db.from('audit_logs')
      .select('id,resource_id')
      .eq('organization_id', organizationId)
      .eq('action', 'message_received');
    expect(jobs.error).toBeNull();
    expect(jobs.data).toHaveLength(2);
    expect(audits.error).toBeNull();
    expect(audits.data).toHaveLength(2);
  });
});
