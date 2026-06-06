/**
 * Email provider stub adapters.
 *
 * Interface-compliant stubs for Mailgun, Resend, AWS SES, and InsForge Email.
 * Every method throws a "not implemented" error so the adapters can be
 * registered in the ProviderRegistry without breaking the type system,
 * while clearly signalling that real integration work is still required.
 *
 * @see Requirements 8.3
 */

import type { EmailProviderAdapter } from '../interfaces/email-provider-adapter.js';
import type {
  SendEmailParams,
  SendEmailResult,
  NormalizedInboundEmail,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
} from '../types/index.js';

// ─── Mailgun ────────────────────────────────────────────────────────

export class MailgunEmailAdapter implements EmailProviderAdapter {
  readonly providerId = 'mailgun';

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    throw new Error('MailgunEmailAdapter.sendEmail is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundEmail {
    throw new Error('MailgunEmailAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('MailgunEmailAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('MailgunEmailAdapter.verifyWebhook is not implemented');
  }
}

// ─── Resend ─────────────────────────────────────────────────────────

export class ResendEmailAdapter implements EmailProviderAdapter {
  readonly providerId = 'resend';

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    throw new Error('ResendEmailAdapter.sendEmail is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundEmail {
    throw new Error('ResendEmailAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('ResendEmailAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('ResendEmailAdapter.verifyWebhook is not implemented');
  }
}

// ─── AWS SES ────────────────────────────────────────────────────────

export class AwsSesEmailAdapter implements EmailProviderAdapter {
  readonly providerId = 'aws-ses';

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    throw new Error('AwsSesEmailAdapter.sendEmail is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundEmail {
    throw new Error('AwsSesEmailAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('AwsSesEmailAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('AwsSesEmailAdapter.verifyWebhook is not implemented');
  }
}

// ─── InsForge Email ─────────────────────────────────────────────────

export class InsForgeEmailAdapter implements EmailProviderAdapter {
  readonly providerId = 'insforge';

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    throw new Error('InsForgeEmailAdapter.sendEmail is not implemented');
  }

  parseInboundWebhook(_body: unknown): NormalizedInboundEmail {
    throw new Error('InsForgeEmailAdapter.parseInboundWebhook is not implemented');
  }

  parseStatusWebhook(_body: unknown): NormalizedDeliveryStatus {
    throw new Error('InsForgeEmailAdapter.parseStatusWebhook is not implemented');
  }

  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    throw new Error('InsForgeEmailAdapter.verifyWebhook is not implemented');
  }
}
