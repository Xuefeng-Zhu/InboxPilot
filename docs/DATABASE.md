# InboxPilot — Database Reference

## Overview

InboxPilot uses PostgreSQL with the `pgcrypto` and `vector` (pgvector) extensions. The schema consists of 17 tables organized into logical groups, with Row Level Security enforcing multi-tenant isolation.

### Migration Files

| File | Purpose |
|------|---------|
| `insforge/migrations/001_initial_schema.sql` | All 17 tables, indexes, constraints, extensions |
| `insforge/migrations/002_rpc_functions.sql` | `match_knowledge_chunks` and `claim_support_jobs` RPC functions |
| `insforge/migrations/003_rls_policies.sql` | RLS policies for all tables, helper functions, credential column revocations |
| `insforge/seed.sql` | Idempotent seed data for local development |

Apply migrations in order via the InsForge SQL editor or migrations API.

---

## Tables

### 1. organizations

Top-level tenant entity. Every other table references an organization directly or indirectly.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Organization ID |
| `name` | `text` | NOT NULL | Display name |
| `slug` | `text` | NOT NULL, UNIQUE | URL-safe identifier |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Extensible metadata |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last update timestamp |

---

### 2. organization_members

Maps users to organizations with a role. A user can belong to multiple organizations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Member record ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Parent organization |
| `user_id` | `text` | NOT NULL | InsForge auth user ID |
| `role` | `text` | NOT NULL, CHECK `('owner','admin','agent','viewer')` | RBAC role |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last update timestamp |

**Unique constraint**: `(organization_id, user_id)` — a user can only have one role per org.

---

### 3. contacts

External people who communicate with the organization via SMS or email.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Contact ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `name` | `text` | nullable | Display name |
| `email` | `text` | nullable | Email address |
| `phone` | `text` | nullable | Phone number (E.164) |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Extensible metadata |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

**Indexes**:
- `idx_contacts_organization_id` — Fast lookup by org
- `idx_contacts_org_phone` — Partial index (WHERE phone IS NOT NULL) for phone-based contact lookup
- `idx_contacts_org_email` — Partial index (WHERE email IS NOT NULL) for email-based contact lookup

---

### 4. conversations

A conversation thread between a contact and the organization on a specific channel.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Conversation ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `contact_id` | `uuid` | NOT NULL, FK → contacts | Associated contact |
| `channel` | `text` | NOT NULL, CHECK `('sms','email')` | Communication channel |
| `status` | `text` | NOT NULL, default `'open'`, CHECK `('open','pending','resolved','escalated')` | Conversation state |
| `ai_state` | `text` | NOT NULL, default `'idle'`, CHECK `('idle','thinking','drafted','auto_replied','needs_human','failed')` | AI processing state |
| `subject` | `text` | nullable | Email subject line |
| `assigned_to` | `uuid` | nullable, FK → organization_members | Assigned agent |
| `last_message_at` | `timestamptz` | nullable | Timestamp of most recent message |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Extensible metadata |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

**Indexes**:
- `idx_conversations_org_status` — Filter conversations by org + status
- `idx_conversations_contact_id` — Lookup conversations for a contact
- `idx_conversations_org_last_message` — Sort inbox by most recent message (DESC)

**State Machine** — Valid `status` transitions:
- `open` → `pending`, `resolved`, `escalated`
- `pending` → `open`, `resolved`, `escalated`
- `escalated` → `open`, `resolved`
- `resolved` → `open` (reopen)

---

### 5. messages

Individual messages within a conversation.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Message ID |
| `conversation_id` | `uuid` | NOT NULL, FK → conversations | Parent conversation |
| `sender_type` | `text` | NOT NULL, CHECK `('contact','user','ai','system')` | Who sent the message |
| `sender_id` | `text` | nullable | User ID or contact ID of sender |
| `direction` | `text` | NOT NULL, CHECK `('inbound','outbound')` | Message direction |
| `channel` | `text` | NOT NULL, CHECK `('sms','email')` | Channel used |
| `body` | `text` | NOT NULL | Message body text |
| `subject` | `text` | nullable | Email subject |
| `raw_payload` | `jsonb` | NOT NULL, default `'{}'` | Original webhook payload |
| `provider` | `text` | nullable | Provider name (twilio, postmark, etc.) |
| `provider_account_id` | `uuid` | nullable | Provider account used |
| `external_message_id` | `text` | nullable | Provider's message ID |
| `delivery_status` | `text` | default `'pending'`, CHECK `('pending','queued','sent','delivered','failed','bounced')` | Delivery tracking |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

**Indexes**:
- `idx_messages_provider_external_id` — **Partial unique index** on `(provider, external_message_id)` WHERE both are NOT NULL. Prevents duplicate message ingestion from the same provider.

---

### 6. sms_provider_accounts

SMS provider credentials and configuration per organization.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Account ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `provider` | `text` | NOT NULL | Provider name (twilio, telnyx, etc.) |
| `label` | `text` | NOT NULL | Human-readable label |
| `credentials_secret_id` | `text` | NOT NULL | Reference to stored credentials (column-level SELECT revoked from client roles) |
| `is_active` | `boolean` | NOT NULL, default `true` | Whether the account is active |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Provider-specific config |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

---

### 7. sms_phone_numbers

Phone numbers associated with SMS provider accounts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Record ID |
| `provider_account_id` | `uuid` | NOT NULL, FK → sms_provider_accounts | Parent account |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `phone_number` | `text` | NOT NULL | Phone number (E.164) |
| `is_default` | `boolean` | NOT NULL, default `false` | Default number for outbound |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |

---

### 8. sms_delivery_events

Delivery status events for SMS messages.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Event ID |
| `message_id` | `uuid` | NOT NULL, FK → messages | Associated message |
| `provider_account_id` | `uuid` | nullable, FK → sms_provider_accounts | Provider account |
| `status` | `text` | NOT NULL | Delivery status string |
| `error_code` | `text` | nullable | Provider error code |
| `error_message` | `text` | nullable | Provider error message |
| `raw_payload` | `jsonb` | NOT NULL, default `'{}'` | Raw webhook payload |
| `created_at` | `timestamptz` | NOT NULL | Event timestamp |

---

### 9. email_provider_accounts

Email provider credentials and configuration per organization.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Account ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `provider` | `text` | NOT NULL | Provider name (postmark, etc.) |
| `label` | `text` | NOT NULL | Human-readable label |
| `credentials_secret_id` | `text` | NOT NULL | Reference to stored credentials (column-level SELECT revoked) |
| `is_active` | `boolean` | NOT NULL, default `true` | Whether the account is active |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Provider-specific config |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

---

### 10. email_addresses

Email addresses associated with email provider accounts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Record ID |
| `provider_account_id` | `uuid` | NOT NULL, FK → email_provider_accounts | Parent account |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `email_address` | `text` | NOT NULL | Email address |
| `is_default` | `boolean` | NOT NULL, default `false` | Default address for outbound |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |

---

### 11. email_delivery_events

Delivery status events for email messages.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Event ID |
| `message_id` | `uuid` | NOT NULL, FK → messages | Associated message |
| `provider_account_id` | `uuid` | nullable, FK → email_provider_accounts | Provider account |
| `status` | `text` | NOT NULL | Delivery status string |
| `error_code` | `text` | nullable | Provider error code |
| `error_message` | `text` | nullable | Provider error message |
| `raw_payload` | `jsonb` | NOT NULL, default `'{}'` | Raw webhook payload |
| `created_at` | `timestamptz` | NOT NULL | Event timestamp |

---

### 12. ai_settings

Per-organization AI configuration. One row per organization.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Settings ID |
| `organization_id` | `uuid` | NOT NULL, UNIQUE, FK → organizations | Owning organization |
| `ai_mode` | `text` | NOT NULL, default `'draft_only'`, CHECK `('off','draft_only','auto_reply')` | AI operating mode |
| `confidence_threshold` | `numeric(3,2)` | NOT NULL, default `0.75` | Minimum confidence for auto-reply |
| `context_window_size` | `integer` | NOT NULL, default `20` | Max messages to include in LLM context |
| `max_consecutive_failures` | `integer` | NOT NULL, default `3` | Failures before escalation |
| `knowledge_similarity_threshold` | `numeric(3,2)` | NOT NULL, default `0.70` | Minimum cosine similarity for knowledge matching |
| `escalation_keywords` | `text[]` | NOT NULL, default `'{}'` | Custom escalation trigger words |
| `system_prompt` | `text` | nullable | Custom system prompt for the LLM |
| `model` | `text` | NOT NULL, default `'openai/gpt-4o-mini'` | LLM model identifier |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

---

### 13. ai_decisions

Records of AI analysis decisions for each processed message.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Decision ID |
| `conversation_id` | `uuid` | NOT NULL, FK → conversations | Associated conversation |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `message_id` | `uuid` | nullable, FK → messages | Triggering message |
| `decision_type` | `text` | NOT NULL, CHECK `('respond','escalate','clarify')` | AI decision type |
| `confidence` | `numeric(3,2)` | NOT NULL | Confidence score (0.00–1.00) |
| `reasoning_summary` | `text` | nullable | AI's reasoning explanation |
| `response_text` | `text` | nullable | Drafted response text |
| `tags` | `text[]` | NOT NULL, default `'{}'` | Classification tags |
| `requires_human` | `boolean` | NOT NULL, default `false` | Whether human review is needed |
| `raw_response` | `jsonb` | nullable | Full LLM response for debugging |
| `created_at` | `timestamptz` | NOT NULL | Decision timestamp |

---

### 14. knowledge_documents

Source documents uploaded to the knowledge base for RAG.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Document ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `title` | `text` | NOT NULL | Document title |
| `source_type` | `text` | NOT NULL | Source type (manual, upload, etc.) |
| `body` | `text` | NOT NULL | Full document text |
| `status` | `text` | NOT NULL, default `'pending'`, CHECK `('pending','processing','ready','failed')` | Processing status |
| `error_message` | `text` | nullable | Error details if processing failed |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |

**Indexes**:
- `idx_knowledge_documents_org_id` — Lookup documents by organization

---

### 15. knowledge_chunks

Chunked and embedded segments of knowledge documents for vector similarity search.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Chunk ID |
| `document_id` | `uuid` | NOT NULL, FK → knowledge_documents | Parent document |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `content` | `text` | NOT NULL | Chunk text content |
| `embedding` | `vector(1536)` | NOT NULL | OpenAI-compatible embedding vector |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Chunk metadata (position, etc.) |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |

**Indexes**:
- `idx_knowledge_chunks_embedding` — **HNSW index** using `vector_cosine_ops` for fast approximate nearest neighbor search

---

### 16. support_jobs

Postgres-backed job queue for async processing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Job ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `job_type` | `text` | NOT NULL | Job type identifier |
| `payload` | `jsonb` | NOT NULL, default `'{}'` | Job-specific payload data |
| `status` | `text` | NOT NULL, default `'pending'`, CHECK `('pending','claimed','completed','failed','dead')` | Job status |
| `attempts` | `integer` | NOT NULL, default `0` | Number of processing attempts |
| `max_attempts` | `integer` | NOT NULL, default `5` | Maximum attempts before dead-lettering |
| `last_error` | `text` | nullable | Error message from last failure |
| `run_after` | `timestamptz` | NOT NULL, default `now()` | Earliest time the job can be claimed |
| `created_at` | `timestamptz` | NOT NULL | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | Last update timestamp |
| `completed_at` | `timestamptz` | nullable | Completion timestamp |

**Indexes**:
- `idx_support_jobs_pending` — **Partial index** on `(status, run_after)` WHERE `status = 'pending'` for efficient job claiming

---

### 17. audit_logs

Append-only audit trail of all significant actions. RLS enforces that rows can only be inserted and selected, never updated or deleted.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Log entry ID |
| `organization_id` | `uuid` | NOT NULL, FK → organizations | Owning organization |
| `actor_id` | `text` | nullable | User ID or system identifier |
| `actor_type` | `text` | NOT NULL, CHECK `('user','system','ai')` | Type of actor |
| `action` | `text` | NOT NULL | Action name (e.g., `conversation_resolved`, `ai_draft_approved`) |
| `resource_type` | `text` | NOT NULL | Resource type (e.g., `conversation`, `ai_decision`) |
| `resource_id` | `text` | nullable | Resource identifier |
| `metadata` | `jsonb` | NOT NULL, default `'{}'` | Additional context |
| `created_at` | `timestamptz` | NOT NULL | Event timestamp |

**Indexes**:
- `idx_audit_logs_org_created` — Composite index on `(organization_id, created_at DESC)` for chronological queries

---

## Entity Relationship Overview

```
organizations ─┬─< organization_members
               ├─< contacts ─────────< conversations ─< messages
               ├─< sms_provider_accounts ─< sms_phone_numbers
               │                          ─< sms_delivery_events (via messages)
               ├─< email_provider_accounts ─< email_addresses
               │                            ─< email_delivery_events (via messages)
               ├─< ai_settings (1:1)
               ├─< ai_decisions
               ├─< knowledge_documents ─< knowledge_chunks
               ├─< support_jobs
               └─< audit_logs
```

Key relationships:
- `organizations` is the root entity. All other tables reference it directly or through a chain.
- `conversations` belongs to both an `organization` and a `contact`.
- `messages` belongs to a `conversation` (no direct org FK — org is inferred via conversation).
- Delivery events (`sms_delivery_events`, `email_delivery_events`) reference `messages` (org inferred via message → conversation).
- `ai_settings` has a 1:1 relationship with `organizations` (UNIQUE constraint on `organization_id`).
- `knowledge_chunks` belongs to both a `knowledge_document` and an `organization`.

---

## RPC Functions

### match_knowledge_chunks

Vector similarity search for RAG. Returns the top matching knowledge chunks ranked by cosine similarity.

```sql
match_knowledge_chunks(
  query_embedding vector(1536),  -- Query embedding vector
  match_org_id uuid,             -- Organization ID filter
  match_limit int DEFAULT 5,     -- Max results
  match_threshold float DEFAULT 0.7  -- Minimum similarity score
)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb, similarity float)
```

Uses the formula `1 - (embedding <=> query_embedding)` for cosine similarity, filtered by organization and threshold, ordered by similarity descending.

### claim_support_jobs

Atomically claims pending jobs for processing. Uses `SELECT FOR UPDATE SKIP LOCKED` to prevent contention between concurrent workers.

```sql
claim_support_jobs(
  claim_limit int DEFAULT 5  -- Max jobs to claim
)
RETURNS SETOF support_jobs
```

Claims jobs where `status = 'pending'` and `run_after <= now()`, ordered by `created_at ASC`.

---

## RLS Policies Summary

All 17 tables have RLS enabled. The general pattern:

| Operation | Policy |
|-----------|--------|
| SELECT | `organization_id IN (SELECT user_org_ids())` |
| INSERT | `organization_id IN (SELECT user_org_ids())` |
| UPDATE | `organization_id IN (SELECT user_org_ids())` |
| DELETE | `organization_id IN (SELECT user_org_ids())` |

**Exceptions**:
- `organizations` INSERT: `WITH CHECK (true)` — any authenticated user can create an org
- `audit_logs`: Only SELECT and INSERT policies — no UPDATE or DELETE (append-only)
- `messages`, `sms_delivery_events`, `email_delivery_events`: Join through parent tables to reach `organization_id`

**Credential protection**: Column-level `REVOKE SELECT` on `credentials_secret_id` for both `sms_provider_accounts` and `email_provider_accounts`, preventing PostgREST from returning credentials to `anon` or `authenticated` roles.

See `insforge/migrations/003_rls_policies.sql` for full policy definitions.
