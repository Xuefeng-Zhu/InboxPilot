---
description: Support-core portable business logic – interfaces, repositories, services, adapters
globs: packages/support-core/**
alwaysApply: true
---

# packages/support-core – Portable Business Logic

## OVERVIEW
ALL portable business logic for InboxPilot. Zero dependency on `@insforge/sdk` – external deps injected via TypeScript interfaces at the composition root.

## STRUCTURE
```
src/
  interfaces/   – 10+ contract interfaces (DatabaseClient, JobQueue, AiClient, SmsProviderAdapter, …)
  repositories/ – 15 data access classes (each takes DatabaseClient via constructor). The 16th data-access role is PostgresJobQueue, which lives in `services/` (it implements the `JobQueue` interface and carries orchestration logic — idempotency, backoff, dead-lettering — not table CRUD).
  services/     – 8 business logic services + 8 escalation rules + RBAC + Zod AI-decision parser
  adapters/     – Provider impls (Twilio, Telnyx, Postmark, mocks, stubs)
  types/        – Entity types, enums, I/O shapes
  utils/        – Normalization, chunking, content fetching
  index.ts      – Package barrel (external entrypoint)
__tests__/
  unit/         – 18 co-located unit tests (mock all interfaces)
  properties/   – 10 property-based tests (fast-check, 100+ iterations each)
  integration/  – 6 integration stubs (require real DB)
```

## INTERFACES
Every external system has a typed contract in `src/interfaces/`. Implementations injected at entrypoint.

| Interface | Purpose | Key Methods |
|-----------|---------|-------------|
| `DatabaseClient` | Generic DB read/write | getOrgBySlug, getConversation, insertMessage, updateConversation, runInTransaction |
| `JobQueue` | Async job processing | enqueue, claimNext, complete, fail, scheduleRetry |
| `AiClient` | LLM interaction | generateReply, generateDraft, shouldEscalate, summarize |
| `SmsProviderAdapter` | SMS send | send(to, body, options) |
| `EmailProviderAdapter` | Email send | send(to, subject, body, options) |
| `RealtimePublisher` | Live UI updates | publish(channel, event, payload) |
| `ProviderRegistry` | Multi-tenant provider lookup | getActiveSmsProvider, getActiveEmailProvider |
| `EscalationEngine` | Rule-based escalation | evaluate(message, context) → EscalationResult |

## SERVICES
Orchestration classes with constructor-injected deps. Never create deps internally.

| Service | Role |
|---------|------|
| `InboundMessageService` | Normalize → deduplicate → conversation → escalation → AI decision → enqueue |
| `OutboundMessageService` | Validate → create → send via provider → delivery event |
| `AiAgentService` | Select mode (draft/auto-reply/human) → call AiClient → store decision → enqueue |
| `KnowledgeIngestionService` | Chunk → embed via AiClient → store in pgvector |
| `WebchatThreadService` | Create/close webchat threads, link to widget config |
| `PostgresJobQueue` | Implements JobQueue – claim/complete/fail/retry + backoff + dead-letter |
| `OrganizationService` | Onboarding, slug validation, org-scoped lookups |
| `EscalationRules` (8 rule classes in `services/escalation-rules.ts`) | Pre-AI rule set (HumanRequest, ProfanityAnger, SensitiveTopic, SafetyConcern, MissingKnowledge, LowConfidence, RepeatedFailure, Keyword) + `createDefaultEscalationEngine()` factory. First match wins. |
| `rbac.ts` (service util) | Pure permission matrix: owner (all) / admin (all except `delete_org`) / agent (view+reply) / viewer (read-only). Exports `hasPermission`, `checkPermission`, `ROLE_PERMISSIONS`. |
| `ai-decision-parser.ts` (service util) | Zod schema (`AiDecisionSchema`) + `parseAiDecision()` discriminated parser. **Only file in the package using Zod** (and Zod is the only npm runtime dep besides the forbidden `@insforge/*`). |

## REPOSITORIES
**15 classes** (not 16 — the 16th data-access role is `PostgresJobQueue` in `services/`). Consistent pattern: `DatabaseClient` in constructor, async methods, typed returns, no raw SQL.

```typescript
class XxxRepository {
  constructor(private db: DatabaseClient) {}
  async findById(id: string): Promise<Xxx | null> { ... }
  async findByOrgId(orgId: string): Promise<Xxx[]> { ... }
  async create(input: CreateXxxInput): Promise<Xxx> { ... }
  async update(id: string, input: UpdateXxxInput): Promise<Xxx> { ... }
}
```

## ADAPTERS

| Adapter | Interface | Notes |
|---------|-----------|-------|
| TwilioSmsAdapter / TelnyxSmsAdapter | SmsProviderAdapter | Real provider APIs. **Telnyx `verifyWebhook` is a stub** (header presence only, ed25519 marked TODO). |
| MockSmsAdapter / `sms-stubs.ts` (4 stubs) | SmsProviderAdapter | `MockSmsAdapter` is in-memory with deterministic `mock_sms_N` IDs, used as a real test double (not mocked). The 4 stubs (Bandwidth, Vonage, Plivo, MessageBird) throw "not implemented" by design. |
| PostmarkEmailAdapter | EmailProviderAdapter | Real Postmark API (`X-Postmark-Server-Token` verification, timing-safe). |
| MockEmailAdapter / `email-stubs.ts` (4 stubs) | EmailProviderAdapter | Same pattern as SMS mocks. Stubs: Mailgun, Resend, AwsSes, InsForge (note: stub label, not an import). |

## TESTING
- **Unit** (`__tests__/unit/`): Vitest describe/it, mock all interfaces. 18 files.
- **Property** (`__tests__/properties/`): fast-check, `numRuns: 100` (one outlier: `__tests__/properties/design-tokens.property.test.ts:82` uses 50). **11 files** covering idempotence, round-trip, state machine, RBAC, dedup, auto-reply gating, escalation triggers, AI decision JSON, audit log immutability, knowledge similarity, normalization.
- **Integration** (`__tests__/integration/`): Require real DB. `--runInBand`. 6 files.

## CRITICAL CONVENTIONS
1. NO `@insforge/sdk` imports. EVER. All InsForge access via DatabaseClient interface.
2. Constructor injection only – never instantiate deps internally.
3. Return typed entities (from `types/`), never raw DB rows.
4. Business errors = custom Error subclasses (not generic `Error`).
5. Every public method needs a unit test. Complex branches need property tests.
6. Audit logging at service layer, not repository layer.
7. Escalation rules run BEFORE AI – if triggers, AI never called.
8. Barrel import: always `src/index.ts`, never internal paths.
9. Mock/stub adapters sufficient for unit tests – no real credentials needed.

## ANTI-PATTERNS
- `import { createClient } from '@insforge/sdk'` inside support-core – breaks portability.
- Direct `new SmsProviderAdapter()` – use ProviderRegistry for multi-tenant resolution.
- Skipping deduplication in InboundMessageService → duplicate conversations.
- Returning raw DB rows → couples callers to DB schema.
- Bypassing services and calling repos from entrypoints → loses audit + orchestration.
- Adding package deps without an interface → breaks DI/portability.
- `as any`, `@ts-ignore`, `@ts-expect-error` – never suppress types.
- Empty catch blocks – always handle or re-throw.

## KNOWN ISSUES / GOTCHAS
- **Repository count mismatch:** docs say "16", actual is **15**. The 16th data-access role is `PostgresJobQueue` in `services/`. Update the README if you touch this.
- **`AuditLogRepository` is append-only** — no `update`/`delete` methods. This is enforced by absence, not by RLS.
- **`PostgresJobQueue.enqueue` is idempotent** by `(jobType, payload subset)` per the `IDEMPOTENCY_KEYS` map — durable against double-processing in serverless contexts.
- **`LowConfidenceRule` is post-LLM only** — it has no `evaluate()` effect in the engine chain; the post-LLM check is in `AiAgentService.evaluateConfidence()`.
- **The 8 provider stubs throw "not implemented" by design** — the type system stays satisfied while the registry lists future providers. Don't remove them; replace with real impl when building.
- **`AuditLogRepository` doesn't exist as a method called `delete()` or `update()`** because there shouldn't be any.
- **Row mapping is hand-rolled** (`toEntity()` / `toRow()` private fns per repo). No ORM, no `class-transformer`. Snake_case ↔ camelCase.
- **`packages/support-core/package.json` exports `./src/index.ts` directly** (no build step). Consumers import via the `@support-core/*` path alias.
