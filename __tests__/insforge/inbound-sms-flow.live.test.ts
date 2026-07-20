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
      'Live inbound SMS tests require a linked disposable qa-* InsForge branch; refusing to mutate the current project.',
    );
  }
  return { oss_host: project.oss_host, api_key: project.api_key };
}

describe.skipIf(!RUN_LIVE)('Integration: Inbound SMS Flow', () => {
  const organizationId = randomUUID();
  const suffix = Date.now().toString(36);
  const provider = `qa-sms-${suffix}`;

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
      name: 'QA Inbound SMS',
      slug: `qa-inbound-sms-${suffix}`,
    }).select('*').single();
    if (organizationResult.error) throw new Error(organizationResult.error.message);

    firstMessage = await service.processInboundSms({
      from: '+1 (415) 555-0123',
      to: '+14155550999',
      body: 'First live SMS',
      externalMessageId: `sms-first-${suffix}`,
      rawPayload: { probe: suffix },
    }, organizationId, provider);
    secondMessage = await service.processInboundSms({
      from: '+14155550123',
      to: '+14155550999',
      body: 'Second live SMS',
      externalMessageId: `sms-second-${suffix}`,
      rawPayload: { probe: suffix },
    }, organizationId, provider);
    duplicateMessage = await service.processInboundSms({
      from: '+14155550123',
      to: '+14155550999',
      body: 'Duplicate delivery should be ignored',
      externalMessageId: `sms-first-${suffix}`,
      rawPayload: { retry: true },
    }, organizationId, provider);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await db.from('organizations').delete().eq('id', organizationId);
  }, 30_000);

  it('creates a normalized contact, conversation, and persisted inbound message', async () => {
    const contact = await contactRepo.findByPhone(organizationId, '+14155550123');
    const conversation = contact
      ? await conversationRepo.findOpenByContactAndChannel(contact.id, 'sms')
      : null;

    expect(contact?.phone).toBe('+14155550123');
    expect(conversation?.id).toBe(firstMessage.conversationId);
    expect(conversation?.lastMessageAt).not.toBeNull();
    expect(firstMessage).toMatchObject({
      direction: 'inbound',
      channel: 'sms',
      body: 'First live SMS',
      provider,
      deliveryStatus: 'delivered',
    });
  });

  it('appends a later SMS from the same normalized phone to the open conversation', async () => {
    expect(secondMessage.conversationId).toBe(firstMessage.conversationId);
    const messages = await messageRepo.listByConversation(firstMessage.conversationId);
    expect(messages.map(({ body }) => body)).toEqual(['First live SMS', 'Second live SMS']);
  });

  it('deduplicates provider retries without duplicating messages or downstream work', async () => {
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
