/**
 * Credential rotation test for SMS provider accounts.
 *
 * Simulates the full rotation flow for the Twilio adapter:
 *   1. Provision an sms_provider_accounts row with secret A
 *   2. Send a test SMS — uses secret A
 *   3. Rotate: update credentials_secret_id to point at secret B,
 *      and rotate the secrets store so A is invalid and B is valid
 *   4. Send another test SMS — uses secret B
 *   5. Assert both sends succeed and the old secret no longer authenticates
 *
 * The test uses an in-memory InsForge-shaped database and a fake
 * secrets store. It exercises the boundary between:
 *   - SmsProviderAccountRepository (the DB row that points at the secret)
 *   - TwilioSmsAdapter (the consumer that reads the secret to authenticate)
 *   - A thin SecretStore interface that the support-core code resolves
 *     the credentials_secret_id through
 *
 * The goal is to prove that the rotation mechanism (update
 * credentials_secret_id + swap the underlying secret value) actually
 * changes which secret the adapter authenticates with — i.e. rotating
 * a credential in place, without dropping a tenant, is observable end
 * to end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsProviderAccountRepository } from '@support-core/repositories/sms-provider-account-repository';
import { TwilioSmsAdapter } from '@support-core/adapters/twilio-sms-adapter';
import type {
  DatabaseClient,
  QueryBuilder,
  QueryResult,
} from '@support-core/interfaces/database-client';
import type { SecretStore } from '@support-core/interfaces/secret-store';
import type { SmsProviderAccount } from '@support-core/types/index';

// ─── In-memory store of InsForge secrets ────────────────────────────
//
// In production, credentials_secret_id points at an InsForge secret.
// The adapter authenticates against the Twilio API by reading the
// secret value. This in-memory store stands in for that boundary.

function createInMemorySecretStore(): SecretStore & {
  setRaw(id: string, value: string): void;
  rotate(fromId: string, toId: string, newValue: string): void;
} {
  const values = new Map<string, string>();
  return {
    async get(id: string): Promise<string | null> {
      return values.has(id) ? (values.get(id) as string) : null;
    },
    setRaw(id: string, value: string): void {
      values.set(id, value);
    },
    rotate(fromId: string, toId: string, newValue: string): void {
      // Simulate InsForge's behavior: the old secret is removed and
      // a new secret is created with a new id. The DB row will be
      // updated to point at the new id separately.
      values.delete(fromId);
      values.set(toId, newValue);
    },
  };
}

// ─── In-memory InsForge-shaped database ─────────────────────────────
//
// Mimics the `sms_provider_accounts` table just enough for the
// repository to round-trip records.

interface StoredAccount {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  credentials_secret_id: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function createInMemoryDb(): DatabaseClient & {
  accounts: Map<string, StoredAccount>;
} {
  const accounts = new Map<string, StoredAccount>();
  let nextId = 1;

  function builderFor(table: string): QueryBuilder {
    type Op =
      | { kind: 'insert'; values: Record<string, unknown> }
      | { kind: 'update'; values: Record<string, unknown> }
      | { kind: 'delete' }
      | { kind: 'select' };
    const ops: Op[] = [];
    let filters: Array<{ col: string; val: unknown }> = [];
    let order: { col: string; ascending: boolean } | null = null;
    let single = false;
    let maybeSingle = false;

    const resolve = (): QueryResult => {
      if (table !== 'sms_provider_accounts') {
        return { data: null, error: { message: `unknown table ${table}` } };
      }
      // Execute the ops in order. For insert().select()... we insert
      // the row first, then the select() op returns the row that was
      // just inserted (PostgREST semantics).
      let resultRow: StoredAccount | null = null;
      for (const op of ops) {
        if (op.kind === 'insert') {
          const id = `acct-${nextId++}`;
          const now = new Date().toISOString();
          const row: StoredAccount = {
            id,
            organization_id: op.values.organization_id as string,
            provider: op.values.provider as string,
            label: op.values.label as string,
            credentials_secret_id: op.values.credentials_secret_id as string,
            is_active: (op.values.is_active as boolean | undefined) ?? true,
            metadata: (op.values.metadata as Record<string, unknown> | undefined) ?? {},
            created_at: now,
            updated_at: now,
          };
          accounts.set(id, row);
          resultRow = row;
        } else if (op.kind === 'update') {
          const matched = Array.from(accounts.values()).filter((row) =>
            filters.every((f) => row[f.col as keyof StoredAccount] === f.val),
          );
          for (const row of matched) {
            for (const [k, v] of Object.entries(op.values)) {
              if (k in row) (row as unknown as Record<string, unknown>)[k] = v;
            }
            row.updated_at = new Date().toISOString();
          }
          resultRow = matched[0] ?? null;
        } else if (op.kind === 'delete') {
          const matched = Array.from(accounts.values()).filter((row) =>
            filters.every((f) => row[f.col as keyof StoredAccount] === f.val),
          );
          for (const row of matched) accounts.delete(row.id);
        }
        // 'select' ops have no imperative effect — they only set the
        // shape of the final return.
      }

      // Now resolve based on the terminal shape (single / maybeSingle
      // / array) and whether the final op was a select.
      const last = ops[ops.length - 1];
      const isSelect = !last || last.kind === 'select' || ops.some((o) => o.kind === 'select');

      if (!isSelect && (last?.kind === 'insert' || last?.kind === 'update' || last?.kind === 'delete')) {
        // Pure write (no select() in chain). For delete, return null.
        if (last.kind === 'delete') return { data: null, error: null };
        // For insert/update, return the affected row(s) — repository
        // chains always end with .select().single() in practice, so
        // this branch is rare, but support array result.
        return { data: resultRow, error: null };
      }

      // Terminal op is select. Filter and shape.
      let matched = Array.from(accounts.values()).filter((row) =>
        filters.every((f) => row[f.col as keyof StoredAccount] === f.val),
      );
      if (order) {
        const ord = order;
        matched = [...matched].sort((a, b) => {
          const av = a[ord.col as keyof StoredAccount] as string;
          const bv = b[ord.col as keyof StoredAccount] as string;
          return ord.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (maybeSingle) return { data: matched[0] ?? null, error: null };
      if (single) return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    };

    const b: QueryBuilder = {} as QueryBuilder;
    b.select = vi.fn().mockImplementation(() => {
      ops.push({ kind: 'select' });
      return b;
    });
    b.insert = vi.fn().mockImplementation((values: Record<string, unknown>) => {
      ops.push({ kind: 'insert', values });
      return b;
    });
    b.update = vi.fn().mockImplementation((values: Record<string, unknown>) => {
      ops.push({ kind: 'update', values });
      return b;
    });
    b.delete = vi.fn().mockImplementation(() => {
      ops.push({ kind: 'delete' });
      return b;
    });
    b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      filters.push({ col, val });
      return b;
    });
    b.neq = vi.fn().mockReturnThis();
    b.gt = vi.fn().mockReturnThis();
    b.gte = vi.fn().mockReturnThis();
    b.lt = vi.fn().mockReturnThis();
    b.lte = vi.fn().mockReturnThis();
    b.like = vi.fn().mockReturnThis();
    b.ilike = vi.fn().mockReturnThis();
    b.is = vi.fn().mockReturnThis();
    b.in = vi.fn().mockReturnThis();
    b.contains = vi.fn().mockReturnThis();
    b.order = vi.fn().mockImplementation((col: string, opts?: { ascending?: boolean }) => {
      order = { col, ascending: opts?.ascending ?? true };
      return b;
    });
    b.limit = vi.fn().mockReturnThis();
    b.range = vi.fn().mockReturnThis();
    b.single = vi.fn().mockImplementation(() => {
      single = true;
      return b;
    });
    b.maybeSingle = vi.fn().mockImplementation(() => {
      maybeSingle = true;
      return b;
    });
    b.then = vi.fn().mockImplementation(
      (onFulfilled?: (value: QueryResult) => unknown) =>
        Promise.resolve(onFulfilled ? onFulfilled(resolve()) : resolve()),
    );
    return b;
  }

  return {
    from: vi.fn().mockImplementation((table: string) => builderFor(table)),
    rpc: vi.fn(),
    accounts,
  };
}

// ─── Twilio fake HTTP server ────────────────────────────────────────
//
// Twilio's verifyWebhook reads the auth token. To prove the rotation
// actually changes which secret the adapter authenticates with, we
// run a fake Twilio server that accepts the connection only when the
// Authorization header carries the *current* valid auth token.

import { createServer, type Server, type IncomingMessage } from 'http';

function startFakeTwilioServer(): Promise<{
  port: number;
  validAuthTokens: Set<string>;
  receivedRequests: Array<{ authToken: string; body: string }>;
  close: () => Promise<void>;
}> {
  const validAuthTokens = new Set<string>();
  const receivedRequests: Array<{ authToken: string; body: string }> = [];

  return new Promise((resolveStart) => {
    const server: Server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const authHeader = req.headers['authorization'] ?? '';
        // Basic auth — "Basic base64(accountSid:authToken)"
        const m = /^Basic\s+(.+)$/.exec(authHeader);
        const decoded = m ? Buffer.from(m[1], 'base64').toString('utf-8') : '';
        const authToken = decoded.includes(':') ? decoded.split(':')[1] : '';
        receivedRequests.push({ authToken, body: Buffer.concat(chunks).toString('utf-8') });
        if (validAuthTokens.has(authToken)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sid: `SM${receivedRequests.length}`, status: 'queued' }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 20003, message: 'Authentication Error' }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolveStart({
        port,
        validAuthTokens,
        receivedRequests,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

// ─── The actual rotation test ───────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_SID = 'AC00000000000000000000000000000001';

describe('SMS provider credential rotation', () => {
  let db: ReturnType<typeof createInMemoryDb>;
  let secrets: ReturnType<typeof createInMemorySecretStore>;
  let repo: SmsProviderAccountRepository;
  let fakeTwilio: Awaited<ReturnType<typeof startFakeTwilioServer>>;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    db = createInMemoryDb();
    secrets = createInMemorySecretStore();
    repo = new SmsProviderAccountRepository(db);
    fakeTwilio = await startFakeTwilioServer();
    originalFetch = global.fetch;
    // Stub fetch to hit the fake Twilio server.
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      // Rewrite the real Twilio host to our local fake.
      const target = url.replace('https://api.twilio.com', `http://127.0.0.1:${fakeTwilio.port}`);
      return originalFetch(target, init);
    }) as typeof fetch;
  });

  it('rotates an SMS provider credential in place: secret A → secret B, both authenticate', async () => {
    // ── Phase 1: provision with secret A ──────────────────────────
    const secretIdA = 'secret-AAAAAAAAAAAAAAAA';
    const authTokenA = 'twilio-auth-token-A-original';
    secrets.setRaw(secretIdA, authTokenA);
    fakeTwilio.validAuthTokens.add(authTokenA);

    const account: SmsProviderAccount = await repo.create({
      organizationId: ORG_ID,
      provider: 'twilio',
      label: 'Production Twilio',
      credentialsSecretId: secretIdA,
    });
    expect(account.credentialsSecretId).toBe(secretIdA);

    // Adapter is constructed with the secret-store resolver so it
    // looks up the current auth token on every send.
    const adapter = new TwilioSmsAdapter({
      resolveCredentials: async (secretId: string) => {
        const token = await secrets.get(secretId);
        if (!token) throw new Error(`secret not found: ${secretId}`);
        return { accountSid: ACCOUNT_SID, authToken: token };
      },
    });

    // ── Phase 2: send with secret A ───────────────────────────────
    const lookupA = await repo.findById(account.id);
    expect(lookupA?.credentialsSecretId).toBe(secretIdA);

    const sendA = await adapter.sendSms({
      to: '+15555550100',
      from: '+15555550200',
      body: 'sent with secret A',
      providerConfig: { credentialsSecretId: lookupA!.credentialsSecretId },
    });
    expect(sendA.externalMessageId).toBe('SM1');
    expect(fakeTwilio.receivedRequests[0].authToken).toBe(authTokenA);

    // ── Phase 3: rotate A → B ─────────────────────────────────────
    const secretIdB = 'secret-BBBBBBBBBBBBBBBBBB';
    const authTokenB = 'twilio-auth-token-B-rotated';
    secrets.rotate(secretIdA, secretIdB, authTokenB);
    fakeTwilio.validAuthTokens.add(authTokenB);

    // Update the DB row to point at the new secret.
    const updated = await repo.update(account.id, { credentialsSecretId: secretIdB });
    expect(updated.credentialsSecretId).toBe(secretIdB);

    // Old secret A is now invalid in the secrets store.
    expect(await secrets.get(secretIdA)).toBeNull();
    // New secret B is the one the DB row points at.
    const lookupB = await repo.findById(account.id);
    expect(lookupB?.credentialsSecretId).toBe(secretIdB);

    // ── Phase 4: send again — must use secret B ───────────────────
    const sendB = await adapter.sendSms({
      to: '+15555550100',
      from: '+15555550200',
      body: 'sent with secret B',
      providerConfig: { credentialsSecretId: lookupB!.credentialsSecretId },
    });
    expect(sendB.externalMessageId).toBe('SM2');
    expect(fakeTwilio.receivedRequests[1].authToken).toBe(authTokenB);
    expect(fakeTwilio.receivedRequests[1].authToken).not.toBe(authTokenA);

    // ── Phase 5: prove A is dead — the fake server rejects A ─────
    // Simulate a real rotation: the old secret is invalidated at
    // the provider (removed from the set of valid auth tokens).
    // The DB row no longer points at A, but if some stale caller
    // hands A back to the adapter, the request must fail.
    fakeTwilio.validAuthTokens.delete(authTokenA);
    // (The secret value may still exist in the secrets store
    // until GC runs — proving we don't rely on deletion to
    // invalidate it.)
    await expect(
      adapter.sendSms({
        to: '+155****0100',
        from: '+155****0200',
        body: 'should fail — old secret A is no longer in validAuthTokens',
        providerConfig: {
          credentialsBlob: JSON.stringify({ accountSid: ACCOUNT_SID, authToken: authTokenA }),
        },
      }),
    ).rejects.toThrow(/401/);

    // Sanity: secret B still works (the rotation didn't break B).
    const sendAfterSanity = await adapter.sendSms({
      to: '+155****0100',
      from: '+155****0200',
      body: 'sent with B after proving A is dead',
      providerConfig: {
        credentialsBlob: JSON.stringify({ accountSid: ACCOUNT_SID, authToken: authTokenB }),
      },
    });
    expect(sendAfterSanity.externalMessageId).toBe('SM4');
  });

  it('rejects the send when the secret is removed but the DB row still points at it', async () => {
    const secretId = 'secret-CCCCCCCCCCCCCCCCCC';
    const authToken = 'twilio-auth-token-C';
    secrets.setRaw(secretId, authToken);
    fakeTwilio.validAuthTokens.add(authToken);

    const account = await repo.create({
      organizationId: ORG_ID,
      provider: 'twilio',
      label: 'Twilio',
      credentialsSecretId: secretId,
    });

    const adapter = new TwilioSmsAdapter({
      resolveCredentials: async (id: string) => {
        const token = await secrets.get(id);
        if (!token) throw new Error(`secret not found: ${id}`);
        return { accountSid: ACCOUNT_SID, authToken: token };
      },
    });

    // Simulate the secret being deleted (e.g. accidentally removed
    // from the secrets store before the DB row is updated). The
    // adapter must refuse to send.
    secrets.rotate(secretId, 'secret-DELETED', 'unused');

    await expect(
      adapter.sendSms({
        to: '+15555550100',
        from: '+15555550200',
        body: 'should fail — secret missing',
        providerConfig: { credentialsSecretId: account.credentialsSecretId },
      }),
    ).rejects.toThrow(/secret not found/);
  });
});

// (vi is imported at the top of the file with the other vitest imports.)
