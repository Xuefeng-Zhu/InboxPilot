/**
 * resolve-webhook-signing-secret — server-side helper that closes HIGH-6.
 *
 * BACKGROUND (docs/QA_BUG_HUNT.md, HIGH-6):
 *   The four webhook entrypoints (`email-inbound`, `sms-inbound`,
 *   `email-status`, `sms-status`) used to read the webhook signing
 *   secret from a *caller-controlled* request header (`x-signing-secret`).
 *   The function then called `adapter.verifyWebhook({ signingSecret })`
 *   with that caller-supplied value. Result: the *caller* was the source
 *   of truth for which org's secret to verify against. Combined with
 *   CRITICAL-1 (mock adapter's `verifyWebhook` returned `true`
 *   unconditionally) this meant an unauthenticated attacker could
 *   inject fake inbound messages or delivery-status events for any
 *   org whose id they could guess.
 *
 *   CRITICAL-1 has a separate fix (refuse `x-provider: mock` in
 *   production). HIGH-6's long-term fix is this helper: the secret is
 *   resolved server-side from the receiving address, not from the
 *   request.
 *
 * WHAT THIS DOES:
 *   1. Look up the receiving address in the *address* table
 *      (email: `email_addresses` by `email_address`; sms:
 *      `sms_phone_numbers` by `phone_number`).
 *   2. From the row, get the org id and the `provider_account_id`.
 *   3. Look up the *provider account* row
 *      (`email_provider_accounts` or `sms_provider_accounts` by id) to
 *      get the `provider` name and the `credentials_secret_id`.
 *   4. Verify the requested `provider` (from `x-provider` header)
 *      matches the row's `provider` column. A mismatch means the
 *      webhook is from a different provider than the one this address
 *      is registered to — reject it as an attempted mismatch attack.
 *   5. Resolve the `credentials_secret_id` to its plaintext value via
 *      the supplied `SecretStore` (typically `InsforgeHttpSecretStore`).
 *   6. Return both the org id and the resolved secret to the caller,
 *      who then calls `adapter.verifyWebhook({ signingSecret })` with
 *      the SERVER-RESOLVED secret. The caller-supplied
 *      `x-signing-secret` header is no longer read.
 *
 * WHY THIS LAYER:
 *   - The lookup is shared between email and SMS; only the address table
 *     and the provider-account table differ.
 *   - The SecretStore is injected so this helper is unit-testable with
 *     an in-memory store (see __tests__/webhook-signing-secret-resolver.test.ts).
 *   - This helper is *only* called from serverless function entrypoints;
 *     it never runs in the browser.
 *
 * @see docs/QA_BUG_HUNT.md HIGH-6 for the original finding.
 * @see docs/SECRET_ROTATION.md for the rotation runbook that creates
 *   the `credentials_secret_id` this helper resolves.
 */

import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';
import type { SecretStore } from '../../../packages/support-core/src/interfaces/secret-store.js';

/** Discriminated result returned by `resolveWebhookSigningSecret`. */
export type ResolveResult =
  /** Org id and secret resolved successfully. Safe to call `verifyWebhook`. */
  | { kind: 'ok'; orgId: string; signingSecret: string; providerAccountId: string }
  /** Caller requested provider does not match the row's `provider` column. */
  | { kind: 'provider_mismatch'; orgId: string; rowProvider: string; requestedProvider: string }
  /** The receiving address is not in the address table. */
  | { kind: 'address_unknown'; address: string }
  /** The address row references a provider account that no longer exists. */
  | { kind: 'provider_account_missing'; orgId: string; providerAccountId: string }
  /** The address row references an inactive provider account. */
  | { kind: 'provider_account_inactive'; orgId: string; providerAccountId: string }
  /** The secret was removed from the secrets store. Treat as auth failure. */
  | { kind: 'secret_missing'; credentialsSecretId: string };

/**
 * Generic resolver. Both `email-inbound` and `sms-inbound` share this
 * shape; they only differ in the two table names and the address column.
 *
 * @param db            - PostgREST-backed DatabaseClient (service-role)
 * @param secretStore   - SecretStore that resolves credentials_secret_id
 *                        to plaintext (typically InsforgeHttpSecretStore)
 * @param addressTable  - 'email_addresses' or 'sms_phone_numbers'
 * @param addressColumn - 'email_address' or 'phone_number'
 * @param providerAccountTable - 'email_provider_accounts' or
 *                        'sms_provider_accounts'
 * @param address       - the receiving `to` value from the parsed
 *                        webhook body (server-supplied, not caller)
 * @param requestedProvider - the provider name from `x-provider` header
 */
export async function resolveWebhookSigningSecret(params: {
  db: DatabaseClient;
  secretStore: SecretStore;
  addressTable: 'email_addresses' | 'sms_phone_numbers';
  addressColumn: 'email_address' | 'phone_number';
  providerAccountTable: 'email_provider_accounts' | 'sms_provider_accounts';
  address: string;
  requestedProvider: string;
}): Promise<ResolveResult> {
  const {
    db,
    secretStore,
    addressTable,
    addressColumn,
    providerAccountTable,
    address,
    requestedProvider,
  } = params;

  // 1. Look up the receiving address.
  const { data: addressRow, error: addrErr } = await db
    .from(addressTable)
    .select('organization_id,provider_account_id')
    .eq(addressColumn, address)
    .limit(1)
    .maybeSingle();

  if (addrErr) {
    throw new Error(
      `resolveWebhookSigningSecret: ${addressTable}.select failed — ${addrErr.message}`,
    );
  }
  if (!addressRow) {
    return { kind: 'address_unknown', address };
  }

  const addressRowShape = addressRow as Record<string, unknown>;
  const orgId = addressRowShape.organization_id as string;
  const providerAccountId = addressRowShape.provider_account_id as string;

  // 2. Look up the provider account.
  const { data: accountRow, error: acctErr } = await db
    .from(providerAccountTable)
    .select('provider,credentials_secret_id,is_active')
    .eq('id', providerAccountId)
    .maybeSingle();

  if (acctErr) {
    throw new Error(
      `resolveWebhookSigningSecret: ${providerAccountTable}.select failed — ${acctErr.message}`,
    );
  }
  if (!accountRow) {
    return { kind: 'provider_account_missing', orgId, providerAccountId };
  }

  const accountShape = accountRow as Record<string, unknown>;
  const rowProvider = accountShape.provider as string;
  const credentialsSecretId = accountShape.credentials_secret_id as string;
  const isActive = accountShape.is_active as boolean;

  // 3. Defense in depth: provider in `x-provider` header must match
  //    the row's `provider` column. Without this check, a Twilio
  //    webhook could claim `x-provider: postmark` and we'd happily
  //    verify its signature against the *postmark* credentials_secret_id
  //    for the receiving address. (Twilio's HMAC-SHA1 wouldn't validate
  //    against a postmark secret, so the attack would fail at the
  //    verify step — but the mismatch is still a useful canary and
  //    makes the failure mode obvious to operators.)
  if (rowProvider !== requestedProvider) {
    return {
      kind: 'provider_mismatch',
      orgId,
      rowProvider,
      requestedProvider,
    };
  }

  if (!isActive) {
    return { kind: 'provider_account_inactive', orgId, providerAccountId };
  }

  // 4. Resolve the secret from the secrets store.
  const signingSecret = await secretStore.get(credentialsSecretId);
  if (signingSecret === null) {
    return { kind: 'secret_missing', credentialsSecretId };
  }

  return { kind: 'ok', orgId, signingSecret, providerAccountId };
}
