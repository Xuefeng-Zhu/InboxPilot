/**
 * sms-inbound — Handles inbound SMS webhooks from providers.
 *
 * Auth: Webhook signature verification via the provider adapter.
 * Delegates to: InboundMessageService.processInboundSms
 *
 * Flow:
 * 1. Parse request body
 * 2. Determine SMS provider from x-provider header (default: 'mock')
 * 3. Verify webhook signature via adapter — return 401 if invalid
 * 4. Parse inbound payload via adapter
 * 5. Look up organization ID from the receiving phone number (sms_phone_numbers table)
 * 6. Create repositories and InboundMessageService
 * 7. Delegate to processInboundSms()
 * 8. Publish new_message realtime event on org:{orgId} channel
 * 9. Return 200 OK with message data
 *
 * Requirements: 7.4, 16.1, 16.2, 16.3, 23.1, 23.3
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { log, logError, newRequestContext, withRequest, withRequestIdHeader } from '../_shared/logger.js';

import { ProviderRegistry } from '../../../packages/support-core/src/interfaces/provider-registry.js';
import { MockSmsAdapter } from '../../../packages/support-core/src/adapters/mock-sms-adapter.js';
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
    throw new Error('claim() not implemented in sms-inbound context');
  }

  async complete(_jobId: string): Promise<void> {
    throw new Error('complete() not implemented in sms-inbound context');
  }

  async fail(_jobId: string, _error: string): Promise<void> {
    throw new Error('fail() not implemented in sms-inbound context');
  }
}

// ---------------------------------------------------------------------------
// Helper: look up organization ID from the receiving phone number
// ---------------------------------------------------------------------------

async function lookupOrgByPhoneNumber(
  db: DatabaseClient,
  phoneNumber: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('sms_phone_numbers')
    .select('organization_id')
    .eq('phone_number', phoneNumber)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return (data as Record<string, unknown>).organization_id as string;
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
  const ctx = newRequestContext('sms-inbound', req);
  try {
    const response = await withRequest(ctx, async () => {
      // 1. Parse request body
      const rawBody = await req.text();
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      // 2. Determine SMS provider from header (default: 'mock')
      const provider = req.headers.get('x-provider') ?? 'mock';
      log({ ...ctx, level: 'debug', msg: 'sms provider selected', provider });

      // CRITICAL-1 mitigation: refuse the mock provider in production. The mock
      // adapter is for local development and tests only — it must never be
      // reachable on a deployed URL, even with a valid signing secret.
      if (provider === 'mock' && readEnv('ENV') === 'production') {
        return jsonResponse(
          { error: 'Mock SMS provider is disabled in production' },
          400,
        );
      }

      // 3. Build provider registry and get adapter
      const registry = new ProviderRegistry();
      registry.registerSmsAdapter('mock', new MockSmsAdapter());
      // Future: register Twilio, Telnyx, etc. adapters here

      let adapter;
      try {
        adapter = registry.getSmsAdapter(provider);
      } catch {
        return jsonResponse({ error: `Unknown SMS provider: ${provider}` }, 400);
      }

      // 4. Verify webhook signature
      const signingSecret =
        req.headers.get('x-signing-secret') ?? '';
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const isValid = await adapter.verifyWebhook({
        headers,
        body: rawBody,
        signingSecret,
      });

      if (!isValid) {
        return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
      }

      // 5. Parse and normalize inbound payload
      const normalized = adapter.parseInboundWebhook(body);

      // 6. Create InsForge database client
      const baseUrl =
        (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
        process.env.NEXT_PUBLIC_INSFORGE_URL ??
        '';
      const serviceRoleKey =
        (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
        process.env.INSFORGE_SERVICE_ROLE_KEY ??
        '';

      const db = createDbClient(baseUrl, serviceRoleKey);

      // 7. Determine organization ID from the receiving phone number.
      // The org is always derived from the server-verifiable receiving
      // address (sms_phone_numbers table) — never from a caller-supplied
      // header. See docs/QA_BUG_HUNT.md CRITICAL-3.
      const orgId = await lookupOrgByPhoneNumber(db, normalized.to);
      if (orgId) ctx.org_id = orgId;

      if (!orgId) {
        return jsonResponse(
          { error: 'Could not determine organization for receiving phone number' },
          404,
        );
      }

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
      const message = await inboundService.processInboundSms(
        normalized,
        orgId,
        provider,
      );
      log({ ...ctx, level: 'info', msg: 'sms processed', message_id: message.id });

      // 10. Publish new_message realtime event
      const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
      await realtimePublisher.publish(`org:${orgId}`, 'new_message', {
        message,
        conversationId: message.conversationId,
      });

      // 11. Return 200 OK with message data
      return jsonResponse({ status: 'ok', data: message });
    });
    return withRequestIdHeader(ctx, response);
  } catch (err) {
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
