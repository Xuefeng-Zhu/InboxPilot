---
description: InboxPilot project guide – multi-tenant AI customer support platform
globs: *
alwaysApply: true
---

# InboxPilot Knowledge Base

## OVERVIEW
InboxPilot is a multi-tenant AI customer support platform on Next.js App Router + InsForge (Deno BaaS). Processes inbound/outbound SMS & email with AI draft/auto-reply, deterministic escalation, and human handoff. See `docs/README.md` for the full docs index.

**Stack**: Next.js 16 App Router (Turbopack) • TypeScript • React 19 • InsForge (PostgREST + Auth + Functions + Realtime + AI) • Tailwind CSS 3.4 (locked — do NOT upgrade to v4) • Vitest/fast-check • npm (no workspaces — see Notes)

## STRUCTURE
```
app/                          Next.js pages – inbox, knowledge, analytics, settings, login, register, team, wchat, symphony
app/api/functions/            12 JWT-authed Next.js Route Handlers (send-reply, team actions, etc.)
components/                   React components – inbox/, knowledge/, customers/, landing/, layout/, ui/
lib/                          Frontend utilities & React Query hooks (insforge.ts, auth-context.tsx, queries/)
packages/support-core/        Portable business logic (see packages/support-core/AGENTS.md)
insforge/functions/           9 Deno serverless entrypoints (see insforge/functions/AGENTS.md)
insforge/migrations/          25 SQL migration files + seed.sql
widget-src/                   Vite + TS webchat widget bundle
docs/                         Architecture, database, API, RBAC, audit, jobs, webchat, testing references + guides
```

## WHERE TO LOCATE KEY FILES
| Need | Look in |
|------|---------|
| Auth UI | `app/login/`, `app/register/`, `lib/auth-context.tsx` |
| Inbox UI | `app/inbox/`, `components/inbox/` |
| Settings UI | `app/settings/` |
| Symphony (timeline) UI | `app/symphony/` |
| API routes (agent actions) | `app/api/functions/` |
| InsForge SDK client | `lib/insforge.ts` |
| React Query hooks | `lib/queries/hooks/` |
| Business logic (services) | `packages/support-core/src/services/` |
| Data access (repositories) | `packages/support-core/src/repositories/` |
| Provider adapters (SMS/Email) | `packages/support-core/src/adapters/` |
| InsForge Deno functions | `insforge/functions/` |
| Migrations & seed | `insforge/migrations/`, `insforge/seed.sql` |
| Docs index | `docs/README.md` |
| Test suites | `__tests__/`, `packages/support-core/__tests__/` |

## CODE MAP

### Data Flow
```
External (Twilio/Telnyx/Postmark/Widget)
  → insforge/functions/ (Deno entrypoints: parse request, verify JWT, delegate)
    → packages/support-core/services/ (business logic orchestration)
      → packages/support-core/repositories/ (data access, returns typed entities)
        → InsForge PostgREST (auto-generated HTTP API with RLS)
          → PostgreSQL

Next.js Client (agent actions)
  → app/api/functions/ (Next.js Route Handlers, verify JWT)
    → packages/support-core/services/
      → packages/support-core/repositories/
```

### Key Modules
- **InboundMessageService**: Normalize inbound SMS/email → deduplicate → create/update conversation → persist message → enqueue idempotent AI work → atomically audit receipt
- **OutboundMessageService**: Resolve conversation/contact → dispatch through the injected provider adapter → persist message → finalize conversation/audit with typed retry boundaries
- **AiAgentService**: Evaluate deterministic escalation → retrieve knowledge → call OpenRouter when allowed → store one recoverable decision per source job
- **PostgresJobQueue**: Enqueue with active/lifetime idempotency → atomically claim → retry with exponential backoff → quarantine uncertain/stale work
- **EscalationRules**: Pre-AI rule evaluation (profanity, legal threats, safety concerns) → blocks/overrides AI auto-reply

## CORE CONVENTIONS

1. **Portability** (CRITICAL): `packages/support-core/` MUST NOT import `@insforge/sdk` or any InsForge-specific code. All external dependencies injected via interfaces (`DatabaseClient`, `JobQueue`, `AiClient`, `SmsProviderAdapter`, `EmailProviderAdapter`, etc.).
2. **SDK usage**: Frontend uses `@insforge/sdk` via `lib/insforge.ts`. Use `insforge.database.from('table').select().eq().order()` chainable API. Never raw fetch.
3. **Auth methods**: `insforge.auth.signUp()`, `.signInWithPassword()`, `.getCurrentUser()`, `.signOut()`.
4. **Tailwind CSS**: v3.4 only. Never upgrade to v4. Lock in `package.json`.
5. **Testing**: Business logic needs property-based tests (fast-check, 100+ iterations). See `docs/reference/testing.md` for 17 correctness properties.
6. **Audit logging**: Every significant action logged to `audit_logs`. See `docs/reference/audit.md` for allowed action strings.
7. **RLS**: All tenant-scoped tables have Row Level Security. Never bypass from client code.
8. **InsForge SDK**: Always fetch latest docs via `fetch-docs`/`fetch-sdk-docs` MCP tools before writing InsForge integration code. SDK returns `{data, error}` tuple. Database inserts use array format: `insert([{...}])`.
9. **No lint/format config**: Conventions enforced via AGENTS.md only. No ESLint, Prettier, or semantic config files.
10. **Type safety**: `as any`, `@ts-ignore`, `@ts-expect-error` never allowed. Empty catch blocks `catch(e) {}` never allowed.

## ANTI-PATTERNS TO WATCH FOR

- **Importing @insforge/sdk in support-core** – breaks portability. All dependencies injected via interfaces.
- **Bypassing RLS with service_role key in client** – security violation. Service role is server-side only.
- **Skipping property tests** – all new business logic needs fast-check property tests.
- **Empty catch blocks** – never suppress errors.
- **Type suppression** with `as any`, `@ts-ignore` – never allowed.
- **Hardcoded tenant IDs** – must come from JWT context (auth.uid() / org context).
- **Direct fetch() to InsForge** – always go through `lib/insforge.ts` SDK client.
- **Refactoring while bugfixing** – fix minimally, never refactor during fixes.
- **Testing with real provider credentials** – use mock/stub adapters from `packages/support-core/src/adapters/`.
- **Editing `_bundled/` files in insforge/functions/** – build artifacts, re-deploy to regenerate.

## UNIQUE STYLES

- **Monorepo with turbo@2**: `npm run dev` (parallel), `npm run build` (ordered), `npm run lint`, `npm run type-check`, `npm test`.
- **Portable business logic package**: `packages/support-core` is a separate npm workspace package with its own `package.json` and `tsconfig.json`. Extracted for potential reuse outside InsForge.
- **Interface-first architecture**: Every external dependency has a TypeScript interface in `packages/support-core/src/interfaces/`. Implementations injected at entrypoint layer.
- **Deterministic escalation before AI**: Escalation rules evaluate BEFORE any LLM call. If a rule triggers, the AI never sees the message.
- **Symphony timeline**: Custom river visualization at `app/symphony/` (River, TimeAxis, MiniMap, RiverCard, RiverExpandedPanel components).
- **proxy.ts pattern**: Root-level proxy middleware (Next.js 16 style, not standard middleware.ts convention).
- **NEXT_PUBLIC_INSFORGE_URL** env var naming (InsForge-specific, not Supabase-style).
- **Mock/stub adapter hierarchy**: Each provider has a mock (in-memory, dev) and stub (static canned responses) variant for testing.

## COMMANDS

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Next.js dev server (Turbopack) |
| `npm run build` | Build all (`build:widget` → `next build`) |
| `npm run build:widget` | Vite build of `widget-src/` → `public/widget.js` |
| `npm test` | Run all tests (Vitest) |
| `npm run test:watch` | Test watch mode |
| `npm run test:core` | Run support-core tests only |
| `npm run test:integration:*` | Run one guarded live suite against a linked disposable `qa-*` branch |
| `npm run lint` | `tsc --noEmit`, Deno safety scan, and `deno check` for all 9 function entrypoints |
| `cd packages/support-core && npm test` | Support-core tests only |
| `node scripts/mock-sms.mjs inbound "Hi"` | Simulate SMS traffic against real backend |

## NOTES

- No ESLint/Prettier config – formatting conventions enforced by AGENTS.md.
- No TS/JS LSP available in dev environment – rely on `npm run lint` and `npm test` for correctness.
- InsForge project: **InboxPilot** (API base `https://y39ezar3.us-east.insforge.app`).
- Credentials in `.env.local` (client) and `.insforge/project.json` (CLI). Never commit.
- Use InsForge skills (`/insforge`, `/insforge-cli`, `/insforge-debug`, `/insforge-integrations`) before writing InsForge integration code.

## KNOWN ISSUES / GOTCHAS

- **Repository count: 15, not 16.** `PostgresJobQueue` lives in `services/` (not `repositories/`) — it implements the `JobQueue` interface and carries business logic (idempotency, backoff, dead-lettering), not table CRUD. Update the README if you touch this.
- **Table count: 20 application tables.** The 20th is `ai_decision_chunks` (added in migration 007); storage/realtime platform tables are not included.
- **Migration count: 25 files.** This includes numbered migrations `001` through `023` plus two timestamped job-trigger migrations; preserve the documented application order because the second timestamped file drops the first file's unreliable trigger.
- **`app/symphony/` is built but undocumented** in `README.md` and the original AGENTS.md. Has its own 7 components, 3 tests, and a data hook (`useSymphony.ts`), linked from Sidebar. Treat as in-progress.
- **`TelnyxSmsAdapter.verifyWebhook` verifies ed25519 signatures** using the configured Telnyx public key in `signingSecret` (hex/base64/base64url) and a 5-minute timestamp replay window.
- **Six opt-in live integration suites replace the former 45 placeholders.** Seed idempotency lives under support-core; inbound SMS/email, outbound, RLS, and realtime live under root `__tests__/insforge/`. Normal `npm test` skips their remote mutations.
- **`proxy.ts` checks cookie PRESENCE only** (not JWT validity). Real auth boundary is in `app/api/functions/_auth.ts` and `insforge/functions/_shared/verify-jwt.ts`.
- **`insforge/functions/_bundled/` is deno bundle output**, mtime `Jun 8` (older than entrypoints `Jun 14`). Regenerate before deploy.
- **`.kiro/settings/mcp.json` contains plaintext API keys** (Stitch + InsForge). If you fork publicly, scrub these.
- **Two `Topbar.tsx` files exist on purpose** — `components/Topbar.tsx` (landing) vs `components/layout/Topbar.tsx` (in-app, with auth). Not duplicates.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **InboxPilot** (API base `https://y39ezar3.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
