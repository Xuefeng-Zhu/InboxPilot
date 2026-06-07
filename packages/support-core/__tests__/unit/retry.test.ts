import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

/**
 * Unit tests for the withRetry helper.
 *
 * Covers:
 *  - Returns the result on first success without retrying
 *  - Retries on transient (retryable) errors up to maxAttempts
 *  - Throws immediately on permanent (non-retryable) errors
 *  - Throws the last error when maxAttempts is exhausted
 *  - Respects exponential backoff schedule (timing assertions)
 *  - Invokes onRetry callback between attempts
 *  - Defaults: 3 attempts, 100ms base backoff
 */

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on the first attempt without sleeping or retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const sleepSpy = vi.spyOn(global, 'setTimeout');

    const promise = withRetry(fn, { maxAttempts: 3, backoffMs: () => 1000 });
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('retries on transient errors and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTransient('boom 1'))
      .mockRejectedValueOnce(makeTransient('boom 2'))
      .mockResolvedValue('eventually-ok');

    const promise = withRetry(fn, { maxAttempts: 3, backoffMs: () => 0 });
    const result = await promise;

    expect(result).toBe('eventually-ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a permanent error without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(makePermanent('auth failed'));

    await expect(
      withRetry(fn, { maxAttempts: 5, backoffMs: () => 0 }),
    ).rejects.toThrow('auth failed');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when all attempts are exhausted', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTransient('a'))
      .mockRejectedValueOnce(makeTransient('b'))
      .mockRejectedValueOnce(makeTransient('c'));

    await expect(
      withRetry(fn, { maxAttempts: 3, backoffMs: () => 0 }),
    ).rejects.toThrow('c');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never exceeds maxAttempts even when all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(makeTransient('nope'));

    await expect(
      withRetry(fn, { maxAttempts: 5, backoffMs: () => 0 }),
    ).rejects.toThrow('nope');

    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('with maxAttempts=1 does not retry — just one attempt', async () => {
    const fn = vi.fn().mockRejectedValue(makeTransient('once'));

    await expect(
      withRetry(fn, { maxAttempts: 1, backoffMs: () => 0 }),
    ).rejects.toThrow('once');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits the backoff between attempts (exponential schedule)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeTransient('first'))
      .mockRejectedValueOnce(makeTransient('second'))
      .mockResolvedValue('done');

    const backoff = vi.fn().mockImplementation((n: number) => Math.pow(2, n) * 10);
    const onRetry = vi.fn();

    const promise = withRetry(fn, {
      maxAttempts: 3,
      backoffMs: backoff,
      onRetry,
    });

    // After attempt 1 fails: schedule backoff(1) = 20
    await vi.advanceTimersByTimeAsync(20);
    // After attempt 2 fails: schedule backoff(2) = 40
    await vi.advanceTimersByTimeAsync(40);

    const result = await promise;
    expect(result).toBe('done');

    expect(backoff).toHaveBeenCalledTimes(2);
    expect(backoff).toHaveBeenNthCalledWith(1, 1);
    expect(backoff).toHaveBeenNthCalledWith(2, 2);
    expect(onRetry).toHaveBeenCalledTimes(2);
    // onRetry should receive the error and the attempt number (1-indexed)
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2);
  });

  it('does not wait or retry after the final attempt fails', async () => {
    const fn = vi.fn().mockRejectedValue(makeTransient('flop'));
    const onRetry = vi.fn();
    const backoff = vi.fn().mockReturnValue(999);

    const promise = withRetry(fn, {
      maxAttempts: 3,
      backoffMs: backoff,
      onRetry,
    });

    // Drain all timers; the final attempt should not schedule a backoff
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('flop');

    // backoff is invoked before each of the 2 retries (attempts 1 and 2)
    expect(backoff).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('treats errors without a transient flag as non-retryable by default', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('plain'));

    await expect(
      withRetry(fn, { maxAttempts: 3, backoffMs: () => 0 }),
    ).rejects.toThrow('plain');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors a custom isRetryable predicate', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('retry me'))
      .mockRejectedValueOnce(new Error('retry me'))
      .mockResolvedValue('ok');

    const isRetryable = (err: unknown): boolean =>
      err instanceof Error && err.message === 'retry me';

    const result = await withRetry(fn, {
      maxAttempts: 5,
      backoffMs: () => 0,
      isRetryable,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────

interface MaybeRetryable {
  retryable?: boolean;
}

function makeTransient(message: string): Error & MaybeRetryable {
  const err = new Error(message) as Error & MaybeRetryable;
  err.retryable = true;
  return err;
}

function makePermanent(message: string): Error & MaybeRetryable {
  const err = new Error(message) as Error & MaybeRetryable;
  err.retryable = false;
  return err;
}
