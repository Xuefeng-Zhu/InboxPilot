/**
 * email-status — Handles email delivery status webhooks from providers.
 *
 * Auth: Webhook signature verification via the provider adapter.
 *
 * Flow:
 * 1. Require the email provider in x-provider and reject non-local mock use
 * 2. Parse request body
 * 3. Verify webhook signature via adapter — return 401 if invalid
 * 4. Parse delivery status payload via adapter → NormalizedDeliveryStatus
 * 5. Look up the message by external_message_id using MessageRepository
 * 6. If message found: insert a delivery event via DeliveryEventRepository,
 *    update message delivery_status
 * 7. Return 200 OK
 *
 * Requirements: 7.6, 8.6, 16.1, 16.2, 16.3, 23.1, 23.2
 */

import { createDbClient } from '../_shared/create-db-client.ts';
import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import {
  isLocalMockWebhookAllowed,
  parseEmailWebhookBody,
  readWebhookProvider,
  requestHeadersToRecord,
  resolveEmailStatusWebhookContext,
} from '../_shared/webhook-credentials.ts';

import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { DeliveryEventRepository } from '../../../packages/support-core/src/repositories/delivery-event-repository.ts';
import type { NormalizedDeliveryStatus } from '../../../packages/support-core/src/types/index.ts';

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
    // 1. Require an explicit provider so a public callback cannot silently
    // downgrade to the signature-free mock adapter.
    const provider = readWebhookProvider(req.headers);
    if (!provider) {
      return jsonResponse({ error: 'x-provider header is required' }, 400);
    }

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
      return jsonResponse({ error: 'Mock email status webhooks are disabled outside local development' }, 403);
    }

    // 2. Read request body
    const rawBody = await req.text();

    // 3. Build provider registry and get adapter
    const registry = createProviderRegistry();

    let adapter;
    try {
      adapter = registry.getEmailAdapter(provider);
    } catch {
      return jsonResponse({ error: `Unknown email provider: ${provider}` }, 400);
    }

    // 4. Parse body in the provider's webhook shape.
    let body: unknown;
    try {
      body = parseEmailWebhookBody(rawBody);
    } catch {
      return jsonResponse({ error: 'Invalid webhook body' }, 400);
    }

    // 5. Parse delivery status payload via adapter
    let normalizedStatus: NormalizedDeliveryStatus;
    try {
      normalizedStatus = adapter.parseStatusWebhook(body);
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Invalid email status webhook payload' },
        400,
      );
    }

    // 6. Create InsForge database client
    const serviceRoleKey =
      (typeof Deno !== 'undefined'
        ? (Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY'))
        : undefined) ??
      process.env.INSFORGE_SERVICE_ROLE_KEY ??
      '';

    const db = createDbClient(baseUrl, serviceRoleKey);

    // 7. Resolve the trusted provider account and signing secret from the
    // stored outbound message before accepting the callback.
    const webhookContext = await resolveEmailStatusWebhookContext(
      db,
      provider,
      normalizedStatus.externalMessageId,
      baseUrl,
      serviceRoleKey,
    );

    if (!webhookContext) {
      return jsonResponse({ error: 'Webhook provider account not found' }, 401);
    }

    // 8. Verify webhook signature
    const isValid = await adapter.verifyWebhook({
      headers: requestHeadersToRecord(req.headers),
      body: rawBody,
      signingSecret: webhookContext.signingSecret,
    });

    if (!isValid) {
      return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
    }

    // 9. Look up the message by external_message_id
    const messageRepo = new MessageRepository(db);
    const message = await messageRepo.findByExternalId(
      provider,
      normalizedStatus.externalMessageId,
    );

    if (!message) {
      // Message not found — acknowledge the webhook but take no action
      return jsonResponse({ status: 'ok', message: 'Message not found, status ignored' });
    }

    // 10. Insert delivery event record
    const deliveryEventRepo = new DeliveryEventRepository(db);
    await deliveryEventRepo.create('email', {
      messageId: message.id,
      providerAccountId: message.providerAccountId,
      status: normalizedStatus.status,
      errorCode: normalizedStatus.errorCode ?? null,
      errorMessage: normalizedStatus.errorMessage ?? null,
      rawPayload: normalizedStatus.rawPayload,
    });

    // 11. Update message delivery_status
    await messageRepo.updateDeliveryStatus(message.id, normalizedStatus.status);

    // 12. Return 200 OK
    return jsonResponse({
      status: 'ok',
      data: {
        messageId: message.id,
        deliveryStatus: normalizedStatus.status,
      },
    });
  } catch (err) {
    console.error('email-status error:', err);
    return jsonResponse(
      { error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
}
