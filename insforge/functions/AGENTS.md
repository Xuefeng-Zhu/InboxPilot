---
description: InsForge Deno function entrypoints – webhooks, widget API, job processor
globs: insforge/functions/**
alwaysApply: true
---

# insforge/functions – Deno Serverless Entrypoints

## OVERVIEW
9 Deno function entrypoints serving as the composition root for InboxPilot. Thin handlers: parse request → verify JWT → wire support-core deps → call service → respond. Runs on InsForge's Deno runtime, NOT Next.js. No business logic here.

## STRUCTURE
```
_shared/                     – Reusable Deno utilities
  create-db-client.ts         – DatabaseClient from Deno.env
  create-realtime-publisher.ts – RealtimePublisher from env
  webhook-handler-pipelines.ts – Shared SMS/email inbound + status request flow
  webhook-runtime.ts           – Shared webhook env and JSON responses
  run-claimed-job.ts           – Retry-safe claimed-job finalization
  openrouter-ai-client.ts      – Bounded OpenRouter client for the worker
  verify-jwt.ts               – Agent/organization JWT via Web Crypto
  verify-visitor-jwt.ts       – Anonymous webchat visitor JWT (lighter)
  cors.ts                     – CORS headers helper
sms-inbound/                 – Twilio/Telnyx → InboundMessageService
sms-status/                  – Delivery status callback
email-inbound/               – Postmark → InboundMessageService
email-status/                – Delivery status callback
process-jobs/                – Cron → PostgresJobQueue.processJobs()
webchat-identify/            – Widget JS → identify/return session token
webchat-thread-init/         – Widget JS → create thread/return threadId
webchat-session-info/        – Widget JS → load config + history
webchat-inbound/             – Widget JS → InboundMessageService
_bundled/                    – Build artifacts (do not edit)
```

## FUNCTIONS

| Function | Auth | Trigger | Delegates To |
|----------|------|---------|-------------|
| `sms-inbound` | Provider signature | HTTP POST (Telnyx today; Twilio after WebCrypto port); explicit `x-provider`, trusted receiving route, local-only mock | InboundMessageService |
| `sms-status` | Provider signature | HTTP POST (provider callback); explicit `x-provider`, trusted outbound account, local-only mock | Raw delivery event + monotonic message status |
| `email-inbound` | Provider signature | HTTP POST (Postmark); explicit `x-provider`, trusted receiving route, local-only mock | InboundMessageService |
| `email-status` | Provider signature | HTTP POST (Postmark); explicit `x-provider`, trusted outbound account, local-only mock | Raw delivery event + monotonic message status |
| `process-jobs` | Internal | HTTP POST (cron/manual trigger) | PostgresJobQueue + registered handlers |
| `webchat-identify` | Visitor JWT | HTTP POST (widget) | WebchatThreadService |
| `webchat-thread-init` | Visitor JWT | HTTP POST (widget) | WebchatThreadService |
| `webchat-session-info` | Visitor JWT | HTTP GET (widget) | WebchatThreadService |
| `webchat-inbound` | Visitor JWT | HTTP POST (widget) | InboundMessageService |

## ENTRYPOINT PATTERN
```typescript
import { createDbClient } from '../_shared/create-db-client.ts';

export default async function (req: Request): Promise<Response> {
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
  const serviceRoleKey = Deno.env.get('INSFORGE_SERVICE_ROLE_KEY');
  const db = createDbClient(baseUrl, serviceRoleKey);
  // Parse/authenticate, construct support-core dependencies, delegate, respond.
  return Response.json({ status: 'ok' });
}
```

## SHARED UTILITIES
- **create-db-client.ts**: Accepts the InsForge base URL + service-role key and returns the portable `DatabaseClient` adapter.
- **create-realtime-publisher.ts**: Builds the REST-backed `RealtimePublisher` from the same runtime configuration.
- **webhook-handler-pipelines.ts**: Owns common provider parsing, account resolution, signature verification, service wiring, and response behavior for SMS/email inbound/status handlers.
- **run-claimed-job.ts**: Keeps handler failure separate from completion persistence and quarantines retry-unsafe outcomes.
- **verify-jwt.ts**: Extracts Bearer token, validates against org's JWT secret (looked up from DB by anon key prefix), returns org context.
- **verify-visitor-jwt.ts**: Validates anonymous webchat visitors against widget config secret (no org context).
- **cors.ts**: Adds Access-Control-Allow-Origin / -Methods / -Headers. Required for widget endpoints.

## CRITICAL CONVENTIONS
1. **Composition roots only** – no business logic here. All logic in `packages/support-core/src/services/`.
2. Use `_shared/` for shared utilities – never duplicate code between functions.
3. Two JWT tiers: agent (`verify-jwt.ts`) vs visitor (`verify-visitor-jwt.ts`). Use correct one per endpoint.
4. Widget/browser endpoints wrap responses with CORS; provider webhooks use the shared JSON response helper.
5. Browser-facing OPTIONS preflight is handled before business logic.
6. Error responses return `{ error: string }` JSON (never uncaught exceptions).
7. `_bundled/` is auto-generated – never edit manually. Re-deploy to regenerate.
8. No `@insforge/sdk` here – Deno functions use `fetch()` with service role key.
9. Deno uses explicit relative `.ts` imports; keep support-core dependencies narrow and injected.
10. **Deno-safety** – The Deno runtime does not expose Node globals (`crypto`, `Buffer`, `process.env`, etc.) by default. `insforge/functions/**` MUST NOT import adapters that depend on those globals. The shared `createProviderRegistry()` registers only Deno-safe adapters: Mock (SMS+email) + Telnyx (SMS) + Postmark (email) + 8 stubs (12 total). Twilio remains blocked on a WebCrypto port (see below). The `npm run lint:deno` script (runs `scripts/check-deno-safety.mjs`) catches forbidden patterns.

## ANTI-PATTERNS
- Business logic in entrypoints → breaks testability and composition-root pattern.
- Skipping JWT verification on webhooks → security hole.
- Hardcoding secrets → always `Deno.env.get()` or DB-stored org config.
- Editing `_bundled/` → build artifacts, overwritten on re-deploy.
- Importing broad dependency barrels when one explicit Deno-safe module is sufficient.
- Missing `cors()` on widget endpoints → browser fetch fails without CORS.
- Duplicating code across functions → add to `_shared/` instead.
- `console.log` in production → use structured error responses.
- Importing the Twilio adapter in the Deno registry before it is ported to WebCrypto → fails `npm run lint:deno` and crashes at deploy time.

## Deno-safety / WebCrypto porting path

The Deno registry (`_shared/create-provider-registry.ts`) currently registers 12 providers:
- **4 real** (Deno-safe): MockSmsAdapter, MockEmailAdapter, TelnyxSmsAdapter, PostmarkEmailAdapter
- **8 stubs** (throw "not implemented"): Bandwidth, Vonage, Plivo, MessageBird (SMS); Mailgun, Resend, AwsSes, InsForge (email)

TwilioSmsAdapter is intentionally NOT registered because it still uses Node-only imports that fail in Deno:

| Adapter | Node imports | Blocking |
|---------|-------------|----------|
| TwilioSmsAdapter | `import { createHmac, timingSafeEqual } from 'crypto'`, `Buffer.from()` | HMAC-SHA1 webhook signature, basic auth encoding, timing-safe token comparison |

Twilio remains fully functional on the Node side (`lib/provider-registry.ts`).

**Upgrade path** (to restore Twilio to the Deno registry):
1. Replace `createHmac('sha1', key)` with `crypto.subtle.importKey('raw', ..., { name: 'HMAC', hash: 'SHA-1' })` + `crypto.subtle.sign('HMAC', key, data)`
2. Replace `Buffer.from(x, encoding)` with `new TextEncoder().encode(x)` (for utf-8) or a `Uint8Array` base64 decoder
3. Replace `timingSafeEqual(a, b)` with a manual constant-time `Uint8Array` comparison
4. Replace `buf.toString('base64')` with a manual `btoa` + `String.fromCharCode` chunked encoder or a `toBase64()` helper
5. Add the import + `registerSmsAdapter` call in `_shared/create-provider-registry.ts`
6. Verify: `npm run lint:deno` exits 0 (the check script no longer flags these files)
7. Verify: all existing adapter unit tests still pass under Node

The `npm run lint:deno` script (T3 in `deno-safety-fix` plan) catches any future regression. See `scripts/check-deno-safety.mjs` for the exact patterns scanned.

## _bundled/ regeneration

`_bundled/` is generated deployment output and intentionally is not hand-edited
with source changes. Use the supported InsForge deploy workflow to regenerate
the affected bundles immediately before deployment.
