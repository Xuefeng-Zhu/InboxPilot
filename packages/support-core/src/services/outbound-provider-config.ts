import type { SmsProviderAccountRepository } from '../repositories/sms-provider-account-repository.js';
import type { EmailProviderAccountRepository } from '../repositories/email-provider-account-repository.js';
import type { Channel } from '../types/index.js';

export interface OutboundProviderConfigDependencies {
  smsAccountRepo: SmsProviderAccountRepository;
  emailAccountRepo: EmailProviderAccountRepository;
  loadSecret: (secretId: string) => Promise<Record<string, unknown> | null>;
}

/**
 * Resolve credentials for the active account behind an organization's default
 * outbound address. Repository and secret implementations are injected so the
 * same rules are used by Next.js routes and Deno workers without coupling the
 * portable support-core package to either runtime.
 */
export async function resolveOutboundProviderConfig(
  organizationId: string,
  channel: Channel,
  dependencies: OutboundProviderConfigDependencies,
): Promise<Record<string, unknown>> {
  if (channel === 'sms') {
    const defaultPhone = await dependencies.smsAccountRepo
      .findDefaultPhoneNumber(organizationId);
    if (!defaultPhone) return {};

    const account = await dependencies.smsAccountRepo
      .findById(defaultPhone.providerAccountId);
    if (!account) return {};
    if (!account.isActive) {
      throw new Error(`SMS provider account is inactive: ${account.id}`);
    }
    if (account.provider === 'mock') return {};

    const secret = await dependencies.loadSecret(account.credentialsSecretId);
    if (!secret) {
      throw new Error(`SMS provider credentials not found: ${account.credentialsSecretId}`);
    }
    return secret;
  }

  if (channel === 'email') {
    const defaultEmail = await dependencies.emailAccountRepo
      .findDefaultEmailAddress(organizationId);
    if (!defaultEmail) return {};

    const account = await dependencies.emailAccountRepo
      .findById(defaultEmail.providerAccountId);
    if (!account) return {};
    if (!account.isActive) {
      throw new Error(`Email provider account is inactive: ${account.id}`);
    }
    if (account.provider === 'mock') return {};

    const secret = await dependencies.loadSecret(account.credentialsSecretId);
    if (!secret) {
      throw new Error(`Email provider credentials not found: ${account.credentialsSecretId}`);
    }
    return secret;
  }

  return {};
}
