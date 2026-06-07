/**
 * SecretStore — abstraction over the InsForge secrets store.
 *
 * The support-core package never imports the InsForge SDK directly;
 * production code resolves a `credentials_secret_id` (an opaque
 * reference into the secrets store) by calling this interface.
 *
 * Why this exists:
 *   - Adapters (Twilio, Postmark) need the *value* of the credential
 *     to authenticate, not just the row that points at it.
 *   - The DB row (e.g. `sms_provider_accounts.credentials_secret_id`)
 *     is a stable identifier; rotating the credential means creating a
 *     new secret and pointing the row at the new id, without changing
 *     the row itself.
 *   - Test code substitutes an in-memory implementation to exercise
 *     the rotation path without touching real secrets.
 *
 * The interface is intentionally tiny — get/put/remove covers the
 * three operations any rotation runbook needs. The `get` call returns
 * `null` (not `undefined`) when the secret has been removed, so the
 * adapter can distinguish "deleted" from "not yet set".
 */

export interface SecretStore {
  /**
   * Resolve a secret id to its value. Returns `null` if the secret
   * has been removed (rotated out, accidentally deleted, etc.).
   *
   * Throws only on infrastructure failures (network, IAM) — not on
   * "not found". Adapters should treat `null` as "do not send".
   */
  get(secretId: string): Promise<string | null>;

  /**
   * Create or overwrite a secret. Returns the secret id (which may
   * differ from the input on systems that auto-generate ids; the
   * caller should use the returned id to update the DB row).
   */
  put(secretId: string, value: string): Promise<string>;

  /**
   * Remove a secret by id. Idempotent — removing a missing id is a
   * no-op, not an error. Returns true if a secret was actually
   * removed, false if it was already gone.
   */
  remove(secretId: string): Promise<boolean>;
}

/**
 * Materialized credentials for a Twilio account. The secret store
 * returns JSON of this shape so we can store multiple fields
 * (accountSid + authToken) in one secret value.
 */
export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

/**
 * Helper for serializing/deserializing the JSON credential blob.
 * The InsForge secrets store treats values as opaque strings, so
 * adapters that need multiple fields (Twilio: sid + token) wrap them
 * in JSON.
 */
export function encodeTwilioCredentials(creds: TwilioCredentials): string {
  return JSON.stringify(creds);
}

export function decodeTwilioCredentials(blob: string): TwilioCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new Error('SecretStore: stored Twilio credentials are not valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).accountSid !== 'string' ||
    typeof (parsed as Record<string, unknown>).authToken !== 'string'
  ) {
    throw new Error(
      'SecretStore: stored Twilio credentials must include accountSid and authToken strings',
    );
  }
  const obj = parsed as Record<string, string>;
  return { accountSid: obj.accountSid, authToken: obj.authToken };
}
