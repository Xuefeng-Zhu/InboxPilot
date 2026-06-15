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
 * Per project convention, the 11 Deno-safe provider IDs are registered:
 *   - 3 real:   mock (SMS) / mock (email) / telnyx (SMS)
 *   - 8 stubs:  bandwidth / vonage / plivo / messagebird (SMS)
 *               mailgun / resend / aws-ses / insforge (email)
 *
 * Why not 13? TwilioSmsAdapter and PostmarkEmailAdapter are intentionally
 * NOT registered in the Deno registry. Both adapters currently rely on
 * Node-only built-ins (`crypto` for HMAC-SHA1 signature verification on
 * Twilio webhooks, `crypto.createHmac` + `Buffer` for Postmark) which the
 * Deno runtime that hosts these entrypoints does not provide. Pulling them
 * in would crash at deploy / first request, so the safe P1 fix is to drop
 * the imports + `register*Adapter` calls here and document the upgrade
 * path. The two adapters remain fully wired in the Node side at
 * `lib/provider-registry.ts`, so all Next.js Route Handlers under
 * `app/api/functions/*` and any future server-rendered flows continue to
 * use them.
 *
 * Porting path: rewrite the two adapters against WebCrypto
 * (`crypto.subtle.sign` for Twilio's per-request HMAC, `crypto.subtle.digest`
 * for Postmark's payload hash) and replace `Buffer` with `Uint8Array` /
 * `TextEncoder`. Once a port lands, restore the import + `register*Adapter`
 * call here and the entrypoints are immediately re-wired. The full
 * porting checklist lives in `insforge/functions/AGENTS.md` (the
 * "Deno-safety" section documents the rule and the upgrade path; see also
 * the per-adapter notes that future contributors will leave behind in the
 * adapter sources themselves).
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

  // --- Email adapters (5) ---
  registry.registerEmailAdapter('mock', new MockEmailAdapter());
  registry.registerEmailAdapter('mailgun', new MailgunEmailAdapter());
  registry.registerEmailAdapter('resend', new ResendEmailAdapter());
  registry.registerEmailAdapter('aws-ses', new AwsSesEmailAdapter());
  registry.registerEmailAdapter('insforge', new InsForgeEmailAdapter());

  return registry;
}
