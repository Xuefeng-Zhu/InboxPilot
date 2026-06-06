/**
 * Registry for SMS and email provider adapters.
 *
 * Populated at function startup. Each Function Entrypoint creates a registry,
 * registers the adapters it needs, and passes it to the service layer.
 */

import type { SmsProviderAdapter } from './sms-provider-adapter.js';
import type { EmailProviderAdapter } from './email-provider-adapter.js';

export class ProviderRegistry {
  private smsAdapters = new Map<string, SmsProviderAdapter>();
  private emailAdapters = new Map<string, EmailProviderAdapter>();

  /** Register an SMS adapter under the given provider ID. */
  registerSmsAdapter(providerId: string, adapter: SmsProviderAdapter): void {
    this.smsAdapters.set(providerId, adapter);
  }

  /** Register an email adapter under the given provider ID. */
  registerEmailAdapter(providerId: string, adapter: EmailProviderAdapter): void {
    this.emailAdapters.set(providerId, adapter);
  }

  /** Retrieve a registered SMS adapter by provider ID. Throws if not found. */
  getSmsAdapter(providerId: string): SmsProviderAdapter {
    const adapter = this.smsAdapters.get(providerId);
    if (!adapter) {
      throw new Error(`SMS adapter not registered for provider: ${providerId}`);
    }
    return adapter;
  }

  /** Retrieve a registered email adapter by provider ID. Throws if not found. */
  getEmailAdapter(providerId: string): EmailProviderAdapter {
    const adapter = this.emailAdapters.get(providerId);
    if (!adapter) {
      throw new Error(`Email adapter not registered for provider: ${providerId}`);
    }
    return adapter;
  }
}
