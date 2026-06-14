# packages/support-core/src/services/ — Business Logic

## OVERVIEW
Service layer — orchestrates business logic using repositories + interface-typed externals. **No direct I/O**; all DB / AI / provider calls go through repos or interfaces.

## THE 8 SERVICES
| Service | What it does | Constructor deps (in order) |
|---|---|---|
| `InboundMessageService` | Inbound flow: dedup → find-or-create contact/conv → insert message → bump `lastMessageAt` → enqueue `process_ai_message` → audit | `ContactRepo, ConversationRepo, MessageRepo, JobQueue, AuditLogRepo` |
| `OutboundMessageService` | Send reply: load conv/contact → pick default number/address → call `ProviderRegistry` adapter → persist outbound message → publish realtime (webchat only) → audit | `ConversationRepo, ContactRepo, MessageRepo, ProviderRegistry, SmsProviderAccountRepo, EmailProviderAccountRepo, AuditLogRepo, WebchatThreadRepo?, RealtimePublisher?` |
| `AiAgentService` | AI pipeline: load settings → embed → `matchChunks` → **escalation engine first** → if escalated, persist + audit; else LLM → Zod-parse → handle `draft_only`/`auto_reply`/low-confidence → enqueue `send_outbound_message` if auto-sent → enqueue `record_chunk_refs` → audit | `ConversationRepo, MessageRepo, KnowledgeRepo, AiSettingsRepo, AiDecisionRepo, EscalationEngine, AiClient, JobQueue, AuditLogRepo` |
| `KnowledgeIngestionService` | RAG: load doc → `processing` → optional `FileContentFetcher` → `splitIntoChunks` → embed each → insert chunks → `ready` (or `failed` + cleanup on error) → audit | `KnowledgeRepo, AiClient, AuditLogRepo, FileContentFetcher?` |
| `WebchatThreadService` | Webchat lifecycle: `initThread` (find-or-create contact, create conv+thread, mint JTI) → `identifyThread` (update contact, rotate JTI) → audit | `ContactRepo, ConversationRepo, WebchatWidgetRepo, WebchatThreadRepo, AuditLogRepo` |
| `OrganizationService` | Org/member admin: `createOrganization` (auto-owner) → `inviteMember` (no owner invites) → `changeMemberRole` (single-owner invariant) → `removeMember` (last-owner guard) → audit | `OrganizationRepo, MemberRepo, AuditLogRepo` |
| `PostgresJobQueue` | Implements `JobQueue` against `support_jobs`: idempotent enqueue, atomic `claim` via `claim_support_jobs` RPC, exponential backoff (2^n sec), dead-letter at `max_attempts` | `DatabaseClient` |
| (utility) `rbac.ts` | Pure permission matrix: owner (all) / admin (all except `delete_org`) / agent (view+reply) / viewer (read-only). Exports `hasPermission`, `checkPermission`, `ROLE_PERMISSIONS`, `ALL_PERMISSIONS`, `Permission` | (none — pure) |
| (utility) `ai-decision-parser.ts` | Zod schema (`AiDecisionSchema`) + `parseAiDecision()` discriminated-result parser. **Only Zod user in the package.** | (none — pure) |
| (utility) `escalation-rules.ts` | 8 deterministic rule classes + `createDefaultEscalationEngine()` factory wiring them in evaluation order | (none — pure rules, factory wires `EscalationEngine`) |

## WHERE TO LOOK
- **Add a new escalation rule** → `escalation-rules.ts` + register in `createDefaultEscalationEngine()`.
- **Add a new message pipeline step** → check `InboundMessageService` first, then `AiAgentService` (LLM path), then `OutboundMessageService` (delivery).
- **Tune AI confidence thresholds / chunk counts** → `AiAgentService` (the `lowConfidence` branch is the only post-LLM escalation hook).
- **Adjust job-queue backoff / dead-letter policy** → `PostgresJobQueue` constants near the top.
- **Realtime publish** → `OutboundMessageService` only (webchat path). For org-wide events, the Deno `process-jobs` function publishes to `org:${orgId}` channel.

## CONVENTIONS
- **DI: pure constructor injection of interface types.** No service locator.
- **All significant actions write to `audit_logs`** via `AuditLogRepository`. Pattern: `auditLogRepo.insert({ orgId, actorType, actorId, action, resourceType, resourceId, metadata })`.
- **Error handling: throw `new Error(msg)` on repository failures**; services propagate. No custom error class hierarchy — only `Error`.
- **Optional deps with `?`** keep services usable in tests where webchat/realtime aren't wired.

## UNIQUE
- **Escalation ALWAYS runs before the LLM.** If a rule matches, the AI never sees the message. This is the "deterministic escalation before AI" guarantee.
- **PostgresJobQueue is technically a service (not a repo) because it carries orchestration logic** (idempotency keys, backoff math, dead-lettering). The repository counterpart is `JobRepository` (low-level CRUD on `support_jobs`).
- **`LowConfidenceRule` is post-LLM only** — it has no `evaluate()` effect in `createDefaultEscalationEngine()`'s chain; the engine is for pre-LLM gating. The post-LLM check is in `AiAgentService`.
- **`ai-decision-parser.ts` is the only file using Zod**, and Zod is the only npm runtime dep in the package (besides the forbidden `@insforge/*`).
