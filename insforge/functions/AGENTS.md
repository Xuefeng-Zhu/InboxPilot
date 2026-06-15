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
| `sms-inbound` | JWT (org) | HTTP POST (Twilio/Telnyx) — 11 adapters (3 real + 8 stubs) registered in `ProviderRegistry`; real provider webhooks via `x-provider: telnyx` accepted | InboundMessageService |
| `sms-status` | JWT (org) | HTTP POST (provider callback) — 11 adapters (3 real + 8 stubs) registered in `ProviderRegistry`; real provider webhooks via `x-provider: telnyx` accepted | Delivery event update |
| `email-inbound` | JWT (org) | HTTP POST (Postmark) — 11 adapters (3 real + 8 stubs) registered in `ProviderRegistry`; real provider webhooks via `x-provider: mock` accepted | InboundMessageService |
| `email-status` | JWT (org) | HTTP POST (Postmark callback) — 11 adapters (3 real + 8 stubs) registered in `ProviderRegistry`; real provider webhooks via `x-provider: mock` accepted | Delivery event update |
| `process-jobs` | Internal | HTTP GET (cron) | PostgresJobQueue |
| `webchat-identify` | Visitor JWT | HTTP POST (widget) | WebchatThreadService |
| `webchat-thread-init` | Visitor JWT | HTTP POST (widget) | WebchatThreadService |
| `webchat-session-info` | Visitor JWT | HTTP GET (widget) | WebchatThreadService |
| `webchat-inbound` | Visitor JWT | HTTP POST (widget) | InboundMessageService |

## ENTRYPOINT PATTERN
```typescript
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createDbClient } from '../_shared/create-db-client.ts';
import { verifyJwt } from '../_shared/verify-jwt.ts';
import { cors } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  const payload = await verifyJwt(req);
  const db = createDbClient();
  const repo = new XxxRepository(db);
  const service = new XxxService(repo);
  const body = await req.json();
  const result = await service.doSomething(body, payload.orgId);
  return cors(Response.json(result));
});
```

## SHARED UTILITIES
- **create-db-client.ts**: Reads `DATABASE_URL` + `SERVICE_ROLE_KEY` from `Deno.env.get()`. Returns DatabaseClient wired to InsForge PostgREST.
- **create-realtime-publisher.ts**: Reads realtime key from env, returns RealtimePublisher.
- **verify-jwt.ts**: Extracts Bearer token, validates against org's JWT secret (looked up from DB by anon key prefix), returns org context.
- **verify-visitor-jwt.ts**: Validates anonymous webchat visitors against widget config secret (no org context).
- **cors.ts**: Adds Access-Control-Allow-Origin / -Methods / -Headers. Required for widget endpoints.

## CRITICAL CONVENTIONS
1. **Composition roots only** – no business logic here. All logic in `packages/support-core/src/services/`.
2. Use `_shared/` for shared utilities – never duplicate code between functions.
3. Two JWT tiers: agent (`verify-jwt.ts`) vs visitor (`verify-visitor-jwt.ts`). Use correct one per endpoint.
4. Always wrap responses with `cors()` – widgets and webhooks require CORS.
5. OPTIONS preflight handled before any business logic.
6. Error responses return `{ error: string }` JSON (never uncaught exceptions).
7. `_bundled/` is auto-generated – never edit manually. Re-deploy to regenerate.
8. No `@insforge/sdk` here – Deno functions use `fetch()` with service role key.
9. Import support-core from barrel (`packages/support-core/src/index.ts`), never internal paths.
10. **Deno-safety** – The Deno runtime does not expose Node globals (`crypto`, `Buffer`, `process.env`, etc.) by default. `insforge/functions/**` MUST NOT import adapters that depend on those globals. The shared `createProviderRegistry()` registers only Deno-safe adapters: Mock (SMS+email) + Telnyx (SMS) + 8 stubs (11 total). Twilio + Postmark are blocked on a WebCrypto port (see below). The `npm run lint:deno` script (runs `scripts/check-deno-safety.mjs`) catches forbidden patterns.

## ANTI-PATTERNS
- Business logic in entrypoints → breaks testability and composition-root pattern.
- Skipping JWT verification on webhooks → security hole.
- Hardcoding secrets → always `Deno.env.get()` or DB-stored org config.
- Editing `_bundled/` → build artifacts, overwritten on re-deploy.
- Importing support-core internals bypassing barrel → must use `src/index.ts`.
- Missing `cors()` on widget endpoints → browser fetch fails without CORS.
- Duplicating code across functions → add to `_shared/` instead.
- `console.log` in production → use structured error responses.
- Importing Twilio/Postmark adapters in the Deno registry before they are ported to WebCrypto → fails `npm run lint:deno` and crashes at deploy time.

## Deno-safety / WebCrypto porting path

The Deno registry (`_shared/create-provider-registry.ts`) currently registers 11 providers:
- **3 real** (Deno-safe): MockSmsAdapter, MockEmailAdapter, TelnyxSmsAdapter
- **8 stubs** (throw "not implemented"): Bandwidth, Vonage, Plivo, MessageBird (SMS); Mailgun, Resend, AwsSes, InsForge (email)

TwilioSmsAdapter and PostmarkEmailAdapter are intentionally NOT registered. Both use Node-only imports that fail in Deno:

| Adapter | Node imports | Blocking |
|---------|-------------|----------|
| TwilioSmsAdapter | `import { createHmac, timingSafeEqual } from 'crypto'`, `Buffer.from()` | HMAC-SHA1 webhook signature, basic auth encoding, timing-safe token comparison |
| PostmarkEmailAdapter | `import { timingSafeEqual } from 'crypto'`, `Buffer.from()` | Timing-safe server-token comparison |

Both adapters remain fully functional on the Node side (`lib/provider-registry.ts`).

**Upgrade path** (to restore Twilio + Postmark to the Deno registry):
1. Replace `createHmac('sha1', key)` with `crypto.subtle.importKey('raw', ..., { name: 'HMAC', hash: 'SHA-1' })` + `crypto.subtle.sign('HMAC', key, data)`
2. Replace `Buffer.from(x, encoding)` with `new TextEncoder().encode(x)` (for utf-8) or a `Uint8Array` base64 decoder
3. Replace `timingSafeEqual(a, b)` with a manual constant-time `Uint8Array` comparison
4. Replace `buf.toString('base64')` with a manual `btoa` + `String.fromCharCode` chunked encoder or a `toBase64()` helper
5. Re-add the import + `register*Adapter` call in `_shared/create-provider-registry.ts`
6. Verify: `npm run lint:deno` exits 0 (the check script no longer flags these files)
7. Verify: all existing adapter unit tests still pass under Node

The `npm run lint:deno` script (T3 in `deno-safety-fix` plan) catches any future regression. See `scripts/check-deno-safety.mjs` for the exact patterns scanned.

## _bundled/ regeneration

After this plan lands, the following entrypoint sources are stale relative to `_bundled/*.ts` (mtime already behind entrypoint sources by 6 days pre-plan):

- `insforge/functions/_shared/create-provider-registry.ts` (new)
- `insforge/functions/_shared/insforge-secrets.ts` (new)
- `insforge/functions/sms-inbound/index.ts` (modified — uses `createProviderRegistry()`)
- `insforge/functions/email-inbound/index.ts` (modified — uses `createProviderRegistry()`)
- `insforge/functions/sms-status/index.ts` (modified — uses `createProviderRegistry()`)
- `insforge/functions/email-status/index.ts` (modified — uses `createProviderRegistry()`)
- `insforge/functions/process-jobs/index.ts` (modified — `send_outbound_message` refactored to delegate to `OutboundMessageService`)

Regenerate via: `cd insforge && deno bundle functions/<name>/index.ts _bundled/<name>.ts` for each, or use the `insforge-cli` skill's `deploy` command which handles bundling. The actual regeneration is not done in this plan (out of scope; deploy must follow).
