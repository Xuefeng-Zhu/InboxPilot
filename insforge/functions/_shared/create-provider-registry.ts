/**
 * createProviderRegistry (Deno)
 *
 * Constructs a fully-populated `ProviderRegistry` for the Deno serverless
 * function runtime. Each function entrypoint (sms-inbound, sms-status,
 * email-inbound, email-status, etc.) calls this factory once per request
 * to get a fresh registry — no module-level caching, no shared state, no
 * credentials loaded here (per-call secrets are loaded by
 * `_shared/insforge-secrets.ts`).
 *
 * Per project convention, the 12 Deno-safe provider IDs are registered:
 *   - 4 real:   mock (SMS) / mock (email) / telnyx (SMS) / postmark (email)
 *   - 8 stubs:  bandwidth / vonage / plivo / messagebird (SMS)
 *               mailgun / resend / aws-ses / insforge (email)
 *
 * Why not 13? TwilioSmsAdapter is intentionally NOT registered in the Deno
 * registry because its HMAC-SHA1 verification and Basic auth still depend on
 * Node-only `crypto` and `Buffer` APIs. Postmark is WebCrypto-based and safe
 * in both Node and Deno runtimes.
 *
 * Porting path for Twilio: rewrite its HMAC, Base64, and byte comparisons
 * against WebCrypto/Uint8Array, then register it here. The full checklist
 * lives in `insforge/functions/AGENTS.md`.
 *
 * The stubs intentionally throw "not implemented" so the type system stays
 * satisfied — they will be replaced with real implementations as they are
 * built. See `packages/support-core/src/adapters/{sms,email}-stubs.ts`.
 *
 * Deno convention: relative paths with explicit `.ts` extensions (no
 * `deno.json` import map, no path aliases). Mirrors the surrounding
 * `_shared/create-db-client.ts` / `_shared/verify-jwt.ts` pattern.
 */

import { ProviderRegistry } from '../../../packages/support-core/src/interfaces/provider-registry.ts';
import { MockSmsAdapter } from '../../../packages/support-core/src/adapters/mock-sms-adapter.ts';
import { TelnyxSmsAdapter } from '../../../packages/support-core/src/adapters/telnyx-sms-adapter.ts';
import {
  BandwidthSmsAdapter,
  VonageSmsAdapter,
  PlivoSmsAdapter,
  MessageBirdSmsAdapter,
} from '../../../packages/support-core/src/adapters/sms-stubs.ts';
import { MockEmailAdapter } from '../../../packages/support-core/src/adapters/mock-email-adapter.ts';
import { PostmarkEmailAdapter } from '../../../packages/support-core/src/adapters/postmark-email-adapter.ts';
import {
  MailgunEmailAdapter,
  ResendEmailAdapter,
  AwsSesEmailAdapter,
  InsForgeEmailAdapter,
} from '../../../packages/support-core/src/adapters/email-stubs.ts';

export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  // --- SMS adapters (6) ---
  registry.registerSmsAdapter('mock', new MockSmsAdapter());
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
