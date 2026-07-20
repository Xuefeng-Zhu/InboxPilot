/**
 * Postmark email provider adapter.
 *
 * Implements the full EmailProviderAdapter interface for Postmark without
 * depending on the Postmark SDK. Uses native `fetch` for HTTP calls.
 *
 * Webhook verification: Postmark doesn't use HMAC signatures by default.
 * We verify by checking for a `x-postmark-server-token` header matching
 * the configured token. Source-IP allowlisting belongs at the route/proxy
 * boundary because this portable adapter receives only headers/body/token.
 */

import type { EmailProviderAdapter } from '../interfaces/email-provider-adapter.js';
import {
  PROVIDER_SEND_TIMEOUT_MS,
  ProviderSendOutcomeUnknownError,
} from './provider-send-outcome-unknown-error';
import type {
  SendEmailParams,
  SendEmailResult,
  NormalizedInboundEmail,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
  DeliveryStatus,
} from '../types/index.js';

/**
 * Map Postmark RecordType values to our normalized DeliveryStatus.
 *
 * Postmark RecordTypes: Delivery, Bounce, SpamComplaint, Open, Click, etc.
 * Our statuses:         queued, sent, delivered, failed, bounced, pending
 */
function mapPostmarkRecordType(recordType: string): DeliveryStatus {
  switch (recordType.toLowerCase()) {
    case 'delivery':
      return 'delivered';
    case 'bounce':
    case 'hardbounce':
    case 'softbounce':
      return 'bounced';
    case 'spamcomplaint':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Compare secrets without Node-only crypto or an early-exit byte loop. */
async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    globalThis.crypto.subtle.digest('SHA-256', encoder.encode(left)),
    globalThis.crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

export class PostmarkEmailAdapter implements EmailProviderAdapter {
  readonly providerId = 'postmark';

  /**
   * Send an email via the Postmark REST API.
   *
   * providerConfig must contain:
   * - serverToken: Postmark Server API Token
   */
  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { serverToken } = params.providerConfig as {
      serverToken: string;
    };

    if (!serverToken) {
      throw new Error('PostmarkEmailAdapter.sendEmail: providerConfig must contain serverToken');
    }

    const url = 'https://api.postmarkapp.com/email';

    const body: Record<string, string> = {
      From: params.from,
      To: params.to,
      Subject: params.subject,
      TextBody: params.bodyText,
    };

    if (params.bodyHtml) {
      body.HtmlBody = params.bodyHtml;
    }

    if (params.replyToMessageId) {
      body.Headers = JSON.stringify([
        { Name: 'In-Reply-To', Value: params.replyToMessageId },
      ]);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': serverToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_SEND_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderSendOutcomeUnknownError({
        providerId: this.providerId,
        stage: 'request',
        message: 'PostmarkEmailAdapter.sendEmail: request failed without a provider response',
        originalError: error,
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `PostmarkEmailAdapter.sendEmail: Postmark API returned ${response.status}: ${errorBody}`,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new ProviderSendOutcomeUnknownError({
        providerId: this.providerId,
        stage: 'response',
        message: 'PostmarkEmailAdapter.sendEmail: accepted response was not valid JSON',
        originalError: error,
      });
    }

    const responseData = data && typeof data === 'object'
      ? data as Record<string, unknown>
      : {};
    if (
      typeof responseData.MessageID !== 'string' ||
      responseData.MessageID.trim().length === 0
    ) {
      throw new ProviderSendOutcomeUnknownError({
        providerId: this.providerId,
        stage: 'response',
        message: 'PostmarkEmailAdapter.sendEmail: accepted response did not include a message ID',
        originalError: new Error('missing MessageID'),
      });
    }

    return {
      externalMessageId: responseData.MessageID,
      provider: this.providerId,
      status: 'queued',
    };
  }

  /**
   * Parse a Postmark inbound email webhook payload into a NormalizedInboundEmail.
   *
   * Postmark sends JSON inbound webhooks with fields:
   * From, To, Subject, TextBody, HtmlBody, MessageID, Headers (array), etc.
   *
   * The `body` parameter should be a pre-parsed JSON object.
   */
  parseInboundWebhook(body: unknown): NormalizedInboundEmail {
    const payload = this.toRecord(body);

    const from = payload.From ?? payload.from;
    const to = payload.To ?? payload.to;
    const subject = payload.Subject ?? payload.subject;
    const bodyText = payload.TextBody ?? payload.textBody;
    const bodyHtml = payload.HtmlBody ?? payload.htmlBody;
    const messageId = payload.MessageID ?? payload.messageId;

    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      typeof subject !== 'string' ||
      typeof bodyText !== 'string' ||
      typeof messageId !== 'string'
    ) {
      throw new Error(
        'PostmarkEmailAdapter.parseInboundWebhook: body must contain From, To, Subject, TextBody, and MessageID as strings',
      );
    }

    // Extract In-Reply-To from Headers array or direct field
    let inReplyTo: string | undefined;
    const rawInReplyTo = payload.InReplyTo ?? payload.inReplyTo;
    if (typeof rawInReplyTo === 'string' && rawInReplyTo !== '') {
      inReplyTo = rawInReplyTo;
    } else if (Array.isArray(payload.Headers)) {
      const header = (payload.Headers as Array<{ Name: string; Value: string }>).find(
        (h) => h.Name === 'In-Reply-To',
      );
      if (header && typeof header.Value === 'string') {
        inReplyTo = header.Value;
      }
    }

    return {
      from,
      to,
      subject,
      bodyText,
      ...(typeof bodyHtml === 'string' && bodyHtml !== '' && { bodyHtml }),
      externalMessageId: messageId,
      ...(inReplyTo !== undefined && { inReplyTo }),
      rawPayload: payload as Record<string, unknown>,
    };
  }

  /**
   * Parse a Postmark delivery/bounce status webhook payload into a NormalizedDeliveryStatus.
   *
   * Postmark sends delivery webhooks with:
   * { MessageID, RecordType, DeliveredAt, ... }
   *
   * Bounce webhooks with:
   * { MessageID, RecordType, Type, TypeCode, Description, BouncedAt, ... }
   */
  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus {
    const payload = this.toRecord(body);

    const messageId = payload.MessageID ?? payload.messageId;
    const recordType = payload.RecordType ?? payload.recordType;

    if (typeof messageId !== 'string' || typeof recordType !== 'string') {
      throw new Error(
        'PostmarkEmailAdapter.parseStatusWebhook: body must contain MessageID and RecordType as strings',
      );
    }

    const status = mapPostmarkRecordType(recordType);

    // Extract error info from bounce payloads
    const typeCode = payload.TypeCode ?? payload.typeCode;
    const description = payload.Description ?? payload.description;

    return {
      externalMessageId: messageId,
      status,
      ...(typeCode !== undefined && typeCode !== null && String(typeCode) !== '' && {
        errorCode: String(typeCode),
      }),
      ...(typeof description === 'string' && description !== '' && {
        errorMessage: description,
      }),
      rawPayload: payload as Record<string, unknown>,
    };
  }

  /**
   * Verify the authenticity of a Postmark webhook request.
   *
   * Postmark doesn't use HMAC signatures by default. We verify by checking
   * for a `x-postmark-server-token` header matching the configured token.
   * Source-IP allowlisting, if enabled, should run before this adapter at the
   * HTTP route/proxy boundary where the trusted client IP is available.
   */
  async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
    const token =
      req.headers['x-postmark-server-token'] ??
      req.headers['X-Postmark-Server-Token'];

    if (!token) {
      return false;
    }

    const expectedToken = req.signingSecret;
    if (!expectedToken) {
      return false;
    }

    // Hash both inputs to fixed-length byte arrays, then compare every byte.
    // Web Crypto and TextEncoder are available in both Node and Deno.
    try {
      return await timingSafeStringEqual(token, expectedToken);
    } catch {
      return false;
    }
  }

  /**
   * Convert the incoming body to a record.
   * Expects a pre-parsed JSON object.
   */
  private toRecord(body: unknown): Record<string, unknown> {
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    throw new Error('PostmarkEmailAdapter: body must be a JSON object');
  }
}
