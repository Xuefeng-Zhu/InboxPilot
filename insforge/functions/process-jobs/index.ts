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

      await realtime.publish(`org:${orgId}`, 'conversation_updated', {
        conversationId,
        aiDecisionId: decision.id,
        decisionType: decision.decisionType,
      });
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

      await realtime.publish(`org:${orgId}`, 'knowledge_document_updated', {
        documentId,
        status: 'ready',
      });
    },

    async send_outbound_message(job: Job) {
      // AI-generated auto-reply send. Triggered by the AI agent in auto_reply
      // mode (see AiAgentService). Job payload: conversation_id, body,
      // sender_type: 'ai', ai_decision_id.
      //
      // Delegates to OutboundMessageService.sendReply (which performs the real
      // provider call via the registered adapter, persists the outbound
      // message with the correct `provider` value, and writes its own audit
      // log entry). We then patch the persisted message's `sender_type` back
      // to 'ai' (the service always writes 'user') and publish the org-level
      // realtime event so the agent inbox updates in real time.
      const conversationId = (job.payload.conversation_id ?? job.payload.conversationId) as string;
      const body = (job.payload.body as string) ?? '';
      const aiDecisionId = (job.payload.ai_decision_id as string) ?? null;
      if (!conversationId || !body) {
        throw new Error('send_outbound_message: missing conversation_id or body');
      }

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

      // Build the OutboundMessageService dependency graph. Mirrors the
      // Node route in app/api/functions/send-reply: we deliberately do
      // NOT pass `webchatThreadRepo` or `realtimePublisher` to the
      // service, so its webchat branch becomes a no-op. We do all
      // realtime publishing here in process-jobs so the visitor
      // channel carries the corrected `senderType: 'ai'` payload on
      // the first publish (no `new_message` → `message_corrected` race).
      const registry = createProviderRegistry();
      const outboundService = new OutboundMessageService(
        conversationRepo,
        contactRepo,
        messageRepo,
        registry,
        smsAccountRepo,
        emailAccountRepo,
        auditLogRepo,
      );

      // Load provider credentials from InsForge secrets, keyed by the
      // configured account's `credentials_secret_id`. Mock provider skips
      // the secret lookup entirely; webchat doesn't need a provider at all.
      let providerConfig: Record<string, unknown> = {};
      if (conversation.channel === 'sms') {
        const defaultPhone = await smsAccountRepo.findDefaultPhoneNumber(conversation.organizationId);
        if (defaultPhone) {
          const smsAccount = await smsAccountRepo.findById(defaultPhone.providerAccountId);
          if (smsAccount && smsAccount.isActive && smsAccount.provider !== 'mock') {
            const secret = await getSecret<Record<string, unknown>>(
              smsAccount.credentialsSecretId,
              baseUrl,
              serviceRoleKey,
            );
            if (secret) {
              providerConfig = secret;
            }
          }
        }
      } else if (conversation.channel === 'email') {
        const defaultEmail = await emailAccountRepo.findDefaultEmailAddress(conversation.organizationId);
        if (defaultEmail) {
          const emailAccount = await emailAccountRepo.findById(defaultEmail.providerAccountId);
          if (emailAccount && emailAccount.isActive && emailAccount.provider !== 'mock') {
            const secret = await getSecret<Record<string, unknown>>(
              emailAccount.credentialsSecretId,
              baseUrl,
              serviceRoleKey,
            );
            if (secret) {
              providerConfig = secret;
            }
          }
        }
      }

      // The job is an AI auto-reply. The OutboundMessageService contract
      // writes sender_type='user' and (by default) actorType='user'; the
      // human-reply path is its primary use case. We pass
      // `writeAuditLog: false` to suppress the misleading `user` audit row
      // and write a single `actorType: 'ai'` row below. The DB message row
      // is patched post-insert (the service does not accept an actor
      // parameter).
      const message = await outboundService.sendReply(
        conversationId,
        body,
        null,
        providerConfig,
        { writeAuditLog: false },
      );

      // Patch the message row to reflect AI authorship. Must happen
      // BEFORE any realtime publish so the event payloads carry
      // sender_type='ai'. Failure is non-fatal — the agent still sees
      // the message in the inbox, just temporarily misattributed.
      try {
        await db
          .from('messages')
          .update({ sender_type: 'ai', sender_id: null })
          .eq('id', message.id);
      } catch (err) {
        console.error(
          `send_outbound_message: failed to patch sender_type=ai on message ${message.id}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }

      // Reflect the correction on the in-memory message so downstream
      // publishes carry the right data.
      const correctedMessage = { ...message, senderType: 'ai' as const, senderId: null };

      // Write the AI audit log entry — the only one for this message.
      // Matches the pre-refactor contract:
      //   action: 'message_sent', actorType: 'ai', actorId: null,
      //   metadata: { trigger: 'auto_reply', channel, conversationId }.
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
          `send_outbound_message: failed to write ai audit log for message ${message.id}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }

      // Webchat: publish to the visitor channel from process-jobs
      // (the service's webchat branch is a no-op because we did not
      // inject `webchatThreadRepo`/`realtimePublisher`). The payload
      // uses the corrected message so the widget sees the AI actor on
      // the very first event — no follow-up corrective event needed.
      // Best-effort: failures are logged, not thrown.
      if (conversation.channel === 'webchat') {
        const thread = await webchatThreadRepo.findByConversationId(conversation.id);
        if (thread) {
          try {
            await realtime.publish(
              `widget:${thread.widgetId}:${thread.visitorTokenJti}`,
              'new_message',
              { message: correctedMessage, conversationId: correctedMessage.conversationId },
            );
          } catch (err) {
            console.error(
              `send_outbound_message: failed to publish webchat realtime for message ${message.id}: ` +
                (err instanceof Error ? err.message : String(err)),
            );
          }
        }
      }

      // Notify the agent inbox via the org channel with the corrected
      // message (senderType='ai' and senderId=null).
      await realtime.publish(`org:${conversation.organizationId}`, 'new_message', {
        message: correctedMessage,
        conversationId: correctedMessage.conversationId,
      });

      // Mark the AI decision as auto-sent (best-effort).
      if (aiDecisionId) {
        try {
          await aiDecisionRepo.update(aiDecisionId, {
            metadata: { autoSent: true, sentAt: new Date().toISOString() },
          });
        } catch { /* non-critical */ }
      }
    },

    async process_delivery_status(_job: Job) {
      // Delivery status is processed synchronously by the sms-status and
      // email-status function entrypoints. This job type is reserved for
      // async retry of failed status processing.
      // TODO: Wire DeliveryStatusService for async retries.
    },

    async retry_failed_jobs(_job: Job) {
      // TODO: Implement retry logic — re-enqueue failed jobs as pending.
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
    const baseUrl = (globalThis as Record<string, unknown>).Deno
      ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INSFORGE_BASE_URL')
      : process.env.INSFORGE_BASE_URL;
    // Service role key: check env first, then fall back to request's apikey header
    const serviceRoleKey = (globalThis as Record<string, unknown>).Deno
      ? ((globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INSFORGE_SERVICE_ROLE_KEY')
        ?? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('SERVICE_ROLE_KEY')
        ?? _req.headers.get('apikey'))
      : (process.env.INSFORGE_SERVICE_ROLE_KEY ?? _req.headers.get('apikey'));

    if (!baseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration', debug: { hasBaseUrl: !!baseUrl, hasKey: !!serviceRoleKey } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = createDbClient(baseUrl, serviceRoleKey);
    const jobQueue = new PostgresJobQueue(db);
    const jobHandlers = buildJobHandlers(db, baseUrl, serviceRoleKey);

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
