# InboxPilot — AI Customer Support Platform

InboxPilot is a multi-tenant AI-powered customer support platform built on [InsForge](https://insforge.app). It handles inbound and outbound communication over SMS, email, and embedded web chat; uses AI to draft and auto-reply to messages; and escalates sensitive conversations to human agents.

## Features

- **Multi-channel support** — SMS (Twilio, Telnyx), email (Postmark), and embedded web chat with provider-neutral adapters
- **AI-powered responses** — Draft, auto-reply, and escalation modes powered by OpenRouter LLMs
- **Knowledge base** — Upload documents for AI retrieval-augmented generation (RAG) with pgvector
- **Escalation engine** — Deterministic rules evaluated before any LLM call (profanity, legal threats, safety concerns, etc.)
- **Role-based access** — Owner, admin, agent, and viewer roles with row-level security
- **Job queue** — Postgres-backed async processing with exponential backoff and dead-lettering
- **Realtime updates** — InsForge Realtime events for inbox, messages, and knowledge documents
- **Audit logging** — Append-only log of all significant actions for compliance
- **RAG context persistence** — Every AI decision records which knowledge chunks it used (`ai_decision_chunks` table) for traceability and post-hoc analysis

## Architecture

```
Next.js Frontend
  → InsForge Auth (JWT)
  → InsForge PostgREST (auto-generated APIs with RLS)
  → InsForge Deno Functions (9 webhook/job/widget entrypoints)
    → support-core package (portable business logic)
      → Provider-neutral adapters (SMS, Email)
      → Repository layer (data access abstraction)
      → Postgres-backed Job Queue
  → InsForge Realtime (Socket.IO)
  → InsForge AI Gateway (OpenRouter)
```

All business logic lives in `packages/support-core/` and never imports the InsForge SDK directly. This ensures portability — the platform can migrate to another backend without changing business logic.

### Layered Architecture

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Function Entrypoints | `insforge/functions/` | Request parsing, auth, delegation |
| Service Layer | `packages/support-core/src/services/` | Business logic orchestration |
| Repository Layer | `packages/support-core/src/repositories/` | Data access abstraction |
| Adapter Layer | `packages/support-core/src/adapters/` | Provider-specific integrations |

## Prerequisites

- **Node.js** 20.9+ (required by the installed Next.js 16 release)
- **npm** 9+
- **Deno** 2+ (required by `npm run lint` to type-check the 9 function entrypoints)
- **InsForge account** with a project configured (PostgreSQL + Auth + Functions + Realtime)
- **OpenRouter API key** (for AI features)
- Provider accounts (optional): Twilio, Telnyx, Postmark

## Environment Setup

1. Copy the environment template:

```bash
cp .env.example .env.local
```

2. Fill in the required values in `.env.local`:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_INSFORGE_URL` | InsForge project base URL |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | InsForge anonymous/public API key |
| `INSFORGE_SERVICE_ROLE_KEY` | InsForge service role key (server-side only) |
| `PROCESS_JOBS_SECRET` | Dedicated server-only secret shared by the worker scheduler and trusted triggers |

See `.env.example` for the full list with comments.

## Database Setup

### Apply Migrations

Apply the SQL migration files in order to your InsForge PostgreSQL database:

| File | Purpose |
|---|---|
| `insforge/migrations/001_initial_schema.sql` | 17 core tables, indexes, CHECK constraints, `pgcrypto` + `vector` extensions |
| `insforge/migrations/002_rpc_functions.sql` | `match_knowledge_chunks` (RAG); initial `claim_support_jobs` (superseded by 008) |
| `insforge/migrations/003_rls_policies.sql` | RLS policies, `user_org_ids()` helper, `credentials_secret_id` column revocations |
| `insforge/migrations/004_create_organization_onboarding_rpc.sql` | `create_organization_with_owner(name, slug)` — atomic signup RPC |
| `insforge/migrations/005_webchat.sql` | Loosens `channel` CHECK for `'webchat'`; `webchat_widgets`, `webchat_threads` tables + RLS |
| `insforge/migrations/006_backfill_conversation_activity.sql` | Backfills `last_message_at` / `last_customer_message_at` on conversations |
| `insforge/migrations/007_ai_decision_chunks.sql` | `ai_decision_chunks` table; `ai_decision_chunks_validate()` trigger; `insert_ai_decision_chunks()` RPC |
| `insforge/migrations/008_claim_failed_jobs.sql` | Drops old `idx_support_jobs_pending`; new `idx_support_jobs_claimable` index; replaces `claim_support_jobs` with overload using `claim_limit` that also claims failed jobs |
| `insforge/migrations/009_org_sla_thresholds.sql` | Adds `organizations.sla_thresholds jsonb`; `conversations.last_message_direction text`; backfill from `messages.direction` |
| `insforge/migrations/010_drop_pending_status.sql` | Drops `'pending'` from `conversations.status` CHECK (was in 001 but never assigned by code) |
| `insforge/migrations/011_ai_settings_embedding_model.sql` | Adds the independent knowledge embedding model setting and updates the default chat model |
| `insforge/migrations/012_replace_knowledge_chunks.sql` | Adds transactional replacement of a document's knowledge chunks |
| `insforge/migrations/013_webchat_realtime_widget_channel.sql` | Registers org/widget realtime channels and adds the server-only realtime publish RPC |
| `insforge/migrations/20260615074718_trigger-process-jobs-on-insert.sql` | Adds an HTTP job trigger (superseded by the next migration after the extension proved unreliable) |
| `insforge/migrations/20260615080500_drop-broken-trigger.sql` | Removes the unreliable HTTP job trigger; scheduled processing remains the active path |
| `insforge/migrations/014_role_aware_rls_and_knowledge_storage.sql` | Enforces role-aware settings/knowledge RLS, hides provider and widget secrets, records knowledge object keys, and adds organization-scoped storage policies |
| `insforge/migrations/015_bind_knowledge_jobs_to_documents.sql` | Requires browser-enqueued knowledge jobs to reference a document in the same organization |
| `insforge/migrations/016_job_and_ai_decision_idempotency.sql` | Adds retry-safe job/decision, stale-claim, knowledge-revision, and inbound-audit guards |
| `insforge/migrations/017_lock_down_legacy_webchat_access.sql` | Removes legacy public webchat policies/grants and the obsolete auth-debug helper |
| `insforge/migrations/018_atomic_ai_source_turns.sql` | Adds atomic latest-turn tracking and source-bound AI state/dispatch claims |
| `insforge/migrations/019_restrict_ai_decision_writes.sql` | Makes AI decisions browser-read-only and reserves mutations for trusted server paths |
| `insforge/migrations/020_bind_pending_ai_drafts.sql` | Binds approval/regeneration to one pending AI decision with owner-guarded dispatch claims |

Apply all 22 files via the InsForge SQL editor or migrations API in the order shown above. Migration `014` intentionally does not change bucket visibility: after applying it, mark the existing `knowledge-files` bucket **private** in the InsForge dashboard. Keep knowledge object keys under `<organization-id>/documents/...`; the migration's storage policies depend on that prefix. Pause scheduled `process-jobs` invocations and let any active invocation finish before applying `018`; deploy the source-bound routes/functions before resuming the schedule. Migration `019` removes direct browser mutation access to server-produced AI decisions. Apply `020` before deploying the owner-bound approval/regeneration routes that call its RPCs.

### Seed Data

Load sample data for local development:

```bash
# Apply via InsForge SQL editor
insforge/seed.sql
```

The seed script is idempotent — running it multiple times will not create duplicates. It creates:
- 1 organization with 1 owner member
- 3 contacts (SMS and email)
- 5 conversations across SMS and email channels
- 10 messages with varied sender types and directions
- 2 knowledge documents with chunks and embeddings
- Sample AI settings

## Installation

```bash
npm install
```

## Development

### Frontend Dev Server

```bash
npm run dev
```

The Next.js development server starts at `http://localhost:3000`.

### Function Deployment

The `process-jobs` function fails closed unless its scheduler and trusted server
callers share a dedicated secret. Complete this preflight before deploying:

1. Create the secret in InsForge so it is available to the Deno function runtime:

```bash
npx @insforge/cli secrets add PROCESS_JOBS_SECRET '<long-random-secret>'
```

2. Put that exact value in the Next.js **server** environment as
   `PROCESS_JOBS_SECRET` (`.env.local` only configures the local Next.js server;
   it does not configure the Deno runtime).
3. If a `process-jobs` schedule already exists, secure it before deploying:

```bash
npx @insforge/cli schedules list
npx @insforge/cli schedules update <schedule-id> \
  --method POST \
  --headers '{"X-Process-Jobs-Secret":"${{secrets.PROCESS_JOBS_SECRET}}"}'
```

Then deploy all 9 InsForge Deno function entrypoints from the checked-in source
manifest:

```bash
npm run deploy:functions
```

For a new environment, create the schedule only after `process-jobs` is active;
see [the deployment guide](docs/guides/deploying.md#4-create-a-new-schedule-after-deployment).

| Function | Trigger | Purpose |
|----------|---------|---------|
| `sms-inbound` | SMS provider webhook | Process inbound SMS messages |
| `sms-status` | SMS provider webhook | Track SMS delivery status |
| `email-inbound` | Email provider webhook | Process inbound emails |
| `email-status` | Email provider webhook | Track email delivery status |
| `process-jobs` | Cron/scheduler | Claim and route pending jobs |
| `webchat-identify` | Widget API | Identify web chat visitors |
| `webchat-thread-init` | Widget API | Start web chat threads |
| `webchat-session-info` | Widget API | Load widget session context |
| `webchat-inbound` | Widget API | Process inbound web chat messages |

The frontend calls 12 local Next.js API routes under `app/api/functions/` for authenticated agent actions: `send-reply`, `approve-ai-draft`, `regenerate-ai-draft`, `escalate-conversation`, `resolve-conversation`, `reopen-conversation`, `test-channel-connection`, `invite-member`, `change-member-role`, `remove-member`, `team-member-info`, and `delete-widget`.

## Testing

### Run All Tests

```bash
npm test
```

This runs all unit tests and property-based tests via Vitest.

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Test Organization

```
packages/support-core/__tests__/
  properties/           # Property-based tests (fast-check, 100+ iterations each)
    normalization.prop.test.ts     # Phone/email normalization idempotence
    webhook-roundtrip.prop.test.ts # Webhook payload round-trip
    ai-decision.prop.test.ts       # AI decision JSON round-trip
    escalation.prop.test.ts        # Escalation engine triggers
    deduplication.prop.test.ts     # Message deduplication
    job-queue.prop.test.ts         # Job queue backoff/dead-lettering
    auto-reply.prop.test.ts        # Auto-reply threshold gating
    state-machine.prop.test.ts     # Conversation state machine
    rbac.prop.test.ts              # RBAC permission enforcement
    audit-log.prop.test.ts         # Audit log immutability
    knowledge.prop.test.ts         # Knowledge chunk similarity
  unit/                 # Example-based unit tests
    inbound-message-service.test.ts
    outbound-message-service.test.ts
    ai-agent-service.test.ts
    knowledge-ingestion-service.test.ts
    escalation-engine.test.ts
    conversation-service.test.ts
    ...
  integration/          # Integration test stubs (require real database)
    inbound-sms-flow.test.ts
    inbound-email-flow.test.ts
    outbound-message-flow.test.ts
    rls-policies.test.ts
    realtime-events.test.ts
    seed-idempotency.test.ts
```

## Project Structure

```
├── app/                          # Next.js pages
│   ├── inbox/                    # Conversation inbox
│   ├── knowledge/                # Knowledge base management
│   ├── analytics/                # Analytics dashboard
│   ├── settings/                 # AI, SMS, email settings
│   ├── login/                    # Authentication
│   └── register/                 # Registration
├── components/                   # React components
│   └── inbox/                    # Inbox UI components
├── lib/                          # Frontend utilities
│   ├── insforge.ts               # InsForge client wrapper
│   ├── auth-context.tsx          # Auth provider and hook
│   └── use-realtime.ts           # Realtime polling hook
├── insforge/                     # InsForge configuration
│   ├── functions/                # 9 serverless function entrypoints
│   ├── migrations/               # SQL migration files
│   └── seed.sql                  # Development seed data
├── packages/
│   └── support-core/             # Portable business logic
│       ├── src/
│       │   ├── adapters/         # SMS/email provider adapters
│       │   ├── interfaces/       # TypeScript interfaces
│       │   ├── repositories/     # Data access layer
│       │   ├── services/         # Business logic services
│       │   ├── types/            # Shared type definitions
│       │   └── utils/            # Normalization, chunking
│       └── __tests__/            # Tests
├── proxy.ts                       # Next.js auth proxy
├── vitest.config.ts              # Test configuration
└── .env.example                  # Environment variable template
```

## License

Private — not for redistribution.
