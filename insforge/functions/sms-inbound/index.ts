/**
 * sms-inbound — Handles inbound SMS webhooks from providers.
 *
 * Auth: Webhook signature verification via the provider adapter.
 * Delegates to: InboundMessageService.processInboundSms
 *
 * Flow:
 * 1. Require the SMS provider in x-provider and reject non-local mock use
 * 2. Parse the inbound payload via the selected adapter
 * 3. Resolve the active provider account from the receiving phone route
 * 4. Verify the webhook with credentials from that trusted account
 * 5. Derive organization and provider from the trusted account context
 * 6. Create repositories and InboundMessageService
 * 7. Delegate to processInboundSms()
 * 8. Publish new_message realtime event on org:{orgId} channel
 * 9. Return 200 OK with message data
 *
 * Requirements: 7.4, 16.1, 16.2, 16.3, 23.1, 23.3
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.ts';
import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import {
  isLocalMockWebhookAllowed,
  parseSmsWebhookBody,
  readWebhookProvider,
  requestHeadersToRecord,
  resolveSmsInboundWebhookContext,
} from '../_shared/webhook-credentials.ts';

import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { InboundMessageService } from '../../../packages/support-core/src/services/inbound-message-service.ts';

import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';
import type { JobQueue } from '../../../packages/support-core/src/interfaces/job-queue.ts';
import type {
  Job,
  JobType,
  NormalizedInboundSms,
} from '../../../packages/support-core/src/types/index.ts';

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
// Helper: JSON response builder
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  try {
    // 1. Require an explicit provider. Missing/blank headers must not silently
    // downgrade to the unauthenticated mock adapter.
    const provider = readWebhookProvider(req.headers);
    if (!provider) {
      return jsonResponse({ error: 'x-provider header is required' }, 400);
    }

    // 2. Load runtime configuration before parsing mock payloads so deployed
    // endpoints reject the mock adapter without touching the database.
    const baseUrl =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
      process.env.NEXT_PUBLIC_INSFORGE_URL ??
      '';
    const localMockOptIn =
      (typeof Deno !== 'undefined'
        ? Deno.env.get('INBOXPILOT_ALLOW_LOCAL_MOCK_WEBHOOKS')
        : undefined) ??
      process.env.INBOXPILOT_ALLOW_LOCAL_MOCK_WEBHOOKS;

    if (provider === 'mock' && !isLocalMockWebhookAllowed(req.url, baseUrl, localMockOptIn)) {
      return jsonResponse({ error: 'Mock SMS webhooks are disabled outside local development' }, 403);
    }

    // 3. Read request body
    const rawBody = await req.text();

    // 4. Build provider registry and get adapter
    const registry = createProviderRegistry();

    let adapter;
    try {
      adapter = registry.getSmsAdapter(provider);
    } catch {
      return jsonResponse({ error: `Unknown SMS provider: ${provider}` }, 400);
    }

    // 5. Parse body in the provider's native webhook shape.
    let body: unknown;
    try {
      body = parseSmsWebhookBody(rawBody, provider);
    } catch {
      return jsonResponse({ error: 'Invalid webhook body' }, 400);
    }

    // 6. Parse and normalize inbound payload
    let normalized: NormalizedInboundSms;
    try {
      normalized = adapter.parseInboundWebhook(body);
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Invalid SMS webhook payload' },
        400,
      );
    }

    // 7. Create InsForge database client
    const serviceRoleKey =
      (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ??
      '';

    const db = createDbClient(baseUrl, serviceRoleKey);

    // 8. Resolve the trusted provider account and signing secret from storage.
    const webhookContext = await resolveSmsInboundWebhookContext(
      db,
      provider,
      normalized.to,
      baseUrl,
      serviceRoleKey,
    );

    if (!webhookContext) {
      return jsonResponse({ error: 'Webhook provider account not found' }, 401);
    }

    // 9. Verify webhook signature
    const isValid = await adapter.verifyWebhook({
      headers: requestHeadersToRecord(req.headers),
      body: rawBody,
      signingSecret: webhookContext.signingSecret,
    });

    if (!isValid) {
      return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
    }

    // 10. Use only the active route/account context for tenant and provider.
    const orgId = webhookContext.organizationId;
    const trustedProvider = webhookContext.provider;

    // 11. Create repositories and service
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

    // 12. Delegate to InboundMessageService
    const message = await inboundService.processInboundSms(
      normalized,
      orgId,
      trustedProvider,
    );

    // 13. Publish new_message realtime event
    const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
    await realtimePublisher.publish(`org:${orgId}`, 'new_message', {
      message,
      conversationId: message.conversationId,
    });

    // 14. The AI job is enqueued above. The `process-jobs` function picks it
    // up on its next cron tick (currently 10 seconds — see schedules in
    // InsForge dashboard). Function-to-function triggers within the same
    // Deno deployment are blocked by 508 LOOP_DETECTED, so a direct trigger
    // from this function is not possible. A Postgres http_post-based trigger
    // was attempted but the `http` extension is unreliable in this project.
    // The 10s cron cadence is the practical equivalent of event-driven.

    // 15. Return 200 OK with message data
    return jsonResponse({ status: 'ok', data: message });
  } catch (err) {
    console.error('sms-inbound error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
