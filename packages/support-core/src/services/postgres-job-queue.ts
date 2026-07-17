/**
 * PostgresJobQueue — Postgres-backed implementation of the JobQueue interface.
 *
 * Uses the support_jobs table and claim_support_jobs RPC for atomic job claiming
 * with SELECT FOR UPDATE SKIP LOCKED. Implements exponential backoff for retries
 * and dead-lettering when attempts reach max_attempts.
 *
 * Idempotent enqueue: checks for an existing active job and persists a stable
 * database-enforced idempotency key so concurrent enqueues cannot race past
 * the read-before-insert check.
 *
 * This service never imports InsForge SDK — the DatabaseClient is injected.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { JobQueue } from '../interfaces/job-queue.js';
import type { Job, JobType } from '../types/index.js';

/** Maps snake_case DB row to camelCase Job entity. */
function mapRowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    jobType: row.job_type as JobType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as Job['status'],
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    lastError: (row.last_error as string) ?? null,
    runAfter: new Date(row.run_after as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}

/**
 * Key payload fields used for idempotency checks per job type.
 * When enqueuing, we check for an existing pending/claimed job with the same
 * job_type and matching values for these payload keys.
 */
const IDEMPOTENCY_KEYS: Partial<Record<JobType, readonly string[]>> = {
  process_ai_message: ['conversationId', 'messageId'],
  process_knowledge_document: ['documentId', 'revision'],
  send_outbound_message: ['conversationId', 'aiDecisionId'],
  process_delivery_status: ['externalMessageId'],
  record_chunk_refs: ['ai_decision_id'],
};

/**
 * These jobs represent immutable source work. Once any terminal row exists,
 * automatically enqueueing the same key again can repeat an AI decision,
 * provider send, or chunk replacement. Dead rows require explicit operator
 * recovery instead of being silently cloned by a duplicate webhook.
 */
const LIFETIME_IDEMPOTENT_JOB_TYPES = new Set<JobType>([
  'process_ai_message',
  'process_knowledge_document',
  'send_outbound_message',
  'record_chunk_refs',
]);

/**
 * Build a stable key from the canonical payload fields for a job type.
 * Serializing ordered key/value tuples avoids delimiter and object-key-order
 * collisions while keeping the value inspectable in the database.
 */
export function createJobIdempotencyKey(
  jobType: JobType,
  payload: Record<string, unknown>,
): string | null {
  const keys = IDEMPOTENCY_KEYS[jobType];
  if (!keys || keys.length === 0) {
    return null;
  }

  const missingKeys = keys.filter((key) => payload[key] === undefined);
  if (missingKeys.length > 0) {
    throw new Error(
      `PostgresJobQueue.enqueue missing idempotency field(s) for ${jobType}: ${missingKeys.join(', ')}`,
    );
  }

  return JSON.stringify(keys.map((key) => [key, payload[key]]));
}

export class PostgresJobQueue implements JobQueue {
  constructor(private db: DatabaseClient) {}

  /**
   * Enqueue a new job. If matching canonical source work already exists under
   * the job type's lifetime/active policy, return it instead of duplicating it.
   */
  async enqueue(
    jobType: JobType,
    payload: Record<string, unknown>,
    orgId: string,
  ): Promise<Job> {
    const idempotencyKey = createJobIdempotencyKey(jobType, payload);

    // Check for an existing active job first. This keeps compatibility with
    // rows created before the idempotency_key column was introduced.
    const existingJob = await this.findExistingJob(jobType, payload, orgId);
    if (existingJob) {
      return existingJob;
    }

    // Insert new job
    const { data, error } = await this.db
      .from('support_jobs')
      .insert({
        organization_id: orgId,
        job_type: jobType,
        payload,
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        run_after: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (error) {
      // A concurrent request can win the unique-index race after our lookup.
      // Re-read and return that row instead of surfacing a false failure or
      // attempting another insert.
      if (idempotencyKey) {
        const concurrentJob = await this.findExistingJob(jobType, payload, orgId);
        if (concurrentJob) {
          return concurrentJob;
        }
      }
      throw new Error(`Failed to enqueue job: ${error?.message ?? 'no data returned'}`);
    }

    if (!data) {
      throw new Error('Failed to enqueue job: no data returned');
    }

    return mapRowToJob(data as Record<string, unknown>);
  }

  /**
   * Claim up to `limit` pending jobs for processing.
   * Uses the claim_support_jobs RPC for atomic claiming with
   * SELECT FOR UPDATE SKIP LOCKED.
   */
  async claim(limit: number): Promise<Job[]> {
    let { data, error } = await this.db.rpc('claim_support_jobs', {
      max_count: limit,
    });

    if (error && error.message.includes('claim_support_jobs')) {
      const fallback = await this.db.rpc('claim_support_jobs', {
        claim_limit: limit,
      });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      throw new Error(`Failed to claim jobs: ${error.message}`);
    }

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return (data as Record<string, unknown>[]).map(mapRowToJob);
  }

  /**
   * Mark a job as completed. Sets status to 'completed' and records completed_at.
   */
  async complete(jobId: string): Promise<void> {
    const { data, error } = await this.db
      .from('support_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'claimed')
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to complete job ${jobId}: ${error.message}`);
    }
    if (data) return;

    const current = await this.readJobRow(jobId);
    if (current?.status === 'completed') return;
    throw new Error(
      `Failed to complete job ${jobId}: expected claimed status, found ${current?.status ?? 'missing'}`,
    );
  }

  /**
   * Mark a job as failed. Increments attempts, records the error.
   * If attempts >= max_attempts, sets status to 'dead' (dead-lettering).
   * Otherwise, sets status to 'failed' with exponential backoff on run_after.
   */
  async fail(jobId: string, error: string): Promise<void> {
    // First, read the current job to get attempts and max_attempts
    const row = await this.readJobRow(jobId);
    if (!row) throw new Error(`Failed to read job ${jobId}: not found`);
    const currentStatus = row.status as string;
    const priorError = (row.last_error as string | null) ?? null;
    if ((currentStatus === 'failed' || currentStatus === 'dead') && priorError === error) {
      return;
    }
    if (currentStatus !== 'claimed') {
      throw new Error(`Failed to fail job ${jobId}: expected claimed status, found ${currentStatus}`);
    }

    const currentAttempts = (row.attempts as number) + 1;
    const maxAttempts = row.max_attempts as number;
    const nextStatus = currentAttempts >= maxAttempts ? 'dead' : 'failed';
    const update: Record<string, unknown> = {
      status: nextStatus,
      attempts: currentAttempts,
      last_error: error,
      updated_at: new Date().toISOString(),
    };
    if (nextStatus === 'failed') {
      const backoffSeconds = Math.pow(2, currentAttempts);
      update.run_after = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    }

    const { data, error: updateError } = await this.db
      .from('support_jobs')
      .update(update)
      .eq('id', jobId)
      .eq('status', 'claimed')
      .select('id')
      .maybeSingle();
    if (updateError) {
      throw new Error(`Failed to persist failed job ${jobId}: ${updateError.message}`);
    }
    if (data) return;

    const after = await this.readJobRow(jobId);
    if (after?.status === nextStatus && after.last_error === error) return;
    throw new Error(
      `Failed to persist failed job ${jobId}: claimed row changed concurrently`,
    );
  }

  /**
   * Dead-letter work that crossed a non-retryable side-effect boundary or
   * whose successful handler result could not be finalized. This keeps the
   * job observable without replaying the handler.
   */
  async quarantine(jobId: string, error: string): Promise<void> {
    const { data, error: updateError } = await this.db
      .from('support_jobs')
      .update({
        status: 'dead',
        last_error: error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'claimed')
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw new Error(`Failed to quarantine job ${jobId}: ${updateError.message}`);
    }
    if (data) return;

    const current = await this.readJobRow(jobId);
    if (current?.status === 'dead') return;
    throw new Error(
      `Failed to quarantine job ${jobId}: expected claimed status, found ${current?.status ?? 'missing'}`,
    );
  }

  // ─── Private ────────────────────────────────────────────────────────

  /**
   * Check for an existing job with the same type and canonical payload fields.
   * Immutable source jobs remain idempotent across terminal states; mutable
   * event jobs only dedupe while pending, claimed, or retryable.
   */
  private async findExistingJob(
    jobType: JobType,
    payload: Record<string, unknown>,
    orgId: string,
  ): Promise<Job | null> {
    const keys = IDEMPOTENCY_KEYS[jobType];
    if (!keys || keys.length === 0) {
      return null;
    }

    let query = this.db
      .from('support_jobs')
      .select()
      .eq('job_type', jobType)
      .eq('organization_id', orgId);

    // Failed jobs remain active because migration 008 reclaims them after
    // backoff. Immutable-source jobs intentionally omit this filter so a late
    // duplicate cannot clone completed or quarantined work.
    if (!LIFETIME_IDEMPOTENT_JOB_TYPES.has(jobType)) {
      query = query.in('status', ['pending', 'claimed', 'failed']);
    }

    // For job types with idempotency keys, filter by matching payload fields
    // We use the contains operator to check that the payload contains the key fields
    const keyPayload: Record<string, unknown> = {};
    for (const key of keys) {
      keyPayload[key] = payload[key];
    }
    query = query.contains('payload', keyPayload);

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      throw new Error(
        `Failed to check for existing ${jobType} job: ${error.message}`,
      );
    }

    if (!data) {
      return null;
    }

    return mapRowToJob(data as Record<string, unknown>);
  }

  private async readJobRow(jobId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.db
      .from('support_jobs')
      .select()
      .eq('id', jobId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read job ${jobId}: ${error.message}`);
    }
    return data ? data as Record<string, unknown> : null;
  }
}
