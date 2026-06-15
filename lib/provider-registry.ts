/**
 * createProviderRegistry (Node)
 *
 * Constructs a fully-populated `ProviderRegistry` for the Next.js runtime.
 * Every function entrypoint that needs SMS or email (send-reply, etc.) calls
 * this factory once per request to get a fresh registry — no module-level
 * caching, no shared state, no credentials loaded here (Tasks 6/7/8 handle
 * the per-call `providerConfig`).
 *
 * Per project convention, all 13 provider IDs are registered:
 *   - 5 real: mock / twilio / telnyx (SMS) + mock / postmark (email)
 *   - 8 stubs: bandwidth / vonage / plivo / messagebird (SMS)
 *              mailgun / resend / aws-ses / insforge (email)
 *
 * The stubs intentionally throw "not implemented" so the type system stays
 * satisfied — they will be replaced with real implementations as they are
 * built. See `packages/support-core/src/adapters/{sms,email}-stubs.ts`.
 */

import { ProviderRegistry } from '@support-core/interfaces/provider-registry';
import {
  MockSmsAdapter,
  TwilioSmsAdapter,
  TelnyxSmsAdapter,
  BandwidthSmsAdapter,
  VonageSmsAdapter,
  PlivoSmsAdapter,
  MessageBirdSmsAdapter,
  MockEmailAdapter,
  PostmarkEmailAdapter,
  MailgunEmailAdapter,
  ResendEmailAdapter,
  AwsSesEmailAdapter,
  InsForgeEmailAdapter,
} from '@support-core/adapters';

export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  // --- SMS adapters (7) ---
  registry.registerSmsAdapter('mock', new MockSmsAdapter());
  registry.registerSmsAdapter('twilio', new TwilioSmsAdapter());
  registry.registerSmsAdapter('telnyx', new TelnyxSmsAdapter());
  registry.registerSmsAdapter('bandwidth', new BandwidthSmsAdapter());
  registry.registerSmsAdapter('vonage', new VonageSmsAdapter());
  registry.registerSmsAdapter('plivo', new PlivoSmsAdapter());
  registry.registerSmsAdapter('messagebird', new MessageBirdSmsAdapter());

  // --- Email adapters (6) ---
  registry.registerEmailAdapter('mock', new MockEmailAdapter());
  registry.registerEmailAdapter('postmark', new PostmarkEmailAdapter());
  registry.registerEmailAdapter('mailgun', new MailgunEmailAdapter());
  registry.registerEmailAdapter('resend', new ResendEmailAdapter());
  registry.registerEmailAdapter('aws-ses', new AwsSesEmailAdapter());
  registry.registerEmailAdapter('insforge', new InsForgeEmailAdapter());

  return registry;
}
