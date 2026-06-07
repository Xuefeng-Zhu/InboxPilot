/**
 * Regression tests for HIGH-6 fix — webhook signing secret source.
 *
 * Background (docs/QA_BUG_HUNT.md, HIGH-6):
 *   The webhook entrypoints (email-inbound, sms-inbound) used to read
 *   the signing secret from a CALLER-CONTROLLED request header
 *   (`x-signing-secret`). Combined with the mock adapter's no-op
 *   verifyWebhook (CRITICAL-1, now mitigated by production guard),
 *   an attacker could inject fake inbound messages into any org.
 *
 *   The fix resolves the secret server-side from the receiving
 *   address: email_addresses / sms_phone_numbers → *_provider_accounts
 *   .credentials_secret_id → InsForge secrets HTTP endpoint. The
 *   `x-signing-secret` header is no longer consulted.
 *
 * These tests exercise the resolver helper (`resolveWebhookSigningSecret`)
 * directly with an in-memory database and an in-memory SecretStore. They
 * prove:
 *   1. A happy-path lookup returns the org id and the resolved secret.
 *   2. The x-provider header value is cross-checked against the row's
 *      `provider` column — a mismatch returns provider_mismatch.
 *   3. An unknown address returns address_unknown.
 *   4. A missing provider account row returns provider_account_missing.
 *   5. An inactive provider account returns provider_account_inactive.
 *   6. A missing secret (rotated out) returns secret_missing.
 *
 * Companion tests for the entrypoint layer are in
 * `__tests__/webhook-signing-secret-source.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveWebhookSigningSecret,
  type ResolveResult,
} from '../insforge/functions/_shared/resolve-webhook-signing-secret';
import type {
  DatabaseClient,
  QueryBuilder,
  QueryResult,
} from '../packages/support-core/src/interfaces/database-client';
import type { SecretStore } from '../packages/support-core/src/interfaces/secret-store';

// ─── In-memory store of InsForge secrets ────────────────────────────

function createInMemorySecretStore(values: Record<string, string>): SecretStore {
  return {
    async get(id: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(values, id) ? values[id]! : null;
    },
    async put(): Promise<string> {
      throw new Error('not used');
    },
    async remove(): Promise<boolean> {
      throw new Error('not used');
    },
  };
}

// ─── In-memory InsForge-shaped database ─────────────────────────────
//
// Mimics the address + provider-account tables just enough for the
// resolver to round-trip records. We support the small set of operations
// the resolver actually calls:
//   db.from(table).select(...).eq(col, val).limit(1).maybeSingle()
//   db.from(table).select(...).eq(col, val).maybeSingle()
//
// Each "table" is backed by an array of rows; we filter by the
// accumulated .eq() filters and shape the response based on .single()
// / .maybeSingle() / .limit().

interface AddressRow {
  organization_id: string;
  provider_account_id: string;
  [key: string]: unknown;
}

interface ProviderAccountRow {
  id: string;
  provider: string;
  credentials_secret_id: string;
  is_active: boolean;
  [key: string]: unknown;
}

interface FakeDb {
  db: DatabaseClient;
  addresses: AddressRow[];
  accounts: ProviderAccountRow[];
  /** Records the most recent (table, column, value) tuple for assertions. */
  lastQuery: { table: string; column: string; value: unknown } | null;
}

function createFakeDb(): FakeDb {
  const addresses: AddressRow[] = [];
  const accounts: ProviderAccountRow[] = [];
  const state: FakeDb = {
    db: undefined as unknown as DatabaseClient,
    addresses,
    accounts,
    lastQuery: null,
  };

  function makeBuilder(table: string): QueryBuilder {
    const filters: Array<{ col: string; val: unknown }> = [];
    let limitN: number | undefined;
    let isSingle = false;
    let isMaybeSingle = false;

    const find = (): Record<string, unknown> | null => {
      const rows =
        table === 'email_addresses' || table === 'sms_phone_numbers'
          ? (addresses as unknown as Record<string, unknown>[])
          : table === 'email_provider_accounts' || table === 'sms_provider_accounts'
            ? (accounts as unknown as Record<string, unknown>[])
            : [];
      for (const row of rows) {
        if (filters.every((f) => row[f.col] === f.val)) {
          return { ...row };
        }
      }
      return null;
    };

    const resolve = (): QueryResult => {
      const row = find();
      if (isMaybeSingle) return { data: row, error: null };
      if (isSingle) return { data: row, error: row ? null : { message: 'no rows' } };
      const all = find() ? [find() as Record<string, unknown>] : [];
      return { data: limitN !== undefined ? all.slice(0, limitN) : all, error: null };
    };

    const b: QueryBuilder = {} as QueryBuilder;
    b.select = vi.fn().mockReturnThis();
    b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      filters.push({ col, val });
      if (state.lastQuery === null) {
        state.lastQuery = { table, column: col, value: val };
      }
      return b;
    });
    b.limit = vi.fn().mockImplementation((n: number) => {
      limitN = n;
      return b;
    });
    b.single = vi.fn().mockImplementation(() => {
      isSingle = true;
      return b;
    });
    b.maybeSingle = vi.fn().mockImplementation(() => {
      isMaybeSingle = true;
      return b;
    });
    b.order = vi.fn().mockReturnThis();
    b.range = vi.fn().mockReturnThis();
    b.then = <T>(onfulfilled?: (value: QueryResult) => T | PromiseLike<T>) =>
      Promise.resolve(resolve()).then(onfulfilled);
    return b;
  }

  state.db = {
    from(table: string): QueryBuilder {
      return makeBuilder(table);
    },
    async rpc(): Promise<QueryResult> {
      throw new Error('not used');
    },
  };

  return state;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('HIGH-6: resolveWebhookSigningSecret (webhook signing secret source)', () => {
  it('resolves the per-org secret from email_addresses + email_provider_accounts', async () => {
    const orgId = 'org-acme-001';
    const accountId = 'acct-postmark-001';
    const secretId = 'sec-postmark-token-001';
    const secretValue = 'server-token-do-not-leak';

    const dbState = createFakeDb();
    dbState.addresses.push({
      email_address: 'support@acme.com',
      organization_id: orgId,
      provider_account_id: accountId,
    });
    dbState.accounts.push({
      id: accountId,
      provider: 'postmark',
      credentials_secret_id: secretId,
      is_active: true,
    });
    const secretStore = createInMemorySecretStore({ [secretId]: secretValue });

    const result: ResolveResult = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@acme.com',
      requestedProvider: 'postmark',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.orgId).toBe(orgId);
      expect(result.signingSecret).toBe(secretValue);
      expect(result.providerAccountId).toBe(accountId);
    }
  });

  it('resolves the per-org secret from sms_phone_numbers + sms_provider_accounts', async () => {
    const orgId = 'org-acme-002';
    const accountId = 'acct-twilio-001';
    const secretId = 'sec-twilio-token-001';
    const secretValue = 'twilio-auth-token-do-not-leak';

    const dbState = createFakeDb();
    dbState.addresses.push({
      phone_number: '+155****9999',
      organization_id: orgId,
      provider_account_id: accountId,
    });
    dbState.accounts.push({
      id: accountId,
      provider: 'twilio',
      credentials_secret_id: secretId,
      is_active: true,
    });
    const secretStore = createInMemorySecretStore({ [secretId]: secretValue });

    const result = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'sms_phone_numbers',
      addressColumn: 'phone_number',
      providerAccountTable: 'sms_provider_accounts',
      address: '+155****9999',
      requestedProvider: 'twilio',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.orgId).toBe(orgId);
      expect(result.signingSecret).toBe(secretValue);
    }
  });

  it('returns provider_mismatch when x-provider disagrees with the row provider', async () => {
    // Receiving email is registered to a postmark account, but the
    // caller claims x-provider: twilio. Almost certainly a mismatch
    // attack — refuse.
    const dbState = createFakeDb();
    dbState.addresses.push({
      email_address: 'support@acme.com',
      organization_id: 'org-acme-003',
      provider_account_id: 'acct-postmark-002',
    });
    dbState.accounts.push({
      id: 'acct-postmark-002',
      provider: 'postmark',
      credentials_secret_id: 'sec-x',
      is_active: true,
    });
    const secretStore = createInMemorySecretStore({ 'sec-x': 'token-x' });

    const result = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@acme.com',
      requestedProvider: 'twilio', // <-- the attack
    });

    expect(result.kind).toBe('provider_mismatch');
    if (result.kind === 'provider_mismatch') {
      expect(result.rowProvider).toBe('postmark');
      expect(result.requestedProvider).toBe('twilio');
    }
  });

  it('returns address_unknown for an unregistered receiving address', async () => {
    const dbState = createFakeDb();
    // no rows — the address is unknown
    const secretStore = createInMemorySecretStore({});

    const result = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'unknown@nowhere.example',
      requestedProvider: 'postmark',
    });

    expect(result.kind).toBe('address_unknown');
    if (result.kind === 'address_unknown') {
      expect(result.address).toBe('unknown@nowhere.example');
    }
  });

  it('returns provider_account_missing when the address row references a deleted account', async () => {
    const dbState = createFakeDb();
    dbState.addresses.push({
      email_address: 'support@acme.com',
      organization_id: 'org-acme-004',
      provider_account_id: 'acct-deleted',
    });
    // No account row for 'acct-deleted' — the account was deleted
    // (e.g. CASCADE-removed during a tenant offboarding) but the
    // email_addresses row survived. Defensive: refuse.
    const secretStore = createInMemorySecretStore({});

    const result = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@acme.com',
      requestedProvider: 'postmark',
    });

    expect(result.kind).toBe('provider_account_missing');
  });

  it('returns provider_account_inactive when the account is_active=false', async () => {
    const dbState = createFakeDb();
    dbState.addresses.push({
      email_address: 'support@acme.com',
      organization_id: 'org-acme-005',
      provider_account_id: 'acct-disabled',
    });
    dbState.accounts.push({
      id: 'acct-disabled',
      provider: 'postmark',
      credentials_secret_id: 'sec-disabled',
      is_active: false,
    });
    const secretStore = createInMemorySecretStore({ 'sec-disabled': 'token-disabled' });

    const result = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@acme.com',
      requestedProvider: 'postmark',
    });

    expect(result.kind).toBe('provider_account_inactive');
  });

  it('returns secret_missing when the credentials_secret_id is gone from the store', async () => {
    // Rotation in progress: the DB row still points at the OLD secret
    // id, but the secret has been removed from the InsForge secrets
    // store. Resolving should return secret_missing (not throw).
    const dbState = createFakeDb();
    dbState.addresses.push({
      email_address: 'support@acme.com',
      organization_id: 'org-acme-006',
      provider_account_id: 'acct-rotated',
    });
    dbState.accounts.push({
      id: 'acct-rotated',
      provider: 'postmark',
      credentials_secret_id: 'sec-rotated-out',
      is_active: true,
    });
    // Empty secret store — the secret is gone.
    const secretStore = createInMemorySecretStore({});

    const result = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@acme.com',
      requestedProvider: 'postmark',
    });

    expect(result.kind).toBe('secret_missing');
    if (result.kind === 'secret_missing') {
      expect(result.credentialsSecretId).toBe('sec-rotated-out');
    }
  });

  it('two orgs with the same provider resolve to DIFFERENT secrets (tenant isolation)', async () => {
    // Smoke test: the secret lookup is scoped to the address row,
    // not global. Org A and Org B both have postmark accounts with
    // different tokens; the resolver must return each org's own.
    const dbState = createFakeDb();
    dbState.addresses.push({
      email_address: 'support@orgA.com',
      organization_id: 'org-A',
      provider_account_id: 'acct-postmark-A',
    });
    dbState.addresses.push({
      email_address: 'support@orgB.com',
      organization_id: 'org-B',
      provider_account_id: 'acct-postmark-B',
    });
    dbState.accounts.push({
      id: 'acct-postmark-A',
      provider: 'postmark',
      credentials_secret_id: 'sec-A',
      is_active: true,
    });
    dbState.accounts.push({
      id: 'acct-postmark-B',
      provider: 'postmark',
      credentials_secret_id: 'sec-B',
      is_active: true,
    });
    const secretStore = createInMemorySecretStore({
      'sec-A': 'token-A',
      'sec-B': 'token-B',
    });

    const resultA = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@orgA.com',
      requestedProvider: 'postmark',
    });
    const resultB = await resolveWebhookSigningSecret({
      db: dbState.db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: 'support@orgB.com',
      requestedProvider: 'postmark',
    });

    expect(resultA.kind).toBe('ok');
    expect(resultB.kind).toBe('ok');
    if (resultA.kind === 'ok' && resultB.kind === 'ok') {
      expect(resultA.signingSecret).toBe('token-A');
      expect(resultA.orgId).toBe('org-A');
      expect(resultB.signingSecret).toBe('token-B');
      expect(resultB.orgId).toBe('org-B');
    }
  });
});
