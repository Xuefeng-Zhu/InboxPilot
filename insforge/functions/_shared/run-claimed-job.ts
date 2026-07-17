import type { Job } from '../../../packages/support-core/src/types/index.ts';
import type { JobQueue } from '../../../packages/support-core/src/interfaces/job-queue.ts';

export type ClaimedJobResult = {
  jobId: string;
  jobType: string;
  status:
    | 'completed'
    | 'failed'
    | 'quarantined'
    | 'failure_persistence_failed'
    | 'completion_quarantined'
    | 'completion_persistence_failed';
  error?: string;
};

/** Handler failure that must be quarantined rather than retried. */
export class NonRetryableJobError extends Error {
  constructor(message: string, readonly originalError?: unknown) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run a claimed job while keeping handler failure separate from completion
 * persistence. Once a handler has performed an external side effect, calling
 * fail() because complete() had a transient error would make the handler run
 * again and can duplicate that side effect.
 */
export async function runClaimedJob(
  job: Job,
  handler: (job: Job) => Promise<void>,
  jobQueue: Pick<JobQueue, 'complete' | 'fail'> & {
    quarantine?: (jobId: string, error: string) => Promise<void>;
  },
  completionAttempts = 3,
): Promise<ClaimedJobResult> {
  try {
    await handler(job);
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof NonRetryableJobError) {
      const quarantineError = await tryQuarantine(job.id, message, jobQueue, completionAttempts);
      return quarantineError
        ? {
            jobId: job.id,
            jobType: job.jobType,
            status: 'failure_persistence_failed',
            error: `${message}; failed to quarantine non-retryable job: ${quarantineError}`,
          }
        : { jobId: job.id, jobType: job.jobType, status: 'quarantined', error: message };
    }

    let failError: unknown;
    for (let attempt = 0; attempt < Math.max(1, completionAttempts); attempt += 1) {
      try {
        await jobQueue.fail(job.id, message);
        return { jobId: job.id, jobType: job.jobType, status: 'failed', error: message };
      } catch (persistError) {
        failError = persistError;
      }
    }
    return {
      jobId: job.id,
      jobType: job.jobType,
      status: 'failure_persistence_failed',
      error: `${message}; failed to persist job failure: ${errorMessage(failError)}`,
    };
  }

  let completionError: unknown;
  for (let attempt = 0; attempt < Math.max(1, completionAttempts); attempt += 1) {
    try {
      await jobQueue.complete(job.id);
      return { jobId: job.id, jobType: job.jobType, status: 'completed' };
    } catch (error) {
      completionError = error;
    }
  }

  // Do not call fail(): the handler succeeded, and marking this retryable
  // would replay it. Quarantine the row for operator reconciliation instead.
  const message = `Handler succeeded but job completion could not be persisted: ${errorMessage(completionError)}`;
  const quarantineError = await tryQuarantine(
    job.id,
    message,
    jobQueue,
    completionAttempts,
  );
  return quarantineError
    ? {
        jobId: job.id,
        jobType: job.jobType,
        status: 'completion_persistence_failed',
        error: `${message}; failed to quarantine job: ${quarantineError}`,
      }
    : {
        jobId: job.id,
        jobType: job.jobType,
        status: 'completion_quarantined',
        error: message,
      };
}

async function tryQuarantine(
  jobId: string,
  message: string,
  jobQueue: { quarantine?: (id: string, error: string) => Promise<void> },
  attempts: number,
): Promise<string | null> {
  if (!jobQueue.quarantine) return 'quarantine operation is unavailable';

  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      await jobQueue.quarantine(jobId, message);
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  return errorMessage(lastError);
}
