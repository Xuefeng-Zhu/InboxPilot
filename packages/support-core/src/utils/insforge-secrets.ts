/**
 * InsForge Secrets API client (portable, runtime-agnostic).
 *
 * Resolves InsForge `secrets` by ID to their decrypted value at runtime.
 * The InboxPilot provider model stores `credentials_secret_id` on
 * `sms_provider_accounts` and `email_provider_accounts`; this module
 * resolves that reference to the actual secret value at the moment a
 * caller needs to call a provider.
 *
 * Convention: secret VALUES are JSON-encoded with provider-specific fields.
 *   - Twilio:    { accountSid: string, authToken: string }
 *   - Postmark:  { serverToken: string }
 *   - Telnyx:    { apiKey: string, webhookPublicKey?: string, publicKey?: string }
 *
 * The Mock provider skips this lookup entirely: callers should short-circuit
 * and not call getSecret when the provider is 'mock' (no remote credentials
 * required).
 *
 * Error model:
 *   - 404           → returns null (soft error; caller decides how to handle)
 *   - 5xx           → throws Error with the response body in the message
 *   - other 4xx     → throws Error with status and body
 *   - network error → throws (the underlying fetch error propagates)
 *
 * Never caches the result: each invocation may be a different process.
 *
 * This module is the canonical implementation. Runtime-specific wrappers
 * (Deno: `insforge/functions/_shared/insforge-secrets.ts`, Node: `lib/insforge-secrets.ts`)
 * handle config resolution and delegate to these functions.
 */

/**
 * Fetch the raw string value of an InsForge secret.
 *
 * Returns `null` for a 404 (secret not found) so callers can decide what to
 * do — for example, fall back to a default or surface a configuration error.
 * Throws on any other non-2xx response; for 5xx, the response body is
 * embedded in the thrown error message so the underlying failure is visible.
 */
export async function getSecretRaw(
  secretId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<string | null> {
  const url = `${baseUrl}/api/secrets/${encodeURIComponent(secretId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `InsForge secrets API ${response.status} for "${secretId}": ${body || '<no body>'}`,
    );
  }

  return response.text();
}

/**
 * Fetch an InsForge secret and JSON-parse its value into `T`.
 *
 * Returns `null` if the secret is missing (404) OR if the stored value is not
 * valid JSON. Per the convention, secret values are expected to be
 * JSON-encoded with provider-specific fields; a non-JSON value cannot be
 * consumed by the typed adapter code, so the caller sees `null` and decides.
 *
 * Example:
 *   const cfg = await getSecret<{ accountSid: string; authToken: string }>(
 *     smsAccount.credentialsSecretId,
 *     baseUrl,
 *     serviceRoleKey,
 *   );
 *   if (!cfg) throw new Error('Twilio credentials not configured');
 *   // use cfg.accountSid, cfg.authToken
 */
export async function getSecret<T = unknown>(
  secretId: string,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<T | null> {
  const raw = await getSecretRaw(secretId, baseUrl, serviceRoleKey);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Non-JSON value: the convention requires JSON-encoded provider
    // credentials. A value that doesn't parse is not usable by the typed
    // adapter code, so surface it as a soft error (null) rather than throw.
    return null;
  }
}
