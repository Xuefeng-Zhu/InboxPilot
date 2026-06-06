/**
 * Provider-neutral email adapter interface.
 *
 * Each email provider (Postmark, SendGrid, mock, etc.) implements this interface.
 * Business logic interacts only with this contract, never with provider SDKs.
 */

import type {
  SendEmailParams,
  SendEmailResult,
  NormalizedInboundEmail,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
} from '../types/index.js';

export interface EmailProviderAdapter {
  readonly providerId: string;

  /** Send an email message via this provider. */
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;

  /** Parse a raw inbound webhook body into a normalized email payload. */
  parseInboundWebhook(body: unknown): NormalizedInboundEmail;

  /** Parse a raw delivery-status webhook body into a normalized status. */
  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus;

  /** Verify the authenticity of an incoming webhook request. */
  verifyWebhook(req: WebhookVerificationRequest): Promise<boolean>;
}
