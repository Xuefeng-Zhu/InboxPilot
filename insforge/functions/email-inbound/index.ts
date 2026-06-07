/**
 * email-inbound — Handles inbound email webhooks from providers.
 *
 * Auth: Webhook signature verification via the provider adapter. The
 * signing secret is resolved SERVER-SIDE from the receiving email
 * address (email_addresses → email_provider_accounts.credentials_secret_id
 * → InsForge secrets endpoint) — never from a caller-supplied header.
 * See HIGH-6 in docs/QA_BUG_HUNT.md.
 * Delegates to: InboundMessageService.processInboundEmail
 *
 * Flow:
 * 1. Parse request body
 * 2. Determine email provider from x-provider header; refuse mock in production
 * 3. Build the provider registry and pick the adapter for x-provider
 * 4. Parse the inbound payload to learn the receiving email address
 * 5. Construct the InsForge DB + secrets clients (service role)
 * 6. Resolve the per-org signing secret by receiving email address
 *    (refuses the request if the address is unknown, the provider
 *    mismatches, the secret has been rotated out, etc.)
 * 7. Verify the webhook signature with the server-resolved secret
 * 8. Create repositories and InboundMessageService
 * 9. Delegate to processInboundEmail()
 * 10. Publish new_message realtime event on org:{orgId} channel
 * 11. Return 200 OK with message data
 *
 * Requirements: 8.4, 16.1, 16.2, 16.3, 23.2, 23.3
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { InsforgeHttpSecretStore } from '../_shared/insforge-secret-store.js';
import { resolveWebhookSigningSecret } from '../_shared/resolve-webhook-signing-secret.js';

import { ProviderRegistry } from '../../../packages/support-core/src/interfaces/provider-registry.js';
import { MockEmailAdapter } from '../../../packages/support-core/src/adapters/mock-email-adapter.js';
import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.js';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';
import { InboundMessageService } from '../../../packages/support-core/src/services/inbound-message-service.js';

import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';
import type { JobQueue } from '../../../packages/support-core/src/interfaces/job-queue.js';
import type { Job, JobType } from '../../../packages/support-core/src/types/index.js';

// ---------------------------------------------------------------------------
// Minimal JobQueue implementation backed by PostgREST
// ---------------------------------------------------------------------------

/**
 * A lightweight JobQueue that enqueues jobs via the PostgREST insert API.
 * Only the `enqueue` method is needed for inbound processing; claim/complete/fail
 * are used by the process-jobs function and are stubbed here.
 */
class PostgRestJobQueue implements JobQueue {
  constructor(private db: DatabaseClient) {}

  async enqueue(
    jobType: JobType,
    payload: Record<string, unknown>,
    orgId: string,
  ): Promise<Job> {
    const row = {
      organization_id: orgId,
      job_type: jobType,
      payload,
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    };

    const { data, error } = await this.db
      .from('support_jobs')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`PostgRestJobQueue.enqueue failed: ${error.message}`);
    }

    const d = data as Record<string, unknown>;
    return {
      id: d.id as string,
      organizationId: d.organization_id as string,
      jobType: d.job_type as JobType,
      payload: d.payload as Record<string, unknown>,
      status: d.status as Job['status'],
      attempts: d.attempts as number,
      maxAttempts: d.max_attempts as number,
      lastError: (d.last_error as string) ?? null,
      runAfter: new Date(d.run_after as string),
      createdAt: new Date(d.created_at as string),
      updatedAt: new Date(d.updated_at as string),
      completedAt: d.completed_at ? new Date(d.completed_at as string) : null,
    };
  }

  async claim(_limit: number): Promise<Job[]> {
    throw new Error('claim() not implemented in email-inbound context');
  }

  async complete(_jobId: string): Promise<void> {
    throw new Error('complete() not implemented in email-inbound context');
  }

  async fail(_jobId: string, _error: string): Promise<void> {
    throw new Error('fail() not implemented in email-inbound context');
  }
}

// ---------------------------------------------------------------------------
// Helper: JSON response builder
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Helper: read an env var across Deno / Node runtimes
// ---------------------------------------------------------------------------

/**
 * Read an environment variable, working in both Deno (serverless function) and
 * Node (local dev / tests) runtimes. Returns `undefined` if not set.
 *
 * Uses the `(globalThis as ...).Deno` cast pattern instead of `typeof Deno !==
 * 'undefined'` because Next.js's bundled TypeScript pass does not have Deno
 * ambient types, and the cast pattern avoids type-checker false positives.
 * Same pattern is used in `process-jobs/index.ts`.
 */
function readEnv(key: string): string | undefined {
  const g = globalThis as Record<string, unknown>;
  if (g.Deno && typeof g.Deno === 'object') {
    const deno = g.Deno as { env?: { get?: (k: string) => string | undefined } };
    try {
      if (deno.env && typeof deno.env.get === 'function') {
        const v = deno.env.get(key);
        if (typeof v === 'string' && v.length > 0) return v;
      }
    } catch {
      // Deno.env.get can throw on permission errors; fall through to process.env.
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  try {
    // 1. Parse request body
    const rawBody = await req.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    // 2. Determine email provider from header (default: 'mock')
    const provider = req.headers.get('x-provider') ?? 'mock';

    // CRITICAL-1 mitigation: refuse the mock provider in production. The mock
    // adapter is for local development and tests only — it must never be
    // reachable on a deployed URL, even with a valid signing secret.
    if (provider === 'mock' && readEnv('ENV') === 'production') {
      return jsonResponse(
        { error: 'Mock email provider is disabled in production' },
        400,
      );
    }

    // 3. Build provider registry and get adapter
    const registry = new ProviderRegistry();
    registry.registerEmailAdapter('mock', new MockEmailAdapter());
    // Future: register Postmark, SendGrid, etc. adapters here

    let adapter;
    try {
      adapter = registry.getEmailAdapter(provider);
    } catch {
      return jsonResponse({ error: `Unknown email provider: ${provider}` }, 400);
    }

    // 4. Parse the inbound payload FIRST (server-side, not caller-supplied)
    //    so we know the `to` address. The body and the parsed `to` are
    //    server-derived; the only caller-derived signal is the HTTP
    //    envelope, which we treat as untrusted.
    let normalized;
    try {
      normalized = adapter.parseInboundWebhook(body);
    } catch (err) {
      return jsonResponse(
        { error: 'Invalid inbound payload', message: err instanceof Error ? err.message : 'parse failed' },
        400,
      );
    }

    // 5. Construct the InsForge DB + secrets clients (service role).
    const baseUrl =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
      process.env.NEXT_PUBLIC_INSFORGE_URL ??
      '';
    const serviceRoleKey =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ??
      '';

    const db = createDbClient(baseUrl, serviceRoleKey);
    const secretStore = new InsforgeHttpSecretStore(baseUrl, serviceRoleKey);

    // 6. HIGH-6 fix: resolve the per-org webhook signing secret from
    //    the receiving email address — never from a request header.
    //    The x-signing-secret header is no longer consulted (it would
    //    be caller-controlled, see QA_BUG_HUNT.md).
    const resolution = await resolveWebhookSigningSecret({
      db,
      secretStore,
      addressTable: 'email_addresses',
      addressColumn: 'email_address',
      providerAccountTable: 'email_provider_accounts',
      address: normalized.to,
      requestedProvider: provider,
    });

    if (resolution.kind === 'address_unknown') {
      // No tenant has registered this receiving address. This is
      // indistinguishable from a forged webhook targeting a non-existent
      // address — refuse with 404 (and the same 401-shaped reason string
      // so attackers cannot enumerate registered addresses).
      return jsonResponse({ error: 'Webhook signature verification failed' }, 404);
    }
    if (resolution.kind === 'provider_mismatch') {
      // Defense in depth: x-provider claims a different provider than
      // the row's `provider` column. Almost certainly a mismatch attack
      // — refuse with 401.
      return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
    }
    if (resolution.kind === 'provider_account_missing') {
      return jsonResponse({ error: 'Webhook signature verification failed' }, 500);
    }
    if (resolution.kind === 'provider_account_inactive') {
      // The org's provider account has been disabled (e.g. rotation
      // in progress). 401 — the webhook cannot be processed.
      return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
    }
    if (resolution.kind === 'secret_missing') {
      // The credentials_secret_id in the DB no longer resolves in the
      // secrets store. This is the post-rotation-cleanup state. Refuse
      // with 401 and let an operator notice via the missing-secret
      // log line emitted in the resolver.
      return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
    }

    // 7. Verify webhook signature with the SERVER-RESOLVED secret.
    //    Build the headers map for the adapter.
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const isValid = await adapter.verifyWebhook({
      headers,
      body: rawBody,
      signingSecret: resolution.signingSecret,
    });

    if (!isValid) {
      return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
    }

    const orgId = resolution.orgId;

    // 8. Create repositories and service
    const contactRepo = new ContactRepository(db);
    const conversationRepo = new ConversationRepository(db);
    const messageRepo = new MessageRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const jobQueue = new PostgRestJobQueue(db);

    const inboundService = new InboundMessageService(
      contactRepo,
      conversationRepo,
      messageRepo,
      jobQueue,
      auditLogRepo,
    );

    // 9. Delegate to InboundMessageService
    const message = await inboundService.processInboundEmail(
      normalized,
      orgId,
      provider,
    );

    // 10. Publish new_message realtime event
    const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
    await realtimePublisher.publish(`org:${orgId}`, 'new_message', {
      message,
      conversationId: message.conversationId,
    });

    // 11. Return 200 OK with message data
    return jsonResponse({ status: 'ok', data: message });
  } catch (err) {
    console.error('email-inbound error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
