/**
 * Telnyx SMS provider adapter.
 *
 * Implements the full SmsProviderAdapter interface for Telnyx without
 * depending on the Telnyx SDK. Uses native `fetch` for HTTP calls.
 *
 * Telnyx uses ed25519 signature verification for webhooks. For simplicity,
 * this implementation performs a basic check that the signature header exists
 * and is non-empty. A full ed25519 verification would require the Telnyx
 * public key.
 */

import type { SmsProviderAdapter } from '../interfaces/sms-provider-adapter.js';
import type {
  SendSmsParams,
  SendSmsResult,
  NormalizedInboundSms,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
  DeliveryStatus,
} from '../types/index.js';

/**
 * Map Telnyx status values to our normalized DeliveryStatus.
 *
 * Telnyx statuses: queued, sending, sent, delivered, sending_failed, delivery_failed, delivery_unconfirmed
 * Our statuses:    queued, sent, delivered, failed, bounced, pending
 */
function mapTelnyxStatus(telnyxStatus: string): DeliveryStatus {
  switch (telnyxStatus.toLowerCase()) {
    case 'queued':
    case 'sending':
      return 'queued';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'sending_failed':
      return 'failed';
    case 'delivery_failed':
      return 'bounced';
    case 'delivery_unconfirmed':
      return 'pending';
    default:
      return 'pending';
  }
}

/**
 * Extract a nested value from a Telnyx webhook payload.
 *
 * Telnyx webhooks use the structure:
 * { data: { event_type: "...", payload: { ... } } }
 */
function extractPayload(body: unknown): { eventType: string; payload: Record<string, unknown> } {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new Error('TelnyxSmsAdapter: body is not valid JSON');
    }
  }

  if (typeof body !== 'object' || body === null) {
    throw new Error('TelnyxSmsAdapter: body must be a JSON object');
  }

  const root = body as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;

  if (!data || typeof data !== 'object') {
    throw new Error('TelnyxSmsAdapter: body must contain a "data" object');
  }

  const eventType = data.event_type;
  if (typeof eventType !== 'string') {
    throw new Error('TelnyxSmsAdapter: data must contain "event_type" as a string');
  }

  const payload = data.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') {
    throw new Error('TelnyxSmsAdapter: data must contain a "payload" object');
  }

  return { eventType, payload };
}

export class TelnyxSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'telnyx';

  /**
   * Send an SMS via the Telnyx REST API.
   *
   * providerConfig must contain:
   * - apiKey: Telnyx API key (v2 Bearer token)
   */
  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const { apiKey } = params.providerConfig as { apiKey: string };

    if (!apiKey) {
      throw new Error('TelnyxSmsAdapter.sendSms: providerConfig must contain apiKey');
    }

    const url = 'https://api.telnyx.com/v2/messages';

    const requestBody = JSON.stringify({
      to: params.to,
      from: params.from,
      text: params.body,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `TelnyxSmsAdapter.sendSms: Telnyx API returned ${response.status}: ${errorBody}`,
      );
    }

    const responseData = (await response.json()) as {
      data: { id: string; type: string };
    };

    return {
      externalMessageId: responseData.data.id,
      provider: this.providerId,
      status: 'queued',
    };
  }

  /**
   * Parse a Telnyx inbound SMS webhook payload into a NormalizedInboundSms.
   *
   * Telnyx sends JSON webhooks with structure:
   * {
   *   data: {
   *     event_type: "message.received",
   *     payload: {
   *       from: { phone_number: "+1..." },
   *       to: [{ phone_number: "+1..." }],
   *       text: "message body",
   *       id: "msg_id"
   *     }
   *   }
   * }
   */
  parseInboundWebhook(body: unknown): NormalizedInboundSms {
    const { payload } = extractPayload(body);

    const fromObj = payload.from as { phone_number?: string } | undefined;
    const toArr = payload.to as Array<{ phone_number?: string }> | undefined;
    const text = payload.text;
    const id = payload.id;

    if (!fromObj || typeof fromObj.phone_number !== 'string') {
      throw new Error(
        'TelnyxSmsAdapter.parseInboundWebhook: payload must contain from.phone_number as a string',
      );
    }

    if (!Array.isArray(toArr) || toArr.length === 0 || typeof toArr[0].phone_number !== 'string') {
      throw new Error(
        'TelnyxSmsAdapter.parseInboundWebhook: payload must contain to[0].phone_number as a string',
      );
    }

    if (typeof text !== 'string') {
      throw new Error(
        'TelnyxSmsAdapter.parseInboundWebhook: payload must contain "text" as a string',
      );
    }

    if (typeof id !== 'string') {
      throw new Error(
        'TelnyxSmsAdapter.parseInboundWebhook: payload must contain "id" as a string',
      );
    }

    return {
      from: fromObj.phone_number,
      to: toArr[0].phone_number,
      body: text,
      externalMessageId: id,
      rawPayload: payload,
    };
  }

  /**
   * Parse a Telnyx delivery status webhook payload into a NormalizedDeliveryStatus.
   *
   * Telnyx sends status webhooks with:
   * {
   *   data: {
   *     event_type: "message.finalized",
   *     payload: {
   *       id: "msg_id",
   *       to: [{ status: "delivered" }],
   *       errors: [{ title: "...", code: "..." }]
   *     }
   *   }
   * }
   */
  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus {
    const { payload } = extractPayload(body);

    const id = payload.id;
    if (typeof id !== 'string') {
      throw new Error(
        'TelnyxSmsAdapter.parseStatusWebhook: payload must contain "id" as a string',
      );
    }

    const toArr = payload.to as Array<{ status?: string }> | undefined;
    if (!Array.isArray(toArr) || toArr.length === 0 || typeof toArr[0].status !== 'string') {
      throw new Error(
        'TelnyxSmsAdapter.parseStatusWebhook: payload must contain to[0].status as a string',
      );
    }

    const status = mapTelnyxStatus(toArr[0].status);

    // Extract error information if present
    const errors = payload.errors as Array<{ title?: string; code?: string }> | undefined;
    const firstError = Array.isArray(errors) && errors.length > 0 ? errors[0] : undefined;

    return {
      externalMessageId: id,
      status,
      ...(firstError?.code && { errorCode: firstError.code }),
      ...(firstError?.title && { errorMessage: firstError.title }),
      rawPayload: payload,
    };
  }

  /**
   * Verify the authenticity of a Telnyx webhook request.
   *
   * Telnyx uses ed25519 signature verification. The signature is in the
   * `telnyx-signature-ed25519` header and the timestamp in `telnyx-timestamp`.
   *
   * TODO: Implement full ed25519 signature verification using the Telnyx
   * public key. This requires fetching the public key from Telnyx's API
   * or configuring it in the provider settings. For now, we perform a
   * basic check that the required headers exist and are non-empty.
   */
  async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
    const signature =
      req.headers['telnyx-signature-ed25519'] || req.headers['Telnyx-Signature-Ed25519'];
    const timestamp =
      req.headers['telnyx-timestamp'] || req.headers['Telnyx-Timestamp'];

    if (!signature || !timestamp) {
      return false;
    }

    // Basic validation: ensure the signature and timestamp are non-empty strings
    if (typeof signature !== 'string' || signature.trim() === '') {
      return false;
    }

    if (typeof timestamp !== 'string' || timestamp.trim() === '') {
      return false;
    }

    // TODO: Full ed25519 verification would:
    // 1. Concatenate timestamp + body
    // 2. Verify the ed25519 signature against the Telnyx public key
    // 3. Check that the timestamp is within an acceptable window
    // For now, the presence of valid headers is sufficient.

    return true;
  }
}
