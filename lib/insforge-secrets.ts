/**
 * InsForge Secrets API client (Node runtime).
 *
 * Resolves InsForge `secrets` by ID to their decrypted value at runtime.
 * The InboxPilot provider model stores `credentials_secret_id` on
 * `sms_provider_accounts` and `email_provider_accounts`; this module
 * resolves that reference to the actual secret value at the moment a
 * route handler needs to call a provider.
 *
 * Convention: secret VALUES are JSON-encoded with provider-specific fields.
 *   - Twilio:    { accountSid: string, authToken: string }
 *   - Postmark:  { serverToken: string }
 *   - Telnyx:    { apiKey: string }
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
 *   - missing env   → throws Error naming the missing variable
 *
 * Used by:
 *   - app/api/functions/test-channel-connection  (health check)
 *   - app/api/functions/send-reply               (outbound send)
 */

const INSFORGE_URL_ENV = 'NEXT_PUBLIC_INSFORGE_URL';
const INSFORGE_KEY_ENV = 'INSFORGE_SERVICE_ROLE_KEY';

interface InsforgeConfig {
  baseUrl: string;
  serviceRoleKey: string;
}

function getConfig(): InsforgeConfig {
  const baseUrl = process.env[INSFORGE_URL_ENV];
  const serviceRoleKey = process.env[INSFORGE_KEY_ENV];
  if (!baseUrl) {
    throw new Error(`getSecret: ${INSFORGE_URL_ENV} not set`);
  }
  if (!serviceRoleKey) {
    throw new Error(`getSecret: ${INSFORGE_KEY_ENV} not set`);
  }
  return { baseUrl, serviceRoleKey };
}

/**
 * Fetch the raw string value of an InsForge secret.
 *
 * Returns `null` for a 404 (secret not found) so callers can decide what to
 * do — for example, fall back to a default or surface a configuration error.
 * Throws on any other non-2xx response; for 5xx, the response body is
 * embedded in the thrown error message so the underlying failure is visible.
 *
 * Never caches the result: this runs in a serverless context, and the next
 * invocation may be a different process.
 */
export async function getSecretRaw(secretId: string): Promise<string | null> {
  const { baseUrl, serviceRoleKey } = getConfig();
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
 */
export async function getSecret<T = unknown>(secretId: string): Promise<T | null> {
  const raw = await getSecretRaw(secretId);
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
