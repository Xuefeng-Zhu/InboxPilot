/**
 * process-jobs — Claims and processes pending jobs from the queue.
 *
 * Auth: Dedicated PROCESS_JOBS_SECRET supplied by the scheduler/server caller
 * Trigger: Authenticated scheduled invocation or manual HTTP POST
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
import { createKnowledgeFileFetch } from '../_shared/create-knowledge-file-fetch.ts';
import { createOpenRouterAiClient } from '../_shared/openrouter-ai-client.ts';
import { shouldAutoSendDecision } from '../_shared/auto-reply-policy.ts';
import { enqueueAutoReplyFallback } from '../_shared/auto-reply-fallback.ts';
import { createAutoReplySender } from '../_shared/auto-reply-sender.ts';
import { dispatchQueuedAutoReply } from '../_shared/queued-auto-reply-dispatch.ts';
import {
  NonRetryableJobError,
  runClaimedJob,
  type ClaimedJobResult,
} from '../_shared/run-claimed-job.ts';
import { isAuthorizedProcessJobsRequest } from '../_shared/process-jobs-auth.ts';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { KnowledgeRepository } from '../../../packages/support-core/src/repositories/knowledge-repository.ts';
import { AiSettingsRepository } from '../../../packages/support-core/src/repositories/ai-settings-repository.ts';
import { AiDecisionRepository } from '../../../packages/support-core/src/repositories/ai-decision-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { AiAgentService } from '../../../packages/support-core/src/services/ai-agent-service.ts';
import { KnowledgeIngestionService } from '../../../packages/support-core/src/services/knowledge-ingestion-service.ts';
import { createFileContentFetcher } from '../../../packages/support-core/src/utils/file-content-fetcher.ts';
import { createDefaultEscalationEngine } from '../../../packages/support-core/src/services/escalation-rules.ts';
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
// Job handler builders — create real handlers with injected dependencies
// ---------------------------------------------------------------------------

function buildJobHandlers(
  db: DatabaseClient,
  baseUrl: string,
  serviceRoleKey: string,
): Record<JobType, (job: Job) => Promise<void>> {
  const realtime = createRealtimePublisher(baseUrl, serviceRoleKey);
  const aiClient = createOpenRouterAiClient(baseUrl, serviceRoleKey);

  const sendAutoReply = createAutoReplySender({
    db,
    baseUrl,
    serviceRoleKey,
    realtime,
  });

  return {
    async process_ai_message(job: Job) {
      const conversationId = (job.payload.conversationId ?? job.payload.conversation_id) as string;
      const sourceMessageId = (job.payload.messageId ?? job.payload.message_id) as string;
      const orgId = job.organizationId;
      if (!conversationId || !sourceMessageId) {
        throw new NonRetryableJobError(
          'process_ai_message: missing conversation or source message ID',
        );
      }

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

      const decision = await aiAgentService.processMessage(
        conversationId,
        orgId,
        { sourceJobId: job.id, sourceMessageId },
      );
      if (!decision) return;

      // Inline auto-reply send: if the AI auto-replied, send immediately
      // instead of waiting for a separate process-jobs cycle. AiAgentService's
      // successful final source CAS is the reply-intent ordering point; a
      // second read here would recreate a read-then-send race.
      if (shouldAutoSendDecision(decision)) {
        try {
          await sendAutoReply(conversationId, decision.responseText, decision.id);
        } catch (err) {
          // Fall back to enqueueing a send_outbound_message job for retry.
          // NonRetryableJobError is rethrown by the helper instead.
          console.error(
            'process_ai_message: inline auto-reply send failed — ' +
              (err instanceof Error ? err.message : String(err)),
          );
          await enqueueAutoReplyFallback({
            error: err,
            jobQueue,
            conversationId,
            sourceMessageId,
            responseText: decision.responseText,
            aiDecisionId: decision.id,
            organizationId: orgId,
          });
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
      const revision = job.payload.revision as string | undefined;
      const orgId = job.organizationId;

      const knowledgeRepo = new KnowledgeRepository(db);
      const auditLogRepo = new AuditLogRepository(db);
      const aiSettingsRepo = new AiSettingsRepository(db);
      const fileFetcher = createFileContentFetcher(
        createKnowledgeFileFetch(baseUrl, serviceRoleKey),
      );

      const ingestionService = new KnowledgeIngestionService(
        knowledgeRepo, aiClient, auditLogRepo, fileFetcher, aiSettingsRepo,
      );

      const outcome = await ingestionService.processDocument(documentId, revision);
      if (outcome === 'superseded') return;

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
      const sourceMessageId = (
        job.payload.sourceMessageId ?? job.payload.source_message_id
      ) as string | undefined;
      if (!conversationId || !body) {
        throw new Error('send_outbound_message: missing conversation_id or body');
      }

      const conversationRepo = new ConversationRepository(db);
      await dispatchQueuedAutoReply({
        sourceMessageId,
        claimSourceTurn: (claimedSourceMessageId) => conversationRepo.transitionAiSourceTurn(
          conversationId,
          job.organizationId,
          claimedSourceMessageId,
          'auto_replied',
          undefined,
          { aiState: 'auto_replied', status: 'open' },
        ),
        send: () => sendAutoReply(conversationId, body, aiDecisionId),
      });
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
      // re-runs after a transient InsForge/PostgREST 5xx — where some rows may
      // have already committed before the error — complete the missing
      // rows instead of failing on the unique constraint. Combined with
      // the current claim RPC that re-claims failed jobs past their
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

export default async function (req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: 'POST' },
        },
      );
    }

    const processJobsSecret = getRuntimeEnv('PROCESS_JOBS_SECRET');
    if (!processJobsSecret) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!isAuthorizedProcessJobsRequest(req, processJobsSecret)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const baseUrl = getBaseUrl();
    const serviceRoleKey = getServiceRoleKey();

    if (!baseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = createDbClient(baseUrl, serviceRoleKey);
    const jobQueue = new PostgresJobQueue(db);
    const jobHandlers = buildJobHandlers(db, baseUrl, serviceRoleKey);

    const requestUrl = new URL(req.url);
    if (requestUrl.searchParams.get('health') === '1') {
      let { error } = await db.rpc('claim_support_jobs', { max_count: 0 });
      if (error && error.message.includes('claim_support_jobs')) {
        const fallback = await db.rpc('claim_support_jobs', { claim_limit: 0 });
        error = fallback.error;
      }
      return new Response(
        JSON.stringify(error
          ? { status: 'error', error: 'Health check failed' }
          : { status: 'ok' }),
        { status: error ? 500 : 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const jobs = await jobQueue.claim(MAX_JOBS_PER_RUN);

    const results: ClaimedJobResult[] = [];

    for (const job of jobs) {
      const handler = jobHandlers[job.jobType];

      if (!handler) {
        results.push(await runClaimedJob(
          job,
          async () => {
            throw new Error(`Unknown job type: ${job.jobType}`);
          },
          jobQueue,
        ));
        continue;
      }

      results.push(await runClaimedJob(job, handler, jobQueue));
    }

    const persistenceFailure = results.some(({ status }) => (
      status === 'quarantined' ||
      status === 'failure_persistence_failed' ||
      status === 'completion_quarantined' ||
      status === 'completion_persistence_failed'
    ));
    return new Response(
      JSON.stringify({
        status: persistenceFailure ? 'reconciliation_required' : 'ok',
        claimed: jobs.length,
        results,
      }),
      {
        status: persistenceFailure ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
