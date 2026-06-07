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

import { log, logError, newRequestContext, withRequest, withRequestIdHeader } from '../_shared/logger.js';
import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { requireInternalToken } from '../_shared/require-internal-token.js';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.js';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.js';
import { KnowledgeRepository } from '../../../packages/support-core/src/repositories/knowledge-repository.js';
import { AiSettingsRepository } from '../../../packages/support-core/src/repositories/ai-settings-repository.js';
import { AiDecisionRepository } from '../../../packages/support-core/src/repositories/ai-decision-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';
import { AiAgentService } from '../../../packages/support-core/src/services/ai-agent-service.js';
import { KnowledgeIngestionService } from '../../../packages/support-core/src/services/knowledge-ingestion-service.js';
import { createDefaultEscalationEngine } from '../../../packages/support-core/src/services/escalation-rules.js';
import type { AiClient } from '../../../packages/support-core/src/interfaces/ai-client.js';
import type { Job, JobType } from '../../../packages/support-core/src/types/index.js';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';

/** Maximum number of jobs to claim per invocation. */
const MAX_JOBS_PER_RUN = 10;

// ---------------------------------------------------------------------------
// AI Client factory (same as process-ai-job)
// ---------------------------------------------------------------------------

function createAiClient(baseUrl: string, serviceRoleKey: string): AiClient {
  return {
    async chatCompletion(params) {
      const res = await fetch(`${baseUrl}/ai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
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
      const res = await fetch(`${baseUrl}/ai/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
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

      const ingestionService = new KnowledgeIngestionService(
        knowledgeRepo, aiClient, auditLogRepo,
      );

      await ingestionService.processDocument(documentId);

      await realtime.publish(`org:${orgId}`, 'knowledge_document_updated', {
        documentId,
        status: 'ready',
      });
    },

    async send_outbound_message(_job: Job) {
      // Outbound messages are sent synchronously by OutboundMessageService
      // when called from send-reply or approve-ai-draft. This job type is
      // reserved for async sends triggered by auto-reply mode.
      // TODO: Wire OutboundMessageService for async auto-reply sends.
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
  };
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  // Internal-dispatch / cron entrypoint. No JWT, no per-tenant context
  // at start time; per-job ctx.org_id is set inside the loop.
  const ctx = newRequestContext('process-jobs', req);
  return withRequest(ctx, async () => {
    try {
      // 0. Internal-dispatch auth (CRITICAL-4). The function URL is public,
      //    so anyone who guesses it could claim up to 10 jobs and run them,
      //    consuming AI tokens (cost amplification). Require the shared
      //    secret in `x-internal-token`, compared against the server-side
      //    `INTERNAL_DISPATCH_TOKEN` env var.
      const envToken = (globalThis as Record<string, unknown>).Deno
        ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INTERNAL_DISPATCH_TOKEN')
        : process.env.INTERNAL_DISPATCH_TOKEN;
      const authResult = requireInternalToken(req, envToken ?? undefined);
      if (authResult.kind === 'misconfigured') {
        return new Response(
          JSON.stringify({ error: 'Internal dispatch token is not configured on the server' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (authResult.kind === 'unauthorized') {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const baseUrl = (globalThis as Record<string, unknown>).Deno
        ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INSFORGE_BASE_URL')
        : process.env.INSFORGE_BASE_URL;
      const serviceRoleKey = (globalThis as Record<string, unknown>).Deno
        ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INSFORGE_SERVICE_ROLE_KEY')
        : process.env.INSFORGE_SERVICE_ROLE_KEY;

      if (!baseUrl || !serviceRoleKey) {
        return new Response(
          JSON.stringify({ error: 'Missing environment configuration' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const db = createDbClient(baseUrl, serviceRoleKey);
      const jobQueue = new PostgresJobQueue(db);
      const jobHandlers = buildJobHandlers(db, baseUrl, serviceRoleKey);

      const jobs = await jobQueue.claim(MAX_JOBS_PER_RUN);

      const results: Array<{ jobId: string; jobType: string; status: 'completed' | 'failed'; error?: string }> = [];

      for (const job of jobs) {
        // Tag each per-job log line with the job's org so that an
        // operator searching by `org_id` sees every job that touched
        // the tenant, not just the function invocation itself.
        ctx.org_id = job.organizationId;

        const handler = jobHandlers[job.jobType];

        if (!handler) {
          await jobQueue.fail(job.id, `Unknown job type: ${job.jobType}`);
          results.push({ jobId: job.id, jobType: job.jobType, status: 'failed', error: `Unknown job type: ${job.jobType}` });
          log({
            level: 'warn',
            ...ctx,
            msg: 'unknown job type',
            status: 'failed',
            job_id: job.id,
            job_type: job.jobType,
          });
          continue;
        }

        try {
          await handler(job);
          await jobQueue.complete(job.id);
          results.push({ jobId: job.id, jobType: job.jobType, status: 'completed' });
          log({
            level: 'info',
            ...ctx,
            msg: 'job completed',
            status: 'completed',
            job_id: job.id,
            job_type: job.jobType,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await jobQueue.fail(job.id, errorMessage);
          results.push({ jobId: job.id, jobType: job.jobType, status: 'failed', error: errorMessage });
          logError(ctx, err, {
            msg: 'job failed',
            status: 'failed',
            job_id: job.id,
            job_type: job.jobType,
          });
        }
      }

      return new Response(
        JSON.stringify({ status: 'ok', claimed: jobs.length, results }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      logError(ctx, err, { msg: 'process-jobs caught exception' });
      const errorMessage = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }).then((res) => withRequestIdHeader(ctx, res));
}
