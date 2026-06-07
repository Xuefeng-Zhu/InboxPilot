/**
 * sms-status — Handles SMS delivery status webhooks from providers.
 *
 * Auth: Webhook signature verification via the provider adapter.
 *
 * Flow:
 * 1. Parse request body
 * 2. Determine SMS provider from x-provider header (default: 'mock')
 * 3. Verify webhook signature via adapter — return 401 if invalid
 * 4. Parse delivery status payload via adapter → NormalizedDeliveryStatus
 * 5. Look up the message by external_message_id using MessageRepository
 * 6. If message found: insert a delivery event via DeliveryEventRepository,
 *    update message delivery_status
 * 7. Return 200 OK
 *
 * Requirements: 7.6, 8.6, 16.1, 16.2, 16.3, 23.1, 23.2
 */

import { createDbClient } from '../_shared/create-db-client.js';

import { ProviderRegistry } from '../../../packages/support-core/src/interfaces/provider-registry.js';
import { MockSmsAdapter } from '../../../packages/support-core/src/adapters/mock-sms-adapter.js';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.js';
import { DeliveryEventRepository } from '../../../packages/support-core/src/repositories/delivery-event-repository.js';

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

    // 2. Determine SMS provider from header (default: 'mock')
    const provider = req.headers.get('x-provider') ?? 'mock';

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
    const signingSecret = req.headers.get('x-signing-secret') ?? '';
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

    // 5. Parse delivery status payload via adapter
    const normalizedStatus = adapter.parseStatusWebhook(body);

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

    // 7. Look up the message by external_message_id
    const messageRepo = new MessageRepository(db);
    const message = await messageRepo.findByExternalId(
      provider,
      normalizedStatus.externalMessageId,
    );

    if (!message) {
      // Message not found — acknowledge the webhook but take no action
      return jsonResponse({ status: 'ok', message: 'Message not found, status ignored' });
    }

    // 8. Insert delivery event record
    const deliveryEventRepo = new DeliveryEventRepository(db);
    await deliveryEventRepo.create('sms', {
      messageId: message.id,
      providerAccountId: message.providerAccountId,
      status: normalizedStatus.status,
      errorCode: normalizedStatus.errorCode ?? null,
      errorMessage: normalizedStatus.errorMessage ?? null,
      rawPayload: normalizedStatus.rawPayload,
    });

    // 9. Update message delivery_status
    await messageRepo.updateDeliveryStatus(message.id, normalizedStatus.status);

    // 10. Return 200 OK
    return jsonResponse({
      status: 'ok',
      data: {
        messageId: message.id,
        deliveryStatus: normalizedStatus.status,
      },
    });
  } catch (err) {
    console.error('sms-status error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
