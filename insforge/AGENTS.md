# insforge/ — BaaS Backend

**Always loaded** for any work touching the database, Deno functions, RLS, or migrations.

## OVERVIEW
The committed InsForge backend tree. Contains **9 Deno function entrypoints** (webhooks + cron + widget), **23 SQL migration files**, a `seed.sql`, and a `_bundled/` directory of generated deploy output. The real InsForge project is **InboxPilot** (API base `https://y39ezar3.us-east.insforge.app`); credentials in `.insforge/project.json` (gitignored).

## WHERE TO LOOK
| Need | Location |
|---|---|
| Add a new Deno function (webhook, cron, widget) | `functions/<name>/index.ts` (delegates to `packages/support-core/`) |
| Modify a shared function utility (DB, JWT, CORS, realtime) | `functions/_shared/` |
| Schema, tables, constraints | `migrations/001_initial_schema.sql` plus later numbered migrations through 021 |
| RLS policies + helpers | `migrations/003_rls_policies.sql`, `005`, `007`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `021` |
| RPC functions | `migrations/002`, `004`, `007`, `008`, `012`, `013`, `016`, `018`, `020`, `021` |
| Bundled output (deploy) | `functions/_bundled/*.ts` (regenerate via `deno bundle` — see `insforge-cli` skill) |
| Dev seed | `seed.sql` (idempotent) |

## CRITICAL RULES
1. **RLS is the security boundary.** Every tenant-scoped table has RLS policies (naming: `{table}_{action}`). Use helpers `auth.uid()` + `public.user_org_ids()`. Bypass ONLY via `INSFORGE_SERVICE_ROLE_KEY` on the server, never in client code.
2. **Deno functions delegate to `packages/support-core/`** for business logic. They parse the request, verify auth (visitor JWT or agent JWT), construct the dependency graph, call the support-core service, then publish realtime / return.
3. **The `_bundled/` directory is `deno bundle` output, not source.** Do NOT hand-edit. Regenerate via the `insforge` CLI before deploy.
4. **Applied migration files are append-only.** Add the next numbered migration instead of editing a deployed one.
5. **`audit_logs` is append-only at the RLS level** — only INSERT and SELECT policies exist, no UPDATE or DELETE.
6. **All realtime publishes go to the `org:${orgId}` channel** with one of 3 event names: `new_message`, `conversation_updated`, `knowledge_document_updated`. Visitor channels use `widget:${widgetId}:${jti}`.
7. **Deno-safety** — `insforge/functions/**` runs on the Deno serverless runtime. Imports of Node-only modules (`crypto`, `node:*`, `Buffer`) fail at deploy time. The `npm run lint:deno` script (`scripts/check-deno-safety.mjs`) catches this; it is chained into `npm run lint` after `tsc --noEmit`. The Deno registry currently registers 11 adapters (Mock SMS+email + Telnyx SMS + 8 stubs). Twilio + Postmark are blocked on a WebCrypto port — see `insforge/functions/AGENTS.md` for the porting path.

## CONVENTIONS
- **Deno entrypoint shape:** each `functions/<name>/index.ts` is a `Deno.serve` handler that parses the request, runs JWT verification, builds the support-core service, calls it, and returns JSON.
- **Realtime publishing is best-effort.** Failures are logged via `console.error`, not thrown. See `_shared/create-realtime-publisher.ts`.
- **Visitor JWTs vs agent JWTs:** `_shared/verify-jwt.ts` checks agent tokens, `_shared/verify-visitor-jwt.ts` checks visitor tokens. Use the right one per entrypoint.
- **Bundle output naming:** `_bundled/<function-name>.ts` mirrors the source directory, e.g. `functions/sms-inbound/index.ts` → `_bundled/sms-inbound.ts`.
- **Migration numbers are sequential.** Apply in numeric order — InsForge doesn't auto-resolve order.
- **The current claim RPC is defined in 016.** `PostgresJobQueue` retries the historical `max_count` named argument only for compatibility with older deployed databases.

## ANTI-PATTERNS
- Hand-editing `_bundled/*.ts` (regenerate via `deno bundle` instead).
- Bypassing RLS from Deno functions without the service role key (defeats tenant isolation).
- Editing old migration files (append a new one).
- Importing from `@insforge/sdk` inside a Deno function for business logic (delegate to support-core).
- Using `console.log` (use `console.error` for error paths, nothing for normal flow).
- Hardcoding the InsForge project URL in a function (read from `Deno.env.get('INSFORGE_URL')`).
- Adding Node-only imports (`crypto`, `Buffer`, `node:*`) to `insforge/functions/` — fails `npm run lint:deno` and crashes the Deno runtime at deploy.

## UNIQUE
- **`_bundled/` is generated and may lag source.** Regenerate through the supported deploy workflow; never hand-edit it.
- **`webchat-inbound`, `sms-inbound`, and `email-inbound` share `PostgresJobQueue`** with the worker, including database-enforced enqueue idempotency.
- **`process-jobs` is the largest bundled file** (6,340 LOC) because it pulls in the entire support-core service layer.
- **Knowledge uploads use the private `knowledge-files` bucket.** Object keys are organization-prefixed and protected by migration 014 storage policies.
- **`realtime` publishing uses REST broadcast**, not WebSocket (server side). Client subscribes via `lib/use-realtime.ts` WebSocket.

## NOTES
- Use the `insforge` skill for app code with `@insforge/sdk`, the `insforge-cli` skill for backend infrastructure (migrations, RLS, functions deploy), and the `insforge-debug` skill for diagnosing failures.
- Table count is **20** (the 20th is `ai_decision_chunks` from migration 007).
- Migration count is **23** (`001` through `021` plus the two timestamped job-trigger migrations).
- The frontend data layer lives under `lib/queries/`.
