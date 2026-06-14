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
| `sms-inbound` | JWT (org) | HTTP POST (Twilio/Telnyx) | InboundMessageService |
| `sms-status` | JWT (org) | HTTP POST (provider callback) | Delivery event update |
| `email-inbound` | JWT (org) | HTTP POST (Postmark) | InboundMessageService |
| `email-status` | JWT (org) | HTTP POST (Postmark callback) | Delivery event update |
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

## ANTI-PATTERNS
- Business logic in entrypoints → breaks testability and composition-root pattern.
- Skipping JWT verification on webhooks → security hole.
- Hardcoding secrets → always `Deno.env.get()` or DB-stored org config.
- Editing `_bundled/` → build artifacts, overwritten on re-deploy.
- Importing support-core internals bypassing barrel → must use `src/index.ts`.
- Missing `cors()` on widget endpoints → browser fetch fails without CORS.
- Duplicating code across functions → add to `_shared/` instead.
- `console.log` in production → use structured error responses.
