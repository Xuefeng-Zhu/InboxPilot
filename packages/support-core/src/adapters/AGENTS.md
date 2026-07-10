# packages/support-core/src/adapters/ — SMS / Email Provider Adapters

## OVERVIEW
Provider integrations. **All adapters are stateless** — no constructor params, credentials come from `params.providerConfig` per call. Register in `ProviderRegistry` at function entrypoints.

## ADAPTERS
### SMS — Real
- `MockSmsAdapter` — `providerId: 'mock'`, in-memory, deterministic `mock_sms_N` IDs, `sentMessages` getter, `clear()`.
- `TwilioSmsAdapter` — `providerId: 'twilio'`, HMAC-SHA1 webhook verification (timing-safe compare), Twilio REST `/Messages.json`.
- `TelnyxSmsAdapter` — `providerId: 'telnyx'`, Bearer-token auth, ed25519 webhook verification using the configured public key in `signingSecret` plus a 5-minute timestamp replay window.

### SMS — Stubs (throw "not implemented")
- `BandwidthSmsAdapter` (`'bandwidth'`)
- `VonageSmsAdapter` (`'vonage'`)
- `PlivoSmsAdapter` (`'plivo'`)
- `MessageBirdSmsAdapter` (`'messagebird'`)

### Email — Real
- `MockEmailAdapter` — `providerId: 'mock'`, in-memory, deterministic `mock_email_N` IDs, `sentEmails` getter, `clear()`.
- `PostmarkEmailAdapter` — `providerId: 'postmark'`, `X-Postmark-Server-Token` verification (timing-safe compare), Postmark REST `/email`.

### Email — Stubs (throw "not implemented")
- `MailgunEmailAdapter` (`'mailgun'`)
- `ResendEmailAdapter` (`'resend'`)
- `AwsSesEmailAdapter` (`'aws-ses'`)
- `InsForgeEmailAdapter` (`'insforge'`) — **note**: this is just a stub label. The package is provider-neutral; even this adapter does NOT import `@insforge/*`.

## WHERE TO LOOK
- **Add a new provider** → implement `SmsProviderAdapter` or `EmailProviderAdapter` (from `interfaces/`), drop the class file here, export from `index.ts`, register in the `ProviderRegistry` at each function entrypoint that needs it. The 8 existing stubs show the exact shape a skeleton needs.
- **Verify a webhook signature** → use `crypto.timingSafeEqual` for HMAC; never plain `===`.
- **Send via HTTP** → use native `fetch` (Node 18+ / Deno both have it). No axios, no SDK.
- **Test an adapter** → `__tests__/unit/twilio-sms-adapter.test.ts` is the canonical template (direct instantiation + constructed inputs, no HTTP-level mocking).

## CONVENTIONS
- **`providerId` is a string literal** typed as the union in the interface.
- **No state.** Counters, queues, retries live in services, not adapters.
- **Per-call `providerConfig`** carries the credentials (`accountSid`/`authToken` for Twilio, `serverToken` for Postmark, etc.).
- **Stubs throw `Error('not implemented')` on every method.** Type system stays satisfied; replace when building.
- **Verify with `crypto.timingSafeEqual`** for HMAC comparisons; constant-time check, not `===`.

## ANTI-PATTERNS
- Hardcoding credentials in the adapter file (always via `params.providerConfig`).
- Caching connection pools (adapters are stateless — Deno/Node fetch reuses keep-alive).
- Using external SDKs (no `@twilio/sdk`, no `nodemailer`).
- Implementing anything beyond the `SmsProviderAdapter` / `EmailProviderAdapter` interface contract.

## UNIQUE
- `MockSmsAdapter` and `MockEmailAdapter` are used both in dev (driven by `scripts/mock-sms.mjs`) AND in tests as real test doubles (not mocked).
- The 8 stubs are a deliberate "registry completeness" trick: the `ProviderRegistry` lists 13 providers total (5 real + 8 stubs), so the type system enforces "all known providers have an entry" without forcing the impl.
- `Telnyx` ed25519 verification depends on `signingSecret` carrying the Telnyx public key (hex/base64/base64url), not an HMAC secret.
