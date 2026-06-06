/**
 * SMS provider stub adapters.
 *
 * Interface-compliant stubs for Bandwidth, Vonage, Plivo, and MessageBird.
 * Every method throws a "not implemented" error so the adapters can be
 * registered in the ProviderRegistry without breaking the type system,
 * while clearly signalling that real integration work is still required.
 *
 * @see Requirements 7.3
 */

import type { SmsProviderAdapter } from '../interfaces/sms-provider-adapter.js';
import type {
  SendSmsParams,
  SendSmsResult,
  NormalizedInboundSms,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
} from '../types/index.js';

// ─── Bandwidth ──────────────────────────────────────────────────────

export class BandwidthSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'bandwidth';

  async sendSms(_params: SendSmsParams): Promise<SendSmsResult> {
    throw new Error('BandwidthSmsAdapter.sendSms is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundSms {
    throw new Error('BandwidthSmsAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('BandwidthSmsAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('BandwidthSmsAdapter.verifyWebhook is not implemented');
  }
}

// ─── Vonage ─────────────────────────────────────────────────────────

export class VonageSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'vonage';

  async sendSms(_params: SendSmsParams): Promise<SendSmsResult> {
    throw new Error('VonageSmsAdapter.sendSms is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundSms {
    throw new Error('VonageSmsAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('VonageSmsAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('VonageSmsAdapter.verifyWebhook is not implemented');
  }
}

// ─── Plivo ──────────────────────────────────────────────────────────

export class PlivoSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'plivo';

  async sendSms(_params: SendSmsParams): Promise<SendSmsResult> {
    throw new Error('PlivoSmsAdapter.sendSms is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundSms {
    throw new Error('PlivoSmsAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('PlivoSmsAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('PlivoSmsAdapter.verifyWebhook is not implemented');
  }
}

// ─── MessageBird ────────────────────────────────────────────────────

export class MessageBirdSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'messagebird';

  async sendSms(_params: SendSmsParams): Promise<SendSmsResult> {
    throw new Error('MessageBirdSmsAdapter.sendSms is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundSms {
    throw new Error('MessageBirdSmsAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('MessageBirdSmsAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('MessageBirdSmsAdapter.verifyWebhook is not implemented');
  }
}
