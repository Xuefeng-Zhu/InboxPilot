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

import { createDbClient } from '../_shared/create-db-client.ts';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.ts';
import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import { triggerProcessJobs } from '../_shared/trigger-process-jobs.ts';

import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { InboundMessageService } from '../../../packages/support-core/src/services/inbound-message-service.ts';

import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';
import type { JobQueue } from '../../../packages/support-core/src/interfaces/job-queue.ts';
import type { Job, JobType } from '../../../packages/support-core/src/types/index.ts';

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

    // 2. Determine SMS provider from header (default: 'mock')
    const provider = req.headers.get('x-provider') ?? 'mock';

    // 3. Build provider registry and get adapter
    const registry = createProviderRegistry();

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

    // 7. Determine organization ID from the receiving phone number
    let orgId = req.headers.get('x-organization-id') ?? null;

    if (!orgId) {
      orgId = await lookupOrgByPhoneNumber(db, normalized.to);
    }

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

    // 10. Publish new_message realtime event
    const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
    await realtimePublisher.publish(`org:${orgId}`, 'new_message', {
      message,
      conversationId: message.conversationId,
    });

    // 11. Trigger process-jobs to immediately handle the AI message job.
    // Bounded await (≤5s) so the trigger reliably fires after enqueue rather
    // than relying on the cron safety net. The cron remains as a fallback.
    await triggerProcessJobs({ baseUrl, serviceRoleKey });

    // 12. Return 200 OK with message data
    return jsonResponse({ status: 'ok', data: message });
  } catch (err) {
    console.error('sms-inbound error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
