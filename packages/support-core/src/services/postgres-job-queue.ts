/**
 * PostgresJobQueue — Postgres-backed implementation of the JobQueue interface.
 *
 * Uses the support_jobs table and claim_support_jobs RPC for atomic job claiming
 * with SELECT FOR UPDATE SKIP LOCKED. Implements exponential backoff for retries
 * and dead-lettering when attempts reach max_attempts.
 *
 * Idempotent enqueue: before inserting, checks for an existing pending/claimed
 * job with the same job_type and matching payload keys.
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
const IDEMPOTENCY_KEYS: Record<string, string[]> = {
  process_ai_message: ['conversationId', 'messageId'],
  process_knowledge_document: ['documentId'],
  send_outbound_message: ['conversationId', 'messageId'],
  process_delivery_status: ['externalMessageId'],
  record_chunk_refs: ['ai_decision_id'],
  retry_failed_jobs: [],
};

export class PostgresJobQueue implements JobQueue {
  constructor(private db: DatabaseClient) {}

  /**
   * Enqueue a new job. Idempotent: if a pending/claimed job with the same
   * job_type and matching key payload fields already exists, returns the
   * existing job instead of creating a duplicate.
   */
  async enqueue(
    jobType: JobType,
    payload: Record<string, unknown>,
    orgId: string,
  ): Promise<Job> {
    // Check for existing pending/claimed job with same type and key payload fields
    const existingJob = await this.findExistingJob(jobType, payload);
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
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to enqueue job: ${error?.message ?? 'no data returned'}`);
    }

    return mapRowToJob(data as Record<string, unknown>);
  }

  /**
   * Claim up to `limit` pending jobs for processing.
   * Uses the claim_support_jobs RPC for atomic claiming with
   * SELECT FOR UPDATE SKIP LOCKED.
   */
  async claim(limit: number): Promise<Job[]> {
    const { data, error } = await this.db.rpc('claim_support_jobs', {
      max_count: limit,
    });

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
    const { error } = await this.db
      .from('support_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (error) {
      throw new Error(`Failed to complete job ${jobId}: ${error.message}`);
    }
  }

  /**
   * Mark a job as failed. Increments attempts, records the error.
   * If attempts >= max_attempts, sets status to 'dead' (dead-lettering).
   * Otherwise, sets status to 'failed' with exponential backoff on run_after.
   */
  async fail(jobId: string, error: string): Promise<void> {
    // First, read the current job to get attempts and max_attempts
    const { data: jobData, error: readError } = await this.db
      .from('support_jobs')
      .select()
      .eq('id', jobId)
      .single();

    if (readError || !jobData) {
      throw new Error(
        `Failed to read job ${jobId}: ${readError?.message ?? 'not found'}`,
      );
    }

    const row = jobData as Record<string, unknown>;
    const currentAttempts = (row.attempts as number) + 1;
    const maxAttempts = row.max_attempts as number;

    if (currentAttempts >= maxAttempts) {
      // Dead-letter: attempts reached max
      const { error: updateError } = await this.db
        .from('support_jobs')
        .update({
          status: 'dead',
          attempts: currentAttempts,
          last_error: error,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      if (updateError) {
        throw new Error(`Failed to dead-letter job ${jobId}: ${updateError.message}`);
      }
    } else {
      // Exponential backoff: run_after = now() + 2^attempts seconds
      const backoffSeconds = Math.pow(2, currentAttempts);
      const runAfter = new Date(Date.now() + backoffSeconds * 1000);

      const { error: updateError } = await this.db
        .from('support_jobs')
        .update({
          status: 'failed',
          attempts: currentAttempts,
          last_error: error,
          run_after: runAfter.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      if (updateError) {
        throw new Error(`Failed to update failed job ${jobId}: ${updateError.message}`);
      }
    }
  }

  // ─── Private ────────────────────────────────────────────────────────

  /**
   * Check for an existing pending or claimed job with the same job_type
   * and matching key payload fields. Returns the existing job or null.
   */
  private async findExistingJob(
    jobType: JobType,
    payload: Record<string, unknown>,
  ): Promise<Job | null> {
    const keys = IDEMPOTENCY_KEYS[jobType] ?? [];

    // Query for pending or claimed jobs of the same type
    let query = this.db
      .from('support_jobs')
      .select()
      .eq('job_type', jobType)
      .in('status', ['pending', 'claimed']);

    // For job types with idempotency keys, filter by matching payload fields
    // We use the contains operator to check that the payload contains the key fields
    if (keys.length > 0) {
      const keyPayload: Record<string, unknown> = {};
      for (const key of keys) {
        if (payload[key] !== undefined) {
          keyPayload[key] = payload[key];
        }
      }
      if (Object.keys(keyPayload).length > 0) {
        query = query.contains('payload', keyPayload);
      }
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapRowToJob(data as Record<string, unknown>);
  }
}
