/**
 * email-inbound — Handles inbound email webhooks from providers.
 *
 * Auth: Webhook signature verification via the provider adapter.
 * Delegates to: InboundMessageService.processInboundEmail
 *
 * Flow:
 * 1. Parse request body
 * 2. Determine email provider from x-provider header (default: 'mock')
 * 3. Verify webhook signature via adapter — return 401 if invalid
 * 4. Parse inbound payload via adapter
 * 5. Look up organization ID from the receiving email address (email_addresses table)
 * 6. Create repositories and InboundMessageService
 * 7. Delegate to processInboundEmail()
 * 8. Publish new_message realtime event on org:{orgId} channel
 * 9. Return 200 OK with message data
 *
 * Requirements: 8.4, 16.1, 16.2, 16.3, 23.2, 23.3
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';

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
// Helper: look up organization ID from the receiving email address
// ---------------------------------------------------------------------------

async function lookupOrgByEmailAddress(
  db: DatabaseClient,
  emailAddress: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('email_addresses')
    .select('organization_id')
    .eq('email_address', emailAddress)
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
      (typeof Deno !== 'undefined'
        ? (Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? req.headers.get('apikey'))
        : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ??
      req.headers.get('apikey') ??
      '';

    const db = createDbClient(baseUrl, serviceRoleKey);

    // 7. Determine organization ID from header or by looking up the receiving email address
    let orgId = req.headers.get('x-organization-id') ?? null;

    if (!orgId) {
      orgId = await lookupOrgByEmailAddress(db, normalized.to);
    }

    if (!orgId) {
      return jsonResponse(
        { error: 'Could not determine organization for receiving email address' },
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

    // 11. Trigger process-jobs to immediately handle the AI message job
    // Fire-and-forget — don't block the inbound response
    const functionsUrl = baseUrl.replace(/\.\w+-\w+\.insforge\.app/, '.functions.insforge.app');
    fetch(`${functionsUrl}/process-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: '{}',
    }).catch(() => { /* non-critical — job will be picked up on next trigger */ });

    // 12. Return 200 OK with message data
    return jsonResponse({ status: 'ok', data: message });
  } catch (err) {
    console.error('email-inbound error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
