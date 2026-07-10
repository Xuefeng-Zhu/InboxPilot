/**
 * process-jobs — Claims and processes pending jobs from the queue.
 *
 * Auth: Cron / manual trigger (no JWT required)
 * Trigger: Scheduled invocation or manual HTTP call
 *
 * Flow:
 * 1. Create database client from environment
 * 2. Claim pending jobs via PostgresJobQueue
 * 3. Route each job to the appropriate handler by job_type
 * 4. Mark jobs as completed or failed with proper status updates
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.ts';
import { publishRealtimeBestEffort } from '../_shared/publish-realtime-best-effort.ts';
import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import { getSecret } from '../_shared/insforge-secrets.ts';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.ts';
import { OutboundMessageService } from '../../../packages/support-core/src/services/outbound-message-service.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { KnowledgeRepository } from '../../../packages/support-core/src/repositories/knowledge-repository.ts';
import { AiSettingsRepository } from '../../../packages/support-core/src/repositories/ai-settings-repository.ts';
import { AiDecisionRepository } from '../../../packages/support-core/src/repositories/ai-decision-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { WebchatThreadRepository } from '../../../packages/support-core/src/repositories/webchat-thread-repository.ts';
import { SmsProviderAccountRepository } from '../../../packages/support-core/src/repositories/sms-provider-account-repository.ts';
import { EmailProviderAccountRepository } from '../../../packages/support-core/src/repositories/email-provider-account-repository.ts';
import { AiAgentService } from '../../../packages/support-core/src/services/ai-agent-service.ts';
import { KnowledgeIngestionService } from '../../../packages/support-core/src/services/knowledge-ingestion-service.ts';
import { createFileContentFetcher } from '../../../packages/support-core/src/utils/file-content-fetcher.ts';
import { createDefaultEscalationEngine } from '../../../packages/support-core/src/services/escalation-rules.ts';
import type { AiClient } from '../../../packages/support-core/src/interfaces/ai-client.ts';
import type { Job, JobType } from '../../../packages/support-core/src/types/index.ts';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';

/** Maximum number of jobs to claim per invocation. */
const MAX_JOBS_PER_RUN = 10;

type DenoGlobal = {
  env?: {
    get(key: string): string | undefined;
  };
};

type ProcessGlobal = {
  env?: Record<string, string | undefined>;
};

function getRuntimeEnv(key: string): string | undefined {
  const maybeDeno = (globalThis as { Deno?: DenoGlobal }).Deno;
  const denoValue = maybeDeno?.env?.get(key);
  if (denoValue) return denoValue;

  const maybeProcess = (globalThis as { process?: ProcessGlobal }).process;
  return maybeProcess?.env?.[key];
}

function getBaseUrl(): string | undefined {
  return getRuntimeEnv('INSFORGE_BASE_URL');
}

function getServiceRoleKey(): string | null {
  return getRuntimeEnv('INSFORGE_SERVICE_ROLE_KEY') ??
    getRuntimeEnv('SERVICE_ROLE_KEY') ??
    getRuntimeEnv('API_KEY') ??
    null;
}

// ---------------------------------------------------------------------------
// AI Client factory (same as process-ai-job)
// ---------------------------------------------------------------------------

function createAiClient(baseUrl: string, serviceRoleKey: string): AiClient {
  // Fetch OpenRouter key lazily, cache for the lifetime of this invocation
  let openRouterKey: string | null = null;
  async function getOpenRouterKey(): Promise<string> {
    if (openRouterKey) return openRouterKey;
    const res = await fetch(`${baseUrl}/api/ai/openrouter/api-key`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch OpenRouter key: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { apiKey: string };
    openRouterKey = data.apiKey;
    return openRouterKey;
  }

  return {
    async chatCompletion(params) {
      const key = await getOpenRouterKey();
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          response_format: params.responseFormat,
          temperature: params.temperature,
        }),
      });
      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'unknown error');
        throw new Error(`AI chat completion failed: HTTP ${res.status} — ${errorBody}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const choices = data.choices as Array<{ message: { content: string } }>;
      return {
        content: choices?.[0]?.message?.content ?? '',
        usage: undefined,
      };
    },
    async createEmbedding(params) {
      const key = await getOpenRouterKey();
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: params.model, input: params.input }),
      });
      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'unknown error');
        throw new Error(`AI embedding failed: HTTP ${res.status} — ${errorBody}`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const embeddings = data.data as Array<{ embedding: number[] }>;
      return embeddings?.[0]?.embedding ?? [];
    },
  };
}

// ---------------------------------------------------------------------------
// Job handler builders — create real handlers with injected dependencies
// ---------------------------------------------------------------------------

function buildJobHandlers(
  db: DatabaseClient,
  baseUrl: string,
  serviceRoleKey: string,
): Record<JobType, (job: Job) => Promise<void>> {
  const realtime = createRealtimePublisher(baseUrl, serviceRoleKey);
  const aiClient = createAiClient(baseUrl, serviceRoleKey);

  // ── Shared: send an AI auto-reply immediately (no separate job cycle) ──
  async function sendAutoReply(
    conversationId: string,
    body: string,
    aiDecisionId: string | null,
  ): Promise<void> {
    const conversationRepo = new ConversationRepository(db);
    const messageRepo = new MessageRepository(db);
    const contactRepo = new ContactRepository(db);
    const webchatThreadRepo = new WebchatThreadRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const aiDecisionRepo = new AiDecisionRepository(db);
    const smsAccountRepo = new SmsProviderAccountRepository(db);
    const emailAccountRepo = new EmailProviderAccountRepository(db);

    const conversation = await conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const registry = createProviderRegistry();
    const outboundService = new OutboundMessageService(
      conversationRepo, contactRepo, messageRepo,
      registry, smsAccountRepo, emailAccountRepo, auditLogRepo,
    );

    let providerConfig: Record<string, unknown> = {};
    if (conversation.channel === 'sms') {
      const defaultPhone = await smsAccountRepo.findDefaultPhoneNumber(conversation.organizationId);
      if (defaultPhone) {
        const smsAccount = await smsAccountRepo.findById(defaultPhone.providerAccountId);
        if (smsAccount && smsAccount.isActive && smsAccount.provider !== 'mock') {
          const secret = await getSecret<Record<string, unknown>>(
            smsAccount.credentialsSecretId, baseUrl, serviceRoleKey,
          );
          if (secret) providerConfig = secret;
        }
      }
    } else if (conversation.channel === 'email') {
      const defaultEmail = await emailAccountRepo.findDefaultEmailAddress(conversation.organizationId);
      if (defaultEmail) {
        const emailAccount = await emailAccountRepo.findById(defaultEmail.providerAccountId);
        if (emailAccount && emailAccount.isActive && emailAccount.provider !== 'mock') {
          const secret = await getSecret<Record<string, unknown>>(
            emailAccount.credentialsSecretId, baseUrl, serviceRoleKey,
          );
          if (secret) providerConfig = secret;
        }
      }
    }

    const message = await outboundService.sendReply(
      conversationId, body, null, providerConfig, { writeAuditLog: false },
    );

    const { error: senderPatchError } = await db.from('messages')
      .update({ sender_type: 'ai', sender_id: null })
      .eq('id', message.id);
    if (senderPatchError) {
      console.error(
        `sendAutoReply: failed to patch sender_type=ai on message ${message.id}: ` +
          senderPatchError.message,
      );
    }

    const correctedMessage = { ...message, senderType: 'ai' as const, senderId: null };

    try {
      await auditLogRepo.create({
        organizationId: conversation.organizationId,
        actorId: null,
        actorType: 'ai',
        action: 'message_sent',
        resourceType: 'message',
        resourceId: message.id,
        metadata: {
          trigger: 'auto_reply',
          channel: conversation.channel,
          conversationId: conversation.id,
        },
      });
    } catch (err) {
      console.error(
        `sendAutoReply: failed to write ai audit log for message ${message.id}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    if (conversation.channel === 'webchat') {
      const thread = await webchatThreadRepo.findByConversationId(conversation.id);
      if (thread) {
        await publishRealtimeBestEffort(
          realtime,
          `widget:${thread.widgetId}:${thread.visitorTokenJti}`,
          'new_message',
          { message: correctedMessage, conversationId: correctedMessage.conversationId },
          `sendAutoReply message ${message.id}`,
        );
      }
    }

    await publishRealtimeBestEffort(
      realtime,
      `org:${conversation.organizationId}`,
      'new_message',
      {
        message: correctedMessage,
        conversationId: correctedMessage.conversationId,
      },
      `sendAutoReply message ${message.id}`,
    );

    if (aiDecisionId) {
      try {
        await aiDecisionRepo.update(aiDecisionId, {
          metadata: { autoSent: true, sentAt: new Date().toISOString() },
        });
      } catch (err) {
        console.error(
          `sendAutoReply: failed to update AI decision ${aiDecisionId} metadata after sending ` +
            `message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return {
    async process_ai_message(job: Job) {
      const conversationId = (job.payload.conversationId ?? job.payload.conversation_id) as string;
      const orgId = job.organizationId;

      const conversationRepo = new ConversationRepository(db);
      const messageRepo = new MessageRepository(db);
      const knowledgeRepo = new KnowledgeRepository(db);
      const aiSettingsRepo = new AiSettingsRepository(db);
      const aiDecisionRepo = new AiDecisionRepository(db);
      const auditLogRepo = new AuditLogRepository(db);
      const jobQueue = new PostgresJobQueue(db);
      const escalationEngine = createDefaultEscalationEngine();

      const aiAgentService = new AiAgentService(
        conversationRepo, messageRepo, knowledgeRepo,
        aiSettingsRepo, aiDecisionRepo, escalationEngine,
        aiClient, jobQueue, auditLogRepo,
      );

      const decision = await aiAgentService.processMessage(conversationId, orgId);

      // Inline auto-reply send: if the AI auto-replied, send immediately
      // instead of waiting for a separate process-jobs cycle.
      if (decision.responseText) {
        const conversation = await conversationRepo.findById(conversationId);
        if (conversation?.aiState === 'auto_replied') {
          try {
            await sendAutoReply(conversationId, decision.responseText, decision.id);
          } catch (err) {
            // Fall back to enqueueing a send_outbound_message job for retry
            console.error(
              'process_ai_message: inline auto-reply send failed, ' +
                'falling back to job queue — ' +
                (err instanceof Error ? err.message : String(err)),
            );
            await jobQueue.enqueue(
              'send_outbound_message',
              {
                conversationId,
                body: decision.responseText,
                senderType: 'ai',
                aiDecisionId: decision.id,
              },
              orgId,
            );
          }
        }
      }

      await publishRealtimeBestEffort(
        realtime,
        `org:${orgId}`,
        'conversation_updated',
        {
          conversationId,
          aiDecisionId: decision.id,
          decisionType: decision.decisionType,
        },
        `process_ai_message job ${job.id}`,
      );
    },

    async process_knowledge_document(job: Job) {
      const documentId = (job.payload.documentId ?? job.payload.document_id) as string;
      const orgId = job.organizationId;

      const knowledgeRepo = new KnowledgeRepository(db);
      const auditLogRepo = new AuditLogRepository(db);
      const aiSettingsRepo = new AiSettingsRepository(db);
      const fileFetcher = createFileContentFetcher();

      const ingestionService = new KnowledgeIngestionService(
        knowledgeRepo, aiClient, auditLogRepo, fileFetcher, aiSettingsRepo,
      );

      await ingestionService.processDocument(documentId);

      await publishRealtimeBestEffort(
        realtime,
        `org:${orgId}`,
        'knowledge_document_updated',
        { documentId, status: 'ready' },
        `process_knowledge_document job ${job.id}`,
      );
    },

    async send_outbound_message(job: Job) {
      // Fallback / retry path for auto-reply sends. The primary flow now sends
      // inline in process_ai_message; this handler catches retries from the
      // fallback enqueue there, or any externally-enqueued send_outbound_message jobs.
      const conversationId = (job.payload.conversation_id ?? job.payload.conversationId) as string;
      const body = (job.payload.body as string) ?? '';
      const aiDecisionId = (
        job.payload.aiDecisionId ?? job.payload.ai_decision_id
      ) as string | null;
      if (!conversationId || !body) {
        throw new Error('send_outbound_message: missing conversation_id or body');
      }

      await sendAutoReply(conversationId, body, aiDecisionId);
    },

    async process_delivery_status(_job: Job) {
      // Delivery status is processed synchronously by the sms-status and
      // email-status function entrypoints. This job type is reserved for
      // async retry of failed status processing.
      throw new Error('process_delivery_status retry handler is not implemented');
    },

    async retry_failed_jobs(_job: Job) {
      throw new Error('retry_failed_jobs handler is not implemented');
    },

    async record_chunk_refs(job: Job) {
      // Persist which knowledge chunks grounded an AI decision. Triggered
      // by AiAgentService after each ai_decisions insert so the
      // /knowledge/[id] "Linked conversations" panel can show real,
      // tenant-scoped, document-grounded citations.
      //
      // Why a job and not an inline DB write: the AI agent runs inside
      // process-jobs (a serverless function). Inline writes from a
      // detached promise can be torn down when the function returns its
      // response, leaving the audit row missing. Routing through the
      // queue makes the write durable: the job row is committed in the
      // same transaction as the decision, and this worker is the only
      // thing that consumes it.
      //
      // Idempotency: insert_ai_decision_chunks (migration 007) uses
      // ON CONFLICT (ai_decision_id, knowledge_chunk_id) DO NOTHING so
      // re-runs after a transient Supabase 5xx — where some rows may
      // have already committed before the error — complete the missing
      // rows instead of failing on the unique constraint. Combined with
      // the 008 migration that re-claims failed jobs past their
      // run_after backoff, this gives the chunk-ref pipeline at-least-
      // once delivery with idempotent application.
      //
      // The 007 trigger still validates cross-tenant references
      // server-side on every row the RPC attempts to insert.
      const aiDecisionId = (job.payload.ai_decision_id as string) ?? null;
      const chunkIds = (job.payload.knowledge_chunk_ids as string[]) ?? [];
      const orgId = job.organizationId;

      if (!aiDecisionId) {
        throw new Error('record_chunk_refs: missing ai_decision_id');
      }
      if (chunkIds.length === 0) {
        // Nothing to do; succeed silently.
        return;
      }

      const { error: rpcError } = await db.rpc('insert_ai_decision_chunks', {
        p_ai_decision_id: aiDecisionId,
        p_organization_id: orgId,
        p_chunk_ids: chunkIds,
      });

      if (rpcError) {
        throw new Error(`insert_ai_decision_chunks failed: ${rpcError.message}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (_req: Request): Promise<Response> {
  try {
    const baseUrl = getBaseUrl();
    const serviceRoleKey = getServiceRoleKey();

    if (!baseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration', debug: { hasBaseUrl: !!baseUrl, hasKey: !!serviceRoleKey } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = createDbClient(baseUrl, serviceRoleKey);
    const jobQueue = new PostgresJobQueue(db);
    const jobHandlers = buildJobHandlers(db, baseUrl, serviceRoleKey);

    const requestUrl = new URL(_req.url);
    if (requestUrl.searchParams.get('health') === '1') {
      let { data, error } = await db.rpc('claim_support_jobs', { max_count: 0 });
      if (error && error.message.includes('claim_support_jobs')) {
        const fallback = await db.rpc('claim_support_jobs', { claim_limit: 0 });
        data = fallback.data;
        error = fallback.error;
      }
      return new Response(
        JSON.stringify({
          status: error ? 'error' : 'ok',
          hasBaseUrl: true,
          hasKey: true,
          rpcOk: !error,
          rpcError: error?.message ?? null,
          claimLimitZeroRows: Array.isArray(data) ? data.length : null,
        }),
        { status: error ? 500 : 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const jobs = await jobQueue.claim(MAX_JOBS_PER_RUN);

    const results: Array<{ jobId: string; jobType: string; status: 'completed' | 'failed'; error?: string }> = [];

    for (const job of jobs) {
      const handler = jobHandlers[job.jobType];

      if (!handler) {
        await jobQueue.fail(job.id, `Unknown job type: ${job.jobType}`);
        results.push({ jobId: job.id, jobType: job.jobType, status: 'failed', error: `Unknown job type: ${job.jobType}` });
        continue;
      }

      try {
        await handler(job);
        await jobQueue.complete(job.id);
        results.push({ jobId: job.id, jobType: job.jobType, status: 'completed' });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await jobQueue.fail(job.id, errorMessage);
        results.push({ jobId: job.id, jobType: job.jobType, status: 'failed', error: errorMessage });
      }
    }

    return new Response(
      JSON.stringify({ status: 'ok', claimed: jobs.length, results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
