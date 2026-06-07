/**
 * requireInternalToken - internal-dispatch authentication guard for
 * serverless function entrypoints that are *intended* to be called only
 * by trusted callers (the job queue, scheduled cron, the in-app
 * admin/dev trigger button), not by arbitrary HTTP clients.
 *
 * Background (CRITICAL-4, docs/QA_BUG_HUNT.md): the three internal
 * entrypoints `process-knowledge-document`, `process-ai-job`, and
 * `process-jobs` used to accept any request body and start doing real
 * work - re-embedding documents, running AI analysis on conversations,
 * or claiming up to ten queued jobs and running them. Because the
 * function URL is public, anyone who discovered it could amplify
 * AI-token costs (cost attack) and, in the re-embedding case, change
 * the KB retrieval result (data-integrity attack).
 *
 * This helper closes that hole. The caller must present a shared
 * secret in the custom header that exactly matches the server-side
 * env var `INTERNAL_DISPATCH_TOKEN`. The helper is constant-time on the comparison
 * so it cannot be used as a side channel to leak the token.
 *
 * The helper returns a discriminated result that the call site must
 * map to an HTTP response:
 *
 *   { kind: 'ok' }                  -> continue with the work
 *   { kind: 'misconfigured' }       -> 500 (server is missing the env var)
 *   { kind: 'unauthorized' }        -> 401 (header missing or wrong value)
 *
 * The helper never throws on auth failures. It MAY throw on missing
 * `Request` shape (no headers at all) since that's a programmer error
 * and indicates the caller didn't pass a real `Request` object.
 *
 * IMPORTANT: This is a SHARED-SECRET design. The token must be:
 *   - long (>= 32 random bytes / 64 hex chars)
 *   - generated with a cryptographically secure RNG
 *   - rotated periodically
 *   - stored in the InsForge function secret store, not in source
 *
 * Callers should pass the token in the custom header (case-insensitive
 * - `Request.headers.get` normalizes header names).
 */

const HEADER_NAME = "x-internal-token";
const ENV_NAME = "INTERNAL_DISPATCH_TOKEN";

/** Result of an internal-token check. */
export type InternalTokenResult =
  /** Token matched. Safe to proceed. */
  | { kind: 'ok' }
  /** Server is misconfigured: the env var is not set. */
  | { kind: 'misconfigured' }
  /** Token was missing, malformed, or did not match. */
  | { kind: 'unauthorized' };

/**
 * The canonical header name. Exported for use in tests and docs.
 */
export const INTERNAL_TOKEN_HEADER: string = HEADER_NAME;

/**
 * The canonical env var name. Exported for use in tests, deploy
 * scripts, and docs.
 */
export const INTERNAL_TOKEN_ENV: string = ENV_NAME;

/**
 * Verify the custom header against the env var.
 *
 * @param req - The incoming Request object
 * @param envToken - The configured token (read by the caller from
 *   `Deno.env.get` or `process.env`). Passing it in (rather than
 *   reading it inside the helper) keeps the helper easy to test.
 * @returns A discriminated result the caller must map to an HTTP response.
 */
export function requireInternalToken(
  req: Request,
  envToken: string | undefined,
): InternalTokenResult {
  // 1. Server-side misconfiguration: env var not set. Refuse to fall
  //    back to "no auth" - that would be the very bug we're fixing.
  if (!envToken || typeof envToken !== 'string' || envToken.length === 0) {
    return { kind: 'misconfigured' };
  }

  // 2. Read the caller's header. `headers.get` is case-insensitive
  //    per the Fetch spec.
  const provided = req.headers.get(HEADER_NAME);
  if (!provided || typeof provided !== 'string' || provided.length === 0) {
    return { kind: 'unauthorized' };
  }

  // 3. Constant-time compare so timing cannot be used to recover the
  //    token byte-by-byte. We always XOR every byte of `envToken`
  //    against either the corresponding `provided` byte or 0 (when
  //    lengths differ) so the wall-clock time is proportional to
  //    `envToken.length` rather than to where the first mismatch
  //    happened.
  if (!constantTimeEqualStrings(envToken, provided)) {
    return { kind: 'unauthorized' };
  }

  return { kind: 'ok' };
}

/**
 * Constant-time string comparison.
 *
 * - Returns `false` immediately if the two strings have different
 *   lengths. We pad the shorter one with zeros before the XOR walk
 *   so a length mismatch still costs the same number of byte
 *   comparisons as a length match, and so the difference cannot be
 *   distinguished by timing.
 * - Never throws on `undefined`/`null`; coerces to empty string.
 *
 * Exported for unit testing.
 */
export function constantTimeEqualStrings(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a ?? '');
  const bBytes = new TextEncoder().encode(b ?? '');
  const len = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length; // 0 if same length, non-zero if not
  for (let i = 0; i < len; i++) {
    const x = aBytes[i] ?? 0;
    const y = bBytes[i] ?? 0;
    diff |= x ^ y;
  }
  return diff === 0;
}
