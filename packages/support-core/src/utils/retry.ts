/**
 * withRetry — generic exponential-backoff retry helper.
 *
 * Used by the OutboundMessageService to retry transient provider errors
 * (Twilio 5xx, Postmark 5xx, network timeouts, etc.) before surfacing
 * a "message failed" state to the user.
 *
 * The helper is intentionally transport-agnostic. Callers pass:
 *   - `fn`:        the async operation to attempt
 *   - `maxAttempts`: cap on total attempts (1 means "no retry")
 *   - `backoffMs`: function returning ms to wait before attempt N+1,
 *                  given the 1-indexed failed attempt number
 *   - `isRetryable`: predicate deciding whether a thrown error is
 *                    worth retrying (defaults to `err.retryable === true`)
 *   - `onRetry`:    optional callback fired between attempts with the
 *                    thrown error and the 1-indexed attempt number
 *
 * Notes:
 *   - Backoff is scheduled with `setTimeout`, which respects Vitest's
 *     `vi.useFakeTimers()` and Node's native timer mocks.
 *   - When the final attempt fails, no backoff is scheduled and the
 *     last error is re-thrown.
 *   - Permanent errors (per `isRetryable`) are thrown immediately
 *     without further attempts.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Must be >= 1. */
  maxAttempts?: number;
  /**
   * Returns the backoff (ms) to wait before the next attempt, given
   * the 1-indexed number of the attempt that just failed.
   *
   * Defaults to exponential `2^(attempt-1) * 100ms` (100ms, 200ms, 400ms, ...).
   * Pass a function returning a constant for tests / fixed backoff.
   */
  backoffMs?: (attempt: number) => number;
  /**
   * Decide whether a thrown error is worth retrying.
   * Defaults to: error has a truthy `retryable` property.
   */
  isRetryable?: (err: unknown) => boolean;
  /**
   * Called between attempts with the error and 1-indexed attempt number.
   * Not called after the final attempt (no retry follows it).
   */
  onRetry?: (err: unknown, attempt: number) => void;
  /**
   * Injectable sleep implementation. Defaults to `setTimeout`.
   * Useful for tests that want to avoid real timers entirely.
   */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 100;

const defaultBackoff =
  (baseMs: number) =>
  (attempt: number): number =>
    baseMs * Math.pow(2, attempt - 1);

const defaultIsRetryable = (err: unknown): boolean => {
  if (err && typeof err === 'object' && 'retryable' in err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (err as any).retryable === true;
  }
  return false;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Execute `fn` with retry. Returns the resolved value on success.
 * Throws the last error if all attempts fail, or throws immediately
 * if a non-retryable error is encountered.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (maxAttempts < 1) {
    throw new Error(`withRetry: maxAttempts must be >= 1, got ${maxAttempts}`);
  }

  const backoff = options.backoffMs ?? defaultBackoff(DEFAULT_BASE_BACKOFF_MS);
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const onRetry = options.onRetry;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Last attempt? Surface the error; no point scheduling more work.
      if (attempt >= maxAttempts) {
        break;
      }

      // Non-retryable: throw immediately.
      if (!isRetryable(err)) {
        throw err;
      }

      // Schedule backoff, notify observer, then sleep before next attempt.
      if (onRetry) {
        onRetry(err, attempt);
      }
      const wait = backoff(attempt);
      if (wait > 0) {
        await sleep(wait);
      }
    }
  }

  // Exhausted all attempts on retryable failures.
  throw lastError;
}
