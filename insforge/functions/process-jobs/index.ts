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

import { createDbClient } from '../_shared/create-db-client.js';
import { PostgresJobQueue } from '../../packages/support-core/src/services/postgres-job-queue.js';
import type { Job, JobType } from '../../packages/support-core/src/types/index.js';

/** Maximum number of jobs to claim per invocation. */
const MAX_JOBS_PER_RUN = 10;

/**
 * Job handler type — each handler receives the job and returns void on success.
 * Throwing an error signals failure.
 */
type JobHandler = (job: Job) => Promise<void>;

/**
 * Stub handlers for each job type.
 * Actual implementations will be wired in later tasks.
 */
const jobHandlers: Record<JobType, JobHandler> = {
  process_ai_message: async (_job: Job) => {
    // Stub: actual AI processing will be wired in task 19
  },
  process_knowledge_document: async (_job: Job) => {
    // Stub: actual knowledge ingestion will be wired in task 18
  },
  send_outbound_message: async (_job: Job) => {
    // Stub: actual outbound sending will be wired in task 11
  },
  process_delivery_status: async (_job: Job) => {
    // Stub: actual delivery status processing will be wired in task 15
  },
  retry_failed_jobs: async (_job: Job) => {
    // Stub: retry logic will be wired in a later task
  },
};

export default async function (req: Request): Promise<Response> {
  try {
    // 1. Create database client
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

    // 2. Claim pending jobs
    const jobs = await jobQueue.claim(MAX_JOBS_PER_RUN);

    // 3. Process each job
    const results: Array<{ jobId: string; jobType: string; status: 'completed' | 'failed'; error?: string }> = [];

    for (const job of jobs) {
      const handler = jobHandlers[job.jobType];

      if (!handler) {
        // Unknown job type — fail the job
        await jobQueue.fail(job.id, `Unknown job type: ${job.jobType}`);
        results.push({
          jobId: job.id,
          jobType: job.jobType,
          status: 'failed',
          error: `Unknown job type: ${job.jobType}`,
        });
        continue;
      }

      try {
        await handler(job);
        await jobQueue.complete(job.id);
        results.push({
          jobId: job.id,
          jobType: job.jobType,
          status: 'completed',
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await jobQueue.fail(job.id, errorMessage);
        results.push({
          jobId: job.id,
          jobType: job.jobType,
          status: 'failed',
          error: errorMessage,
        });
      }
    }

    // 4. Return summary
    return new Response(
      JSON.stringify({
        status: 'ok',
        claimed: jobs.length,
        results,
      }),
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
