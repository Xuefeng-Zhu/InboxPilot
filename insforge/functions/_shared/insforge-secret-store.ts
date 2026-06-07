/**
 * InsForge SecretStore — HTTP-backed implementation of the SecretStore
 * interface defined in `packages/support-core/src/interfaces/secret-store.ts`.
 *
 * Bridges the entrypoint layer to the InsForge secrets endpoint. Serverless
 * function entrypoints that need a per-org provider credential (Twilio auth
 * token, Postmark server token, etc.) construct one of these and call `.get(credentials_secret_id)`
 * to resolve the opaque DB-stored id into its plaintext value.
 *
 * Why this lives in `_shared/` and not in `support-core`:
 *   - The `SecretStore` *interface* lives in support-core (portable, no
 *     InsForge SDK import). This concrete impl is the InsForge-specific
 *     adapter — same shape as `createDbClient` vs the portable `DatabaseClient`.
 *   - Function entrypoints already import from `_shared/`; the import
 *     boundary is "this file is InsForge-specific and only function code
 *     uses it".
 *
 * Endpoints used (InsForge secrets HTTP API):
 *   GET {baseUrl}/secrets/v1/{secretId}
 *     Headers: apikey: <serviceRoleKey>, Authorization: Bearer <serviceRoleKey>
 *     Response 200: { id, value, created_at, updated_at }
 *     Response 404: { error: { message: "secret not found" } }
 *
 * SECURITY: this implementation always uses the SERVICE ROLE key for auth,
 * never a user token. The service role is server-side only and has full
 * read access to secrets. Callers MUST NOT log the resolved `value`.
 */

import type { SecretStore } from '../../../packages/support-core/src/interfaces/secret-store.js';

/** JSON shape of `GET /secrets/v1/{id}` on success. */
interface InsforgeSecretResponse {
  id: string;
  value: string;
  created_at?: string;
  updated_at?: string;
}

/** JSON shape of `GET /secrets/v1/{id}` on failure (404, 500, etc.). */
interface InsforgeSecretErrorResponse {
  error?: { message?: string; code?: string };
  message?: string;
}

/**
 * Implementation of `SecretStore` backed by the InsForge secrets HTTP API.
 *
 * The class is constructed once per function invocation (entrypoints
 * instantiate it inline) and used to resolve a single `credentials_secret_id`
 * per request. It is intentionally stateless and cheap to construct.
 *
 * `put` and `remove` are implemented as no-ops here because the webhook
 * entrypoints only ever read; rotation is the SMS/email settings page's
 * job. Keeping them as throw-not-implemented would prevent test code
 * (e.g. the in-memory rotation test) from substituting its own impl.
 *
 * @param baseUrl - InsForge project base URL (e.g. `https://wga6k9at.us-east.insforge.app`)
 * @param serviceRoleKey - InsForge service role key (server-side only, never
 *   sent to the browser). Used as both `apikey` and bearer token.
 */
export class InsforgeHttpSecretStore implements SecretStore {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  /**
   * Resolve a `credentials_secret_id` to its plaintext value.
   *
   * Returns `null` if:
   *   - The secret has been removed (rotated out, accidentally deleted).
   *   - The InsForge backend returns 404.
   *
   * Throws on infrastructure failures (network, 5xx, malformed JSON) so
   * the caller can distinguish "the secret is gone" (deny the webhook
   * with 401) from "the secrets service is broken" (deny with 500 and
   * page an operator).
   */
  async get(secretId: string): Promise<string | null> {
    if (typeof secretId !== 'string' || secretId.length === 0) {
      // Treat empty/missing id as "not found" rather than throwing —
      // matches the contract of `SecretStore.get`.
      return null;
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/secrets/v1/${encodeURIComponent(secretId)}`, {
        method: 'GET',
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
        },
      });
    } catch (err) {
      throw new Error(
        `InsforgeHttpSecretStore.get: network error fetching secret ${secretId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as InsforgeSecretErrorResponse;
      const msg = body.error?.message ?? body.message ?? `HTTP ${res.status}`;
      throw new Error(
        `InsforgeHttpSecretStore.get: failed to fetch secret ${secretId} — ${msg}`,
      );
    }

    const data = (await res.json()) as InsforgeSecretResponse;
    if (typeof data.value !== 'string') {
      throw new Error(
        `InsforgeHttpSecretStore.get: secret ${secretId} returned a non-string value (type=${typeof data.value})`,
      );
    }
    return data.value;
  }

  /**
   * NOT IMPLEMENTED in this adapter.
   *
   * Webhook entrypoints never create or rotate secrets — that is the
   * tenant-settings UI's responsibility (see `docs/SECRET_ROTATION.md`).
   * Throwing keeps the contract honest: any caller that tries to write
   * through this adapter is misusing the abstraction.
   */
  async put(_secretId: string, _value: string): Promise<string> {
    throw new Error(
      'InsforgeHttpSecretStore.put: not implemented; rotation is handled by the settings UI',
    );
  }

  /**
   * NOT IMPLEMENTED — see put() above.
   */
  async remove(_secretId: string): Promise<boolean> {
    throw new Error(
      'InsforgeHttpSecretStore.remove: not implemented; rotation is handled by the settings UI',
    );
  }
}
