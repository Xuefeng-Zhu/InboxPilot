/**
 * Provider health check (external function, not an interface method).
 *
 * Tests the reachability of a provider WITHOUT sending real traffic.
 * For real providers, uses a safe GET endpoint that returns metadata
 * without side effects (Twilio `/Accounts/{sid}.json`, Postmark `/servers`).
 *
 * Result shape:
 *   - { ok: true,  message?: string, latencyMs?: number } — provider reachable
 *   - { ok: false, reason?: string }                     — provider unreachable OR not implemented
 *
 * Invariants:
 *   - NEVER throws. All errors are caught and returned as `{ ok: false, reason }`.
 *   - NEVER calls `sendSms` / `sendEmail` (real cost, real traffic).
 *   - NEVER logs `providerConfig` (it contains secrets).
 *   - Mock provider short-circuits with `{ ok: true }` (no remote ping).
 *   - Telnyx returns `{ ok: false, reason: '... ed25519 webhook verification ...' }`
 *     because the only available reachability test is webhook signature verification,
 *     which is a static crypto check, not a network ping.
 *   - The 8 stubs (Bandwidth, Vonage, Plivo, MessageBird, Mailgun, Resend, AwsSes, InsForge)
 *     return `{ ok: false, reason: 'Provider not implemented in this build' }`.
 */

import type { SmsProviderAdapter } from './interfaces/sms-provider-adapter.js';
import type { EmailProviderAdapter } from './interfaces/email-provider-adapter.js';

export interface HealthCheckResult {
  ok: boolean;
  message?: string;
  reason?: string;
  latencyMs?: number;
}

/**
 * Dispatch health check based on `adapter.providerId`.
 *
 * @param adapter       An SMS or email provider adapter (any concrete impl).
 * @param providerConfig Per-call credentials (e.g. `{ accountSid, authToken }` for Twilio).
 *                       Read inside provider branches; never logged.
 */
export async function healthCheck(
  adapter: SmsProviderAdapter | EmailProviderAdapter,
  providerConfig: Record<string, unknown>,
): Promise<HealthCheckResult> {
  const providerId = adapter.providerId;

  if (providerId === 'mock') {
    return { ok: true, message: 'Mock provider (no remote ping)' };
  }

  if (providerId === 'twilio') {
    return checkTwilio(providerConfig);
  }

  if (providerId === 'telnyx') {
    return {
      ok: false,
      reason: 'Telnyx health check not implemented (ed25519 webhook verification is the only test available)',
    };
  }

  if (providerId === 'postmark') {
    return checkPostmark(providerConfig);
  }

  // 8 stubs: Bandwidth, Vonage, Plivo, MessageBird (SMS);
  //          Mailgun, Resend, AwsSes, InsForge (email).
  return { ok: false, reason: 'Provider not implemented in this build' };
}

// ─── Twilio ────────────────────────────────────────────────────────────

/**
 * GET https://api.twilio.com/2010-04-01/Accounts/{accountSid}.json
 * Auth: HTTP Basic with `accountSid:authToken` base64-encoded.
 *
 * This is the same account-metadata endpoint the Twilio dashboard uses to
 * validate credentials — it does NOT send any message.
 */
async function checkTwilio(providerConfig: Record<string, unknown>): Promise<HealthCheckResult> {
  const accountSid = typeof providerConfig['accountSid'] === 'string'
    ? (providerConfig['accountSid'] as string)
    : '';
  const authToken = typeof providerConfig['authToken'] === 'string'
    ? (providerConfig['authToken'] as string)
    : '';

  if (!accountSid || !authToken) {
    return { ok: false, reason: 'Twilio providerConfig must contain accountSid and authToken' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  return safeHttpPing(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  }, (res) => res.ok
    ? { ok: true, message: 'Twilio account reachable' }
    : { ok: false, message: `HTTP ${res.status}` },
  );
}

// ─── Postmark ──────────────────────────────────────────────────────────

/**
 * GET https://api.postmarkapp.com/servers
 * Auth: `X-Postmark-Server-Token: <token>` header.
 *
 * Returns the list of servers for the token — metadata only, no send.
 */
async function checkPostmark(providerConfig: Record<string, unknown>): Promise<HealthCheckResult> {
  const serverToken = typeof providerConfig['serverToken'] === 'string'
    ? (providerConfig['serverToken'] as string)
    : '';

  if (!serverToken) {
    return { ok: false, reason: 'Postmark providerConfig must contain serverToken' };
  }

  const url = 'https://api.postmarkapp.com/servers';

  return safeHttpPing(url, {
    method: 'GET',
    headers: {
      'X-Postmark-Server-Token': serverToken,
      Accept: 'application/json',
    },
  }, (res) => res.ok
    ? { ok: true, message: 'Postmark account reachable' }
    : { ok: false, message: `HTTP ${res.status}` },
  );
}

// ─── Shared HTTP ping helper ───────────────────────────────────────────

interface HttpPingShape {
  status: number;
  ok: boolean;
}

/** Hard cap on outbound ping duration. Bounds the worst case (hung TLS, etc.). */
const HTTP_PING_TIMEOUT_MS = 5_000;

/**
 * Execute a GET (or any read-only) HTTP request, measure latency with
 * `performance.now()`, and translate the response into a `HealthCheckResult`
 * via the provided mapper. NEVER throws — any error is returned as
 * `{ ok: false, reason }`.
 *
 * A 5s `AbortSignal.timeout` is attached to every request so a hung
 * connection cannot block the caller indefinitely. `performance.now()` is
 * available globally in Node 18+ and Deno; `AbortSignal.timeout` is
 * available in Node 18+ and Deno.
 */
async function safeHttpPing(
  url: string,
  init: RequestInit,
  mapResult: (res: HttpPingShape) => HealthCheckResult,
): Promise<HealthCheckResult> {
  const start = performance.now();
  const signal = AbortSignal.timeout(HTTP_PING_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal });
    const latencyMs = Math.round(performance.now() - start);
    const base = mapResult({ status: response.status, ok: response.ok });
    return { ...base, latencyMs };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - start);
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason, latencyMs };
  }
}
