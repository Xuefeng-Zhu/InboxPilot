# InboxPilot — Architecture

## System Overview

InboxPilot is a multi-tenant AI-powered customer support platform. It handles inbound and outbound communication over SMS and email, uses AI to draft and auto-reply to messages, and escalates sensitive conversations to human agents.

The platform is built on [InsForge](https://insforge.app) (a backend-as-a-service) but is designed for **portability**: all business logic lives in a standalone package (`packages/support-core/`) that never imports the InsForge SDK. External dependencies — database, AI, messaging providers — are injected via TypeScript interfaces.

### Design Principles

1. **Portability** — Business logic is backend-agnostic. Migrating to another BaaS or self-hosted Postgres requires only new interface implementations, not business logic changes.
2. **Layered architecture** — Clear separation between entrypoints, services, repositories, and adapters with strict dependency rules.
3. **Deterministic safety** — Escalation rules run before any LLM call. Sensitive conversations never reach the AI.
4. **Multi-tenancy by default** — Every table is scoped to an organization. Row Level Security enforces tenant isolation at the database level.
5. **Auditability** — All significant actions are logged to an append-only `audit_logs` table.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                         │
│  app/  (pages)    components/  (UI)    lib/  (client utilities) │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐        │
│  │ InsForge  │  │ InsForge     │  │ InsForge           │        │
│  │ Auth SDK  │  │ Database SDK │  │ Realtime (polling) │        │
│  └─────┬────┘  └──────┬───────┘  └────────┬───────────┘        │
└────────┼───────────────┼──────────────────┼─────────────────────┘
         │               │                  │
         ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     InsForge Platform                            │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Auth     │  │ PostgREST    │  │ Realtime │  │ AI Gateway │  │
│  │ (JWT)    │  │ (auto API)   │  │ (WS/REST)│  │ (OpenRouter│  │
│  └──────────┘  └──────────────┘  └──────────┘  └────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Deno Functions (14 entrypoints)              │   │
│  │  insforge/functions/                                      │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │            support-core (portable logic)            │  │   │
│  │  │  ┌───────────┐  ┌──────────────┐  ┌────────────┐   │  │   │
│  │  │  │ Services  │  │ Repositories │  │  Adapters   │   │  │   │
│  │  │  │ (business │  │ (data access │  │ (SMS/email  │   │  │   │
│  │  │  │  logic)   │  │  abstraction)│  │  providers) │   │  │   │
│  │  │  └───────────┘  └──────────────┘  └────────────┘   │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              PostgreSQL + pgvector                        │   │
│  │  17 tables · RLS policies · RPC functions · HNSW index   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         ▲                                          ▲
         │                                          │
   SMS Providers                              Email Providers
   (Twilio, Telnyx)                           (Postmark)
```

---

## Layered Architecture

| Layer | Location | Responsibility | May Import |
|-------|----------|----------------|------------|
| **Function Entrypoints** | `insforge/functions/` | HTTP request parsing, auth verification, dependency wiring, delegation to services | InsForge SDK (via `_shared/`), support-core |
| **Service Layer** | `packages/support-core/src/services/` | Business logic orchestration (inbound processing, AI pipeline, outbound sending, RBAC) | Repositories, Interfaces, Types, Utils |
| **Repository Layer** | `packages/support-core/src/repositories/` | Data access abstraction — CRUD operations on entities via `DatabaseClient` interface | Interfaces, Types |
| **Adapter Layer** | `packages/support-core/src/adapters/` | Provider-specific integrations (Twilio, Telnyx, Postmark, mocks) | Interfaces, Types |
| **Interface Layer** | `packages/support-core/src/interfaces/` | TypeScript interfaces defining contracts (`DatabaseClient`, `SmsProviderAdapter`, `JobQueue`, etc.) | Types only |
| **Type Layer** | `packages/support-core/src/types/` | Shared entity types, enums, input/output shapes | Nothing |

### Dependency Rules

- **support-core MUST NOT import `@insforge/sdk`** or any InsForge-specific code. All external dependencies are injected via interfaces defined in `packages/support-core/src/interfaces/`.
- Layers may only depend on layers below them (entrypoints → services → repositories → interfaces → types).
- Adapters depend on interfaces and types, not on services or repositories.
- The function entrypoint layer is the only place where InsForge SDK and concrete adapter wiring happens.

---

## Data Flow Diagrams

### Inbound SMS Flow

```
SMS Provider (Twilio/Telnyx)
  │
  ▼ POST webhook
┌─────────────────────────────┐
│ sms-inbound function        │
│ 1. Parse request body       │
│ 2. Get provider from header │
│ 3. Verify webhook signature │
│ 4. Normalize payload        │
│ 5. Lookup org by phone #    │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────┐
│ InboundMessageService       │
│ 1. Find/create contact      │
│ 2. Find/create conversation │
│ 3. Create message record    │
│ 4. Enqueue AI job           │
│ 5. Create audit log entry   │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────┐
│ Realtime Publisher          │
│ Broadcast new_message event │
│ on org:{orgId} channel      │
└─────────────────────────────┘
```

### AI Processing Flow

```
┌─────────────────────────────┐
│ process-jobs function       │
│ (cron/scheduled trigger)    │
│ 1. Claim pending jobs       │
│ 2. Route by job_type        │
└─────────┬───────────────────┘
          ▼ process_ai_message
┌─────────────────────────────┐
│ process-ai-job function     │
│ 1. Parse conversation/org   │
│ 2. Wire dependencies        │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────────────────────────┐
│ AiAgentService.processMessage()                  │
│                                                  │
│ 1. Load AI settings (mode, threshold, model)     │
│ 2. If mode == "off" → skip, return               │
│ 3. Set ai_state = "thinking"                     │
│ 4. Load conversation history (context window)    │
│ 5. Generate embedding for latest message         │
│ 6. Match knowledge chunks (pgvector similarity)  │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ PRE-LLM: EscalationEngine.evaluate()         │ │
│ │ Rules (in order):                            │ │
│ │  1. HumanRequestRule                         │ │
│ │  2. ProfanityAngerRule                       │ │
│ │  3. SensitiveTopicRule                       │ │
│ │  4. SafetyConcernRule                        │ │
│ │  5. MissingKnowledgeRule                     │ │
│ │  6. LowConfidenceRule (no-op pre-LLM)        │ │
│ │  7. RepeatedFailureRule                      │ │
│ │  8. KeywordRule (org-configured)             │ │
│ │                                              │ │
│ │ If any rule triggers → ESCALATE, skip LLM   │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ 7. Call LLM (OpenRouter via AI Gateway)          │
│ 8. Parse response as structured JSON             │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ POST-LLM: Mode Gating                       │ │
│ │                                              │ │
│ │ • LLM says escalate → ESCALATE              │ │
│ │ • Low confidence → ESCALATE                 │ │
│ │ • draft_only mode → store draft             │ │
│ │ • auto_reply + high confidence → send reply  │ │
│ │ • auto_reply + low confidence → store draft  │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ 9. Record AI decision                            │
│ 10. Create audit log entry                       │
└──────────────────────────────────────────────────┘
```

### Outbound Reply Flow

```
Frontend (user clicks "Send")
  │
  ▼ POST with JWT
┌─────────────────────────────┐
│ send-reply function         │
│ 1. Parse { conversationId,  │
│    body }                   │
│ 2. Verify JWT → userId      │
└─────────┬───────────────────┘
          ▼
┌─────────────────────────────────────────┐
│ OutboundMessageService.sendReply()       │
│ 1. Load conversation + contact          │
│ 2. Determine channel (sms/email)        │
│ 3. Get provider account + adapter       │
│ 4. Send via adapter (Twilio/Postmark)   │
│ 5. Create message record                │
│ 6. Update conversation.last_message_at  │
│ 7. Create audit log entry               │
└─────────┬───────────────────────────────┘
          ▼
┌─────────────────────────────┐
│ Realtime Publisher          │
│ Broadcast new_message event │
│ on org:{orgId} channel      │
└─────────────────────────────┘
```

---

## Database Schema Overview

The database consists of **17 tables** organized into logical groups. See `docs/DATABASE.md` for full column-level documentation.

| Group | Tables | Purpose |
|-------|--------|---------|
| **Organization** | `organizations`, `organization_members` | Multi-tenancy, RBAC roles |
| **Conversations** | `contacts`, `conversations`, `messages` | Core messaging data model |
| **SMS** | `sms_provider_accounts`, `sms_phone_numbers`, `sms_delivery_events` | SMS provider configuration and tracking |
| **Email** | `email_provider_accounts`, `email_addresses`, `email_delivery_events` | Email provider configuration and tracking |
| **AI** | `ai_settings`, `ai_decisions` | Per-org AI configuration and decision records |
| **Knowledge** | `knowledge_documents`, `knowledge_chunks` | RAG knowledge base with pgvector embeddings |
| **Infrastructure** | `support_jobs`, `audit_logs` | Job queue and audit trail |

### Key Indexes

- `idx_messages_provider_external_id` — Partial unique index for message deduplication (provider + external_message_id)
- `idx_knowledge_chunks_embedding` — HNSW index for fast vector cosine similarity search
- `idx_support_jobs_pending` — Partial index on pending jobs for efficient queue claiming
- `idx_conversations_org_last_message` — Composite index for inbox sorting
- `idx_audit_logs_org_created` — Composite index for audit log queries

---

## RLS Security Model

Row Level Security is enabled on all 17 tables. Every tenant-scoped table restricts access to rows matching the authenticated user's organization membership.

### How It Works

1. `auth.uid()` extracts the user ID from the JWT `sub` claim.
2. `user_org_ids()` returns the set of organization IDs the user belongs to (via `organization_members`).
3. Every RLS policy checks `organization_id IN (SELECT user_org_ids())`.
4. Tables without a direct `organization_id` (e.g., `messages`, delivery events) join through parent tables to reach the organization scope.

### Special Cases

- **audit_logs** — Append-only. Only SELECT and INSERT policies exist. No UPDATE or DELETE policies, so RLS denies those operations by default.
- **Credential columns** — `credentials_secret_id` on `sms_provider_accounts` and `email_provider_accounts` has column-level SELECT revoked from `anon` and `authenticated` roles, preventing PostgREST from ever returning credential data to clients.

See `insforge/migrations/003_rls_policies.sql` for the full policy definitions.

---

## Job Queue Design

The job queue is backed by the `support_jobs` table and the `claim_support_jobs` RPC function.

### Job Types

| Type | Purpose |
|------|---------|
| `process_ai_message` | Run AI analysis on a new inbound message |
| `process_knowledge_document` | Chunk and embed a knowledge document |
| `send_outbound_message` | Send an outbound SMS or email |
| `process_delivery_status` | Process a delivery status webhook |
| `retry_failed_jobs` | Re-enqueue failed jobs for retry |

### Claiming

The `claim_support_jobs` RPC uses `SELECT FOR UPDATE SKIP LOCKED` to atomically claim pending jobs without contention between concurrent workers. This prevents double-processing.

### Exponential Backoff

When a job fails, the `PostgresJobQueue.fail()` method:
1. Increments `attempts`
2. Calculates `run_after = now() + 2^attempts seconds`
3. Sets status back to `failed` (eligible for re-claiming after `run_after`)

### Dead-Lettering

When `attempts >= max_attempts` (default: 5), the job status is set to `dead`. Dead jobs are never re-claimed and serve as a record for debugging.

### Idempotent Enqueue

Before inserting a new job, `PostgresJobQueue.enqueue()` checks for an existing `pending` or `claimed` job with the same `job_type` and matching key payload fields. This prevents duplicate jobs from being created when the same event is processed multiple times.

Idempotency keys per job type:
- `process_ai_message` → `conversationId`, `messageId`
- `process_knowledge_document` → `documentId`
- `send_outbound_message` → `conversationId`, `messageId`
- `process_delivery_status` → `externalMessageId`
- `retry_failed_jobs` → (no keys — at most one pending)

Implementation: `packages/support-core/src/services/postgres-job-queue.ts`

---

## AI Pipeline

The AI pipeline is orchestrated by `AiAgentService` in `packages/support-core/src/services/ai-agent-service.ts`.

### Pipeline Stages

1. **Load settings** — Per-org AI configuration from `ai_settings` table (mode, model, thresholds)
2. **Mode check** — If `ai_mode == 'off'`, skip all processing
3. **Context gathering** — Load conversation history (up to `context_window_size` messages) and match knowledge chunks via pgvector similarity search
4. **Pre-LLM escalation** — `EscalationEngine` evaluates 8 deterministic rules. If any triggers, the conversation is escalated immediately without calling the LLM.
5. **LLM call** — Send conversation history + knowledge context to the LLM via the InsForge AI Gateway (OpenRouter). Response format is structured JSON.
6. **Decision parsing** — Parse the LLM response using Zod schema validation (`AiDecisionSchema`)
7. **Post-LLM checks** — Evaluate low-confidence rule against the configured threshold
8. **Mode gating** — Apply the organization's AI mode:
   - `draft_only`: Store the response as a draft for human review
   - `auto_reply`: Send automatically if confidence ≥ threshold, otherwise store as draft

### Escalation Engine

The `EscalationEngine` (`packages/support-core/src/interfaces/escalation.ts`) evaluates rules in registration order. The first rule that triggers wins.

| # | Rule | Trigger |
|---|------|---------|
| 1 | `HumanRequestRule` | Customer explicitly asks for a human agent |
| 2 | `ProfanityAngerRule` | Message contains profanity or anger indicators |
| 3 | `SensitiveTopicRule` | Legal threats, chargebacks, refunds, cancellations |
| 4 | `SafetyConcernRule` | Security breaches, medical/safety emergencies |
| 5 | `MissingKnowledgeRule` | No matching knowledge chunks found |
| 6 | `LowConfidenceRule` | Post-LLM only — confidence below threshold |
| 7 | `RepeatedFailureRule` | Consecutive AI failures exceed configured max |
| 8 | `KeywordRule` | Organization-configured escalation keywords |

Implementation: `packages/support-core/src/services/escalation-rules.ts`

---

## Provider Adapter Pattern

Provider adapters abstract SMS and email provider APIs behind a common interface.

### Interface → Registry → Concrete Adapter

```
┌──────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ SmsProviderAdapter   │     │ ProviderRegistry  │     │ TwilioSmsAdapter │
│ (interface)          │◄────│ .getSmsAdapter()  │────►│ (concrete)       │
│                      │     │ .getEmailAdapter()│     ├──────────────────┤
│ • sendSms()          │     │                   │     │ TelnyxSmsAdapter │
│ • verifyWebhook()    │     │ Map<string,       │     ├──────────────────┤
│ • parseInboundWH()   │     │   Adapter>        │     │ MockSmsAdapter   │
│ • parseStatusWH()    │     └──────────────────┘     └──────────────────┘
└──────────────────────┘
```

### SMS Adapters

| Adapter | Status | File |
|---------|--------|------|
| `MockSmsAdapter` | Complete | `adapters/mock-sms-adapter.ts` |
| `TwilioSmsAdapter` | Complete | `adapters/twilio-sms-adapter.ts` |
| `TelnyxSmsAdapter` | Complete | `adapters/telnyx-sms-adapter.ts` |
| `BandwidthSmsAdapter` | Stub | `adapters/sms-stubs.ts` |
| `VonageSmsAdapter` | Stub | `adapters/sms-stubs.ts` |
| `PlivoSmsAdapter` | Stub | `adapters/sms-stubs.ts` |
| `MessageBirdSmsAdapter` | Stub | `adapters/sms-stubs.ts` |

### Email Adapters

| Adapter | Status | File |
|---------|--------|------|
| `MockEmailAdapter` | Complete | `adapters/mock-email-adapter.ts` |
| `PostmarkEmailAdapter` | Complete | `adapters/postmark-email-adapter.ts` |
| `MailgunEmailAdapter` | Stub | `adapters/email-stubs.ts` |
| `ResendEmailAdapter` | Stub | `adapters/email-stubs.ts` |
| `AwsSesEmailAdapter` | Stub | `adapters/email-stubs.ts` |
| `InsForgeEmailAdapter` | Stub | `adapters/email-stubs.ts` |

### Wiring

Each function entrypoint creates a `ProviderRegistry`, registers the adapters it needs, and passes the registry to the service layer. The service layer never knows which concrete adapter is in use.

```typescript
// In a function entrypoint:
const registry = new ProviderRegistry();
registry.registerSmsAdapter('mock', new MockSmsAdapter());
registry.registerSmsAdapter('twilio', new TwilioSmsAdapter());

// Service layer uses the registry:
const adapter = registry.getSmsAdapter(providerName);
await adapter.sendSms({ to, from, body, providerConfig });
```

### Adding a New Provider

See `docs/DEVELOPMENT.md` for step-by-step instructions on adding a new SMS or email provider adapter.
