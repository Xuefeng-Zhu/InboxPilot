# InboxPilot — AI Customer Support Platform

InboxPilot is a multi-tenant AI-powered customer support platform built on [InsForge](https://insforge.app). It handles inbound and outbound communication over SMS and email, uses AI to draft and auto-reply to messages, and escalates sensitive conversations to human agents.

## Features

- **Multi-channel support** — SMS (Twilio, Telnyx) and email (Postmark) with provider-neutral adapters
- **AI-powered responses** — Draft, auto-reply, and escalation modes powered by OpenRouter LLMs
- **Knowledge base** — Upload documents for AI retrieval-augmented generation (RAG) with pgvector
- **Escalation engine** — Deterministic rules evaluated before any LLM call (profanity, legal threats, safety concerns, etc.)
- **Role-based access** — Owner, admin, agent, and viewer roles with row-level security
- **Job queue** — Postgres-backed async processing with exponential backoff and dead-lettering
- **Realtime updates** — Polling-based live updates for inbox, messages, and knowledge documents
- **Audit logging** — Append-only log of all significant actions for compliance

## Architecture

```
Next.js Frontend
  → InsForge Auth (JWT)
  → InsForge PostgREST (auto-generated APIs with RLS)
  → InsForge Deno Functions (14 thin entrypoints)
    → support-core package (portable business logic)
      → Provider-neutral adapters (SMS, Email)
      → Repository layer (data access abstraction)
      → Postgres-backed Job Queue
  → InsForge Realtime (polling-based MVP)
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

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
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

See `.env.example` for the full list with comments.

## Database Setup

### Apply Migrations

Apply the SQL migration files in order to your InsForge PostgreSQL database:

```bash
# 1. Initial schema — all 17 tables, indexes, constraints
insforge/migrations/001_initial_schema.sql

# 2. RPC functions — match_knowledge_chunks, claim_support_jobs
insforge/migrations/002_rpc_functions.sql

# 3. Row Level Security policies — tenant isolation, append-only audit logs
insforge/migrations/003_rls_policies.sql
```

Apply each file via the InsForge SQL editor or migrations API.

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

Deploy the InsForge Deno functions from the `insforge/functions/` directory using the InsForge CLI or dashboard. There are 14 function entrypoints:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `sms-inbound` | SMS provider webhook | Process inbound SMS messages |
| `sms-status` | SMS provider webhook | Track SMS delivery status |
| `email-inbound` | Email provider webhook | Process inbound emails |
| `email-status` | Email provider webhook | Track email delivery status |
| `send-reply` | Frontend (JWT) | Send outbound replies |
| `approve-ai-draft` | Frontend (JWT) | Approve and send AI drafts |
| `regenerate-ai-draft` | Frontend (JWT) | Regenerate AI drafts |
| `process-ai-job` | Job queue | Process AI message analysis |
| `process-knowledge-document` | Job queue | Chunk and embed documents |
| `process-jobs` | Cron/scheduler | Claim and route pending jobs |
| `escalate-conversation` | Frontend (JWT) | Escalate to human agents |
| `resolve-conversation` | Frontend (JWT) | Resolve conversations |
| `reopen-conversation` | Frontend (JWT) | Reopen resolved conversations |
| `test-channel-connection` | Frontend (JWT) | Test provider connectivity |

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
│   ├── functions/                # 14 serverless function entrypoints
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
├── middleware.ts                  # Next.js auth middleware
├── vitest.config.ts              # Test configuration
└── .env.example                  # Environment variable template
```

## License

Private — not for redistribution.
