/**
 * Outbound send boundary types.
 *
 * `ProviderConfig` is the opaque, provider-specific bag of credentials +
 * options passed through to an adapter's `send()` call. Repositories never
 * see it; only adapters do, via constructor injection or call-site options.
 *
 * `Send*Params` and `Send*Result` are the inputs/outputs of the adapter's
 * `SmsProviderAdapter.send()` and `EmailProviderAdapter.send()` methods.
 */

export interface ProviderConfig {
  [key: string]: unknown;
}

export interface SendSmsParams {
  to: string;
  from: string;
  body: string;
  providerConfig: ProviderConfig;
}

export interface SendSmsResult {
  externalMessageId: string;
  provider: string;
  status: 'queued' | 'sent';
}

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyToMessageId?: string;
  providerConfig: ProviderConfig;
}

export interface SendEmailResult {
  externalMessageId: string;
  provider: string;
  status: 'queued' | 'sent';
}
