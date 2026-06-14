# insforge/migrations/ — SQL Migrations

## OVERVIEW
**10 SQL files** (NOT 5 — `docs/README.md` is stale). Applied in numeric order. Append-only — never edit a past migration. New ones: `006` (activity backfill), `007` (ai_decision_chunks), `008` (replaces `claim_support_jobs` from 002), `009` (org SLA thresholds), `010` (drop pending status).

## THE 10 MIGRATIONS
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

## THE 20 TABLES (8 from 001+005, +2 from 005, +1 from 007)
1. `organizations` 2. `organization_members` 3. `contacts` 4. `conversations` 5. `messages` 6. `sms_provider_accounts` 7. `sms_phone_numbers` 8. `sms_delivery_events` 9. `email_provider_accounts` 10. `email_addresses` 11. `email_delivery_events` 12. `ai_settings` 13. `ai_decisions` 14. `knowledge_documents` 15. `knowledge_chunks` 16. `support_jobs` 17. `audit_logs` 18. `webchat_widgets` 19. `webchat_threads` 20. `ai_decision_chunks`

## RPC FUNCTIONS (6 total)
| RPC | Defined in | Called by |
|---|---|---|
| `public.user_org_ids()` | 003 | Inside RLS policies (helper, not client-facing) |
| `match_knowledge_chunks(...)` | 002 | `KnowledgeRepository` (vector similarity search for RAG) |
| `claim_support_jobs(claim_limit int DEFAULT 5)` | 008 (current) | `PostgresJobQueue.claim()` (the 002 version still exists; dispatch by arity) |
| `create_organization_with_owner(...)` | 004 | Onboarding flow (`lib/onboarding.ts`) |
| `ai_decision_chunks_validate()` | 007 | `BEFORE INSERT` trigger on `ai_decision_chunks` |
| `insert_ai_decision_chunks(...)` | 007 | `AiDecisionRepository` (atomic write of validated decision chunks) |

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
- **Migration count is 10, not 5** — `docs/README.md` is stale. The new ones: 006, 007, 008, 009, 010.
- **Table count is 20, not 19** — the 20th is `ai_decision_chunks` (007). `docs/reference/database.md` is stale.
- **Two `claim_support_jobs` coexist** (002 + 008). Dispatch is by arity, so old callers still work, but a cleanup migration renaming the old one might be worth doing.
- **`user_org_ids()` is `STABLE SECURITY DEFINER`** — the canonical tenant-isolation primitive.
