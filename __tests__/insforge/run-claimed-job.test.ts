import { describe, expect, it, vi } from 'vitest';
import {
  NonRetryableJobError,
  runClaimedJob,
} from '../../insforge/functions/_shared/run-claimed-job';
import type { Job } from '../../packages/support-core/src/types/index.ts';

const job: Job = {
  id: 'job-1',
  organizationId: 'org-1',
  jobType: 'send_outbound_message',
  payload: { conversationId: 'conv-1', aiDecisionId: 'decision-1' },
  status: 'claimed',
  attempts: 0,
  maxAttempts: 5,
  lastError: null,
  runAfter: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  completedAt: null,
};

describe('runClaimedJob', () => {
  it('marks handler failures retryable', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const queue = {
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runClaimedJob(job, handler, queue);

    expect(queue.fail).toHaveBeenCalledWith(job.id, 'provider unavailable');
    expect(queue.complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed', error: 'provider unavailable' });
  });

  it('reports when the handler failure itself cannot be persisted', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const queue = {
      complete: vi.fn(),
      fail: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };

    const result = await runClaimedJob(job, handler, queue);

    expect(result).toMatchObject({
      status: 'failure_persistence_failed',
      error: expect.stringContaining('failed to persist job failure'),
    });
  });

  it('retries completion without replaying a successful handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error('write timeout'))
        .mockResolvedValueOnce(undefined),
      fail: vi.fn(),
    };

    const result = await runClaimedJob(job, handler, queue);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.complete).toHaveBeenCalledTimes(2);
    expect(queue.fail).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('never marks a successfully handled job retryable when completion persists fail', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = {
      complete: vi.fn().mockRejectedValue(new Error('database unavailable')),
      fail: vi.fn(),
      quarantine: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runClaimedJob(job, handler, queue, 3);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.complete).toHaveBeenCalledTimes(3);
    expect(queue.fail).not.toHaveBeenCalled();
    expect(queue.quarantine).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'completion_quarantined' });
  });

  it('quarantines non-retryable handler failures without calling fail', async () => {
    const handler = vi.fn().mockRejectedValue(
      new NonRetryableJobError('provider accepted without reconciliation'),
    );
    const queue = {
      complete: vi.fn(),
      fail: vi.fn(),
      quarantine: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runClaimedJob(job, handler, queue);

    expect(queue.fail).not.toHaveBeenCalled();
    expect(queue.quarantine).toHaveBeenCalledWith(
      job.id,
      'provider accepted without reconciliation',
    );
    expect(result.status).toBe('quarantined');
  });
});
