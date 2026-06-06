/**
 * Provider-neutral SMS adapter interface.
 *
 * Each SMS provider (Twilio, Telnyx, mock, etc.) implements this interface.
 * Business logic interacts only with this contract, never with provider SDKs.
 */

import type {
  SendSmsParams,
  SendSmsResult,
  NormalizedInboundSms,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
} from '../types/index.js';

export interface SmsProviderAdapter {
  readonly providerId: string;

  /** Send an SMS message via this provider. */
  sendSms(params: SendSmsParams): Promise<SendSmsResult>;

  /** Parse a raw inbound webhook body into a normalized SMS payload. */
  parseInboundWebhook(body: unknown): NormalizedInboundSms;

  /** Parse a raw delivery-status webhook body into a normalized status. */
  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus;

  /** Verify the authenticity of an incoming webhook request. */
  verifyWebhook(req: WebhookVerificationRequest): Promise<boolean>;
}
