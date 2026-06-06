/**
 * Portable job queue interface.
 *
 * The underlying implementation (Postgres-backed, BullMQ, SQS, etc.)
 * is hidden behind this contract. Callers enqueue jobs and the queue
 * handles claiming, retries, backoff, and dead-lettering.
 */

import type { Job, JobType } from '../types/index.js';

export interface JobQueue {
  /** Enqueue a new job. Returns the created job record. */
  enqueue(
    jobType: JobType,
    payload: Record<string, unknown>,
    orgId: string,
  ): Promise<Job>;

  /** Claim up to `limit` pending jobs for processing. */
  claim(limit: number): Promise<Job[]>;

  /** Mark a job as completed. */
  complete(jobId: string): Promise<void>;

  /** Mark a job as failed with an error message. */
  fail(jobId: string, error: string): Promise<void>;
}
