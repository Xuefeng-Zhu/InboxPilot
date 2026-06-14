# insforge/ — BaaS Backend

**Always loaded** for any work touching the database, Deno functions, RLS, or migrations.

## OVERVIEW
The committed InsForge backend tree. Contains **9 Deno function entrypoints** (webhooks + cron + widget), **10 SQL migrations** (NOT 5 — docs are stale), a `seed.sql`, and a `_bundled/` directory of `deno bundle` output. The real InsForge project is **InboxPilot** (API base `https://y39ezar3.us-east.insforge.app`); credentials in `.insforge/project.json` (gitignored).

## WHERE TO LOOK
| Need | Location |
|---|---|
| Add a new Deno function (webhook, cron, widget) | `functions/<name>/index.ts` (delegates to `packages/support-core/`) |
| Modify a shared function utility (DB, JWT, CORS, realtime) | `functions/_shared/` |
| Schema, tables, constraints | `migrations/001_initial_schema.sql` (17 tables) + 005 (webchat) + 007 (ai_decision_chunks) |
| RLS policies + `user_org_ids()` helper | `migrations/003_rls_policies.sql` + `005_webchat.sql` + `007_ai_decision_chunks.sql` |
| RPC functions (vector search, job claim, onboarding, AI chunks) | `migrations/002_rpc_functions.sql`, `004`, `007`, `008` |
| Bundled output (deploy) | `functions/_bundled/*.ts` (regenerate via `deno bundle` — see `insforge-cli` skill) |
| Dev seed | `seed.sql` (idempotent) |

## CRITICAL RULES
1. **RLS is the security boundary.** Every tenant-scoped table has RLS policies (naming: `{table}_{action}`). Use helpers `auth.uid()` + `public.user_org_ids()`. Bypass ONLY via `INSFORGE_SERVICE_ROLE_KEY` on the server, never in client code.
2. **Deno functions delegate to `packages/support-core/`** for business logic. They parse the request, verify auth (visitor JWT or agent JWT), construct the dependency graph, call the support-core service, then publish realtime / return.
3. **The `_bundled/` directory is `deno bundle` output, not source.** Do NOT hand-edit. Regenerate via the `insforge` CLI before deploy.
4. **Migration files are append-only.** Never edit a past migration — add a new one (`009_…`, `010_…`).
5. **`audit_logs` is append-only at the RLS level** — only INSERT and SELECT policies exist, no UPDATE or DELETE.
6. **All realtime publishes go to the `org:${orgId}` channel** with one of 3 event names: `new_message`, `conversation_updated`, `knowledge_document_updated`. Visitor channels use `widget:${widgetId}:${jti}`.

## CONVENTIONS
- **Deno entrypoint shape:** each `functions/<name>/index.ts` is a `Deno.serve` handler that parses the request, runs JWT verification, builds the support-core service, calls it, and returns JSON.
- **Realtime publishing is best-effort.** Failures are logged via `console.error`, not thrown. See `_shared/create-realtime-publisher.ts`.
- **Visitor JWTs vs agent JWTs:** `_shared/verify-jwt.ts` checks agent tokens, `_shared/verify-visitor-jwt.ts` checks visitor tokens. Use the right one per entrypoint.
- **Bundle output naming:** `_bundled/<function-name>.ts` mirrors the source directory, e.g. `functions/sms-inbound/index.ts` → `_bundled/sms-inbound.ts`.
- **Migration numbers are sequential.** Apply in numeric order — InsForge doesn't auto-resolve order.
- **RPCs in 002 are superseded by 008** for `claim_support_jobs` (008 adds `claim_limit int` parameter). Both exist; Postgres dispatches by arity. Old callers still work.

## ANTI-PATTERNS
- Hand-editing `_bundled/*.ts` (regenerate via `deno bundle` instead).
- Bypassing RLS from Deno functions without the service role key (defeats tenant isolation).
- Editing old migration files (append a new one).
- Importing from `@insforge/sdk` inside a Deno function for business logic (delegate to support-core).
- Using `console.log` (use `console.error` for error paths, nothing for normal flow).
- Hardcoding the InsForge project URL in a function (read from `Deno.env.get('INSFORGE_URL')`).

## UNIQUE
- **`_bundled/` mtime is `Jun 8`** while entrypoints are `Jun 14` — bundle is stale. Regenerate before deploying.
- **`webchat-inbound`, `sms-inbound`, `email-inbound` each instantiate a `PostgRestJobQueue`** whose `claim/complete/fail` throw — they only need `enqueue`. Could be replaced with a narrow `JobEnqueuer` interface to remove dead-code branches.
- **`process-jobs` is the largest bundled file** (6,340 LOC) because it pulls in the entire support-core service layer.
- **No storage buckets used.** Knowledge documents store text + pgvector embeddings directly in tables.
- **`realtime` publishing uses REST broadcast**, not WebSocket (server side). Client subscribes via `lib/use-realtime.ts` WebSocket.

## NOTES
- Use the `insforge` skill for app code with `@insforge/sdk`, the `insforge-cli` skill for backend infrastructure (migrations, RLS, functions deploy), and the `insforge-debug` skill for diagnosing failures.
- Table count is **20** (not 19 — the 20th is `ai_decision_chunks` from migration 007). `docs/reference/database.md` is stale.
- Migration count is **10** (not 5). 006 (activity backfill), 007 (ai_decision_chunks), 008 (replaces `claim_support_jobs` from 002), 009 (org SLA thresholds), 010 (drop pending status) are missing from the docs.
- The README claims `lib/queries.ts` exists; it does not — the actual data layer is `lib/queries/` (a subdir).
