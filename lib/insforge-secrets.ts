/**
 * InsForge Secrets API client (Node runtime).
 *
 * Runtime-specific wrapper around the canonical implementation in
 * `packages/support-core/src/utils/insforge-secrets.ts`. This module
 * resolves config from Node `process.env` and delegates to the shared
 * portable implementation.
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

import { getSecretRaw as coreGetSecretRaw, getSecret as coreGetSecret } from '@support-core/utils/insforge-secrets';

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
 * Resolves config from Node `process.env` and delegates to the canonical
 * implementation in `packages/support-core/src/utils/insforge-secrets.ts`.
 *
 * Never caches the result: this runs in a serverless context, and the next
 * invocation may be a different process.
 */
export async function getSecretRaw(secretId: string): Promise<string | null> {
  const { baseUrl, serviceRoleKey } = getConfig();
  return coreGetSecretRaw(secretId, baseUrl, serviceRoleKey);
}

/**
 * Fetch an InsForge secret and JSON-parse its value into `T`.
 *
 * Resolves config from Node `process.env` and delegates to the canonical
 * implementation in `packages/support-core/src/utils/insforge-secrets.ts`.
 */
export async function getSecret<T = unknown>(secretId: string): Promise<T | null> {
  const { baseUrl, serviceRoleKey } = getConfig();
  return coreGetSecret<T>(secretId, baseUrl, serviceRoleKey);
}
