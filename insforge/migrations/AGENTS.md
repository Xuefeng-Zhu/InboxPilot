# insforge/migrations/ — SQL Migrations

## OVERVIEW
**25 SQL files.** Apply numbered migrations in order while preserving the two timestamped job-trigger migrations in their documented position. Append-only — never edit a past migration.

## THE 25 MIGRATIONS
| # | File | Purpose |
|---|---|---|
| 001 | `001_initial_schema.sql` | 17 core tables + indexes + constraints (enables `pgcrypto`, `vector`) |
| 002 | `002_rpc_functions.sql` | `match_knowledge_chunks`, `claim_support_jobs` (initial version — superseded by 008) |
| 003 | `003_rls_policies.sql` | `public.user_org_ids()` helper + all RLS policies for tables 001 |
| 004 | `004_create_organization_onboarding_rpc.sql` | `create_organization_with_owner` (org + first member in one transaction) |
| 005 | `005_webchat.sql` | `webchat_widgets`, `webchat_threads` tables + their RLS policies |
| 006 | `006_backfill_conversation_activity.sql` | Backfill `last_message_at` / `last_customer_message_at` |
| 007 | `007_ai_decision_chunks.sql` | `ai_decision_chunks` table + `ai_decision_chunks_validate()` trigger + `insert_ai_decision_chunks()` RPC |
| 008 | `008_claim_failed_jobs.sql` | `claim_support_jobs(claim_limit int DEFAULT 5)` — current version with bounded claim |
| 009 | `009_org_sla_thresholds.sql` | Adds `organizations.sla_thresholds jsonb`; `conversations.last_message_direction text`; backfill from `messages.direction` |
| 010 | `010_drop_pending_status.sql` | Drops `'pending'` from `conversations.status` CHECK (was in 001 but never assigned by code) |
| 011 | `011_ai_settings_embedding_model.sql` | Adds the independent knowledge embedding model setting |
| 012 | `012_replace_knowledge_chunks.sql` | Adds transactional replacement of a document's knowledge chunks |
| 013 | `013_webchat_realtime_widget_channel.sql` | Registers org/widget realtime channels and adds the server-only publish RPC |
| — | `20260615074718_trigger-process-jobs-on-insert.sql` | Adds the superseded HTTP job trigger |
| — | `20260615080500_drop-broken-trigger.sql` | Removes the unreliable HTTP job trigger |
| 014 | `014_role_aware_rls_and_knowledge_storage.sql` | Adds role-aware RLS, safe grants, file keys, and organization-scoped storage policies |
| 015 | `015_bind_knowledge_jobs_to_documents.sql` | Binds browser-enqueued knowledge jobs to documents in the same organization |
| 016 | `016_job_and_ai_decision_idempotency.sql` | Adds retry-safe job/decision, claim-lease, knowledge-revision, and audit-repair guards |
| 017 | `017_lock_down_legacy_webchat_access.sql` | Removes orphan public webchat policies/grants and the legacy auth-debug helper |
| 018 | `018_atomic_ai_source_turns.sql` | Adds transactionally maintained latest-turn markers and source-bound AI transitions |
| 019 | `019_restrict_ai_decision_writes.sql` | Makes AI decisions browser-read-only and reserves mutations for trusted server paths |
| 020 | `020_bind_pending_ai_drafts.sql` | Binds approval/regeneration to an immutable pending decision and owner-guards dispatch cleanup |
| 021 | `021_monotonic_delivery_status.sql` | Atomically advances delivery snapshots and preserves terminal outcomes |
| 022 | `022_atomic_ai_decision_finalization.sql` | Atomically inserts AI decisions and publishes their guarded terminal conversation state |
| 023 | `023_secure_realtime_channels.sql` | Restricts org/widget realtime subscriptions and browser publishing |

## THE 20 APPLICATION TABLES
1. `organizations` 2. `organization_members` 3. `contacts` 4. `conversations` 5. `messages` 6. `sms_provider_accounts` 7. `sms_phone_numbers` 8. `sms_delivery_events` 9. `email_provider_accounts` 10. `email_addresses` 11. `email_delivery_events` 12. `ai_settings` 13. `ai_decisions` 14. `knowledge_documents` 15. `knowledge_chunks` 16. `support_jobs` 17. `audit_logs` 18. `webchat_widgets` 19. `webchat_threads` 20. `ai_decision_chunks`

## RPC FUNCTIONS (20 total; 15 application-callable)
| RPC | Defined in | Called by |
|---|---|---|
| `public.user_org_ids()` | 003 | Inside RLS policies (helper, not client-facing) |
| `public.is_valid_widget_realtime_channel(text, text)` | 023 | Validates visitor widget subscription channels inside RLS (helper, not client-facing) |
| `match_knowledge_chunks(...)` | 002 | `KnowledgeRepository` (vector similarity search for RAG) |
| `claim_support_jobs(claim_limit int DEFAULT 5)` | 016 (current) | `PostgresJobQueue.claim()`; quarantines expired claims before claiming new work |
| `create_organization_with_owner(...)` | 004 | Onboarding flow (`lib/onboarding.ts`) |
| `ai_decision_chunks_validate()` | 007 | `BEFORE INSERT` trigger on `ai_decision_chunks` |
| `insert_ai_decision_chunks(...)` | 007 | `AiDecisionRepository` (atomic write of validated decision chunks) |
| `replace_knowledge_chunks(...)` | 012 | `KnowledgeRepository` (atomic chunk replacement) |
| `publish_realtime_message(...)` | 013 | Trusted server routes/functions (realtime broadcast) |
| `replace_knowledge_chunks_if_revision(...)` | 016 | `KnowledgeRepository` (revision-guarded atomic chunk replacement) |
| `ensure_message_received_audit(...)` | 016 | `AuditLogRepository` (concurrency-safe inbound audit repair) |
| `transition_ai_source_turn(...)` | 018 | `ConversationRepository` and regeneration/worker dispatch guards |
| `clear_stale_pending_ai_draft()` | 020 | Conversation trigger helper (not client-facing) |
| `publish_inserted_ai_draft()` | 020 | AI-decision insert trigger helper (not client-facing) |
| `claim_pending_ai_draft(...)` | 020 | Approved-draft route atomic provider-dispatch claim |
| `restore_pending_ai_draft(...)` | 020 | Approved-draft retry-safe provider failure recovery |
| `finish_pending_ai_draft(...)` | 020 | Owner-guarded post-dispatch cleanup |
| `enqueue_regenerate_ai_draft(...)` | 020 | Atomic pending-draft claim and regeneration-job enqueue |
| `advance_message_delivery_status(...)` | 021 | Atomic monotonic SMS/email delivery snapshot advancement |
| `finalize_ai_turn_with_decision(...)` | 022 | `AiDecisionRepository` (atomic decision insert and terminal source-turn publication) |

## RLS PATTERN
- **Policy naming: `{table}_{action}`** where action ∈ {`select`, `insert`, `update`, `delete`}.
- **Helper expressions:** `auth.uid()` + `public.user_org_ids()`.
- **Tenant-isolation predicate (recurring):** `id IN (SELECT user_org_ids())` for org-scoped tables, `organization_id IN (SELECT user_org_ids())` for org-owned rows.
- **`audit_logs` is append-only** — only INSERT and SELECT policies, no UPDATE or DELETE.
- **`organizations.insert` uses `WITH CHECK (true)`** — any authed user can create an org (membership is created in the same transaction by the app).

## WHERE TO LOOK
- **Add a new table** → new migration file (`009_…`). Include CREATE TABLE, indexes, FKs, and (optionally) RLS in the same file. Add the matching repository in `packages/support-core/src/repositories/`.
- **Add an RPC** → new migration file. `CREATE OR REPLACE FUNCTION` is fine if the new signature doesn't collide.
- **Change a table** → **new migration file** that ALTERs. Never edit the past file.
- **Add RLS for a new table** → in the same migration as the CREATE TABLE. Follow the `{table}_{action}` naming.

## CONVENTIONS
- **`CREATE EXTENSION IF NOT EXISTS`** at the top of any migration that uses `pgcrypto` or `vector`.
- **Defaults:** UUIDs via `gen_random_uuid()` (pgcrypto), timestamps via `now()`.
- **Check constraints on enum-like text columns** (`CHECK (role IN ('owner', 'admin', 'agent', 'viewer'))`).
- **Tenant FK:** every org-scoped table has `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`.
- **All `audit_logs.action` strings are documented** in `docs/reference/audit.md`. Add new actions there when introducing them.

## ANTI-PATTERNS
- Editing a past migration (append a new one — old DBs may have applied the old version).
- Bypassing RLS from migrations (use `INSFORGE_SERVICE_ROLE_KEY` at runtime, not in SQL).
- Skipping the `{table}_{action}` naming convention for RLS policies.
- Hardcoding tenant IDs in data (always pull from `auth.uid()` + `user_org_ids()`).
- Adding a table without a matching `*Repository` class in support-core.
- Removing `audit_logs` policies or adding UPDATE/DELETE on it (breaks the append-only contract).

## UNIQUE
- **Migration count is 25.** This includes `001` through `023` plus two timestamped job-trigger migrations.
- **Table count is 20, not 19** — the 20th is `ai_decision_chunks` (007). `docs/reference/database.md` is stale.
- **Claim RPC compatibility is handled in code.** Migration 016 replaces the integer signature with the current `claim_limit` implementation; `PostgresJobQueue` still retries the historical `max_count` named argument for older deployed databases.
- **`user_org_ids()` is `STABLE SECURITY DEFINER`** — the canonical tenant-isolation primitive.
