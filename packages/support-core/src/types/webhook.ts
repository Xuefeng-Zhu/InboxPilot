/**
 * Inbound webhook boundary types.
 *
 * Provider adapters (Twilio, Telnyx, Postmark) parse raw HTTP payloads into
 * these normalized shapes before handing them to the `InboundMessageService`.
 * Keeping the normalization at the adapter boundary means services and
 * repositories never see provider-specific field names.
 */

import type { DeliveryStatus } from './enums';

// ─── Inbound messages ────────────────────────────────────────────────

export interface NormalizedInboundSms {
  from: string;
  to: string;
  body: string;
  externalMessageId: string;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedInboundEmail {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  externalMessageId: string;
  inReplyTo?: string;
  rawPayload: Record<string, unknown>;
}

// ─── Delivery status callbacks ───────────────────────────────────────

export interface NormalizedDeliveryStatus {
  externalMessageId: string;
  status: DeliveryStatus;
  errorCode?: string;
  errorMessage?: string;
  rawPayload: Record<string, unknown>;
}

// ─── Webhook signature verification ──────────────────────────────────

export interface WebhookVerificationRequest {
  headers: Record<string, string>;
  body: string | Buffer;
  signingSecret: string;
}
