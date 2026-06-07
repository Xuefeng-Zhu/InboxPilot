-- 001_initial_schema.sql
-- InboxPilot AI Customer Support Platform — Initial Schema
-- Enables pgvector, creates all 17 tables, foreign keys, indexes, and constraints.

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- 1. organizations
-- =============================================================================

CREATE TABLE organizations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  slug          text        NOT NULL UNIQUE,
  metadata      jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. organization_members
-- =============================================================================

CREATE TABLE organization_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         text        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('owner', 'admin', 'agent', 'viewer')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- =============================================================================
-- 3. contacts
-- =============================================================================

CREATE TABLE contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text,
  email           text,
  phone           text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_organization_id ON contacts (organization_id);
CREATE INDEX idx_contacts_org_phone ON contacts (organization_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_contacts_org_email ON contacts (organization_id, email) WHERE email IS NOT NULL;

-- =============================================================================
-- 4. conversations
-- =============================================================================

CREATE TABLE conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel         text        NOT NULL CHECK (channel IN ('sms', 'email')),
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'escalated')),
  ai_state        text        NOT NULL DEFAULT 'idle' CHECK (ai_state IN ('idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed')),
  subject         text,
  assigned_to     uuid        REFERENCES organization_members(id),
  last_message_at timestamptz,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_org_status ON conversations (organization_id, status);
CREATE INDEX idx_conversations_contact_id ON conversations (contact_id);
CREATE INDEX idx_conversations_org_last_message ON conversations (organization_id, last_message_at DESC);

-- =============================================================================
-- 5. messages
-- =============================================================================

CREATE TABLE messages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type         text        NOT NULL CHECK (sender_type IN ('contact', 'user', 'ai', 'system')),
  sender_id           text,
  direction           text        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel             text        NOT NULL CHECK (channel IN ('sms', 'email')),
  body                text        NOT NULL,
  subject             text,
  raw_payload         jsonb       NOT NULL DEFAULT '{}',
  provider            text,
  provider_account_id uuid,
  external_message_id text,
  delivery_status     text        DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'queued', 'sent', 'delivered', 'failed', 'bounced')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index for message deduplication: only enforced when both columns are non-null
CREATE UNIQUE INDEX idx_messages_provider_external_id
  ON messages (provider, external_message_id)
  WHERE provider IS NOT NULL AND external_message_id IS NOT NULL;

-- =============================================================================
-- 6. sms_provider_accounts
-- =============================================================================

CREATE TABLE sms_provider_accounts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider              text        NOT NULL,
  label                 text        NOT NULL,
  credentials_secret_id text        NOT NULL,
  is_active             boolean     NOT NULL DEFAULT true,
  metadata              jsonb       NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 7. sms_phone_numbers
-- =============================================================================

CREATE TABLE sms_phone_numbers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid        NOT NULL REFERENCES sms_provider_accounts(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number        text        NOT NULL,
  is_default          boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 8. sms_delivery_events
-- =============================================================================

CREATE TABLE sms_delivery_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id          uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  provider_account_id uuid        REFERENCES sms_provider_accounts(id),
  status              text        NOT NULL,
  error_code          text,
  error_message       text,
  raw_payload         jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 9. email_provider_accounts
-- =============================================================================

CREATE TABLE email_provider_accounts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider              text        NOT NULL,
  label                 text        NOT NULL,
  credentials_secret_id text        NOT NULL,
  is_active             boolean     NOT NULL DEFAULT true,
  metadata              jsonb       NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 10. email_addresses
-- =============================================================================

CREATE TABLE email_addresses (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid        NOT NULL REFERENCES email_provider_accounts(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_address       text        NOT NULL,
  is_default          boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 11. email_delivery_events
-- =============================================================================

CREATE TABLE email_delivery_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id          uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  provider_account_id uuid        REFERENCES email_provider_accounts(id),
  status              text        NOT NULL,
  error_code          text,
  error_message       text,
  raw_payload         jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 12. ai_settings
-- =============================================================================

CREATE TABLE ai_settings (
  id                            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid          NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  ai_mode                       text          NOT NULL DEFAULT 'draft_only' CHECK (ai_mode IN ('off', 'draft_only', 'auto_reply')),
  confidence_threshold          numeric(3,2)  NOT NULL DEFAULT 0.75,
  context_window_size           integer       NOT NULL DEFAULT 20,
  max_consecutive_failures      integer       NOT NULL DEFAULT 3,
  knowledge_similarity_threshold numeric(3,2) NOT NULL DEFAULT 0.70,
  escalation_keywords           text[]        NOT NULL DEFAULT '{}',
  system_prompt                 text,
  model                         text          NOT NULL DEFAULT 'openai/gpt-4o-mini',
  created_at                    timestamptz   NOT NULL DEFAULT now(),
  updated_at                    timestamptz   NOT NULL DEFAULT now()
);

-- =============================================================================
-- 13. ai_decisions
-- =============================================================================

CREATE TABLE ai_decisions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id        uuid          REFERENCES messages(id),
  decision_type     text          NOT NULL CHECK (decision_type IN ('respond', 'escalate', 'clarify')),
  confidence        numeric(3,2)  NOT NULL,
  reasoning_summary text,
  response_text     text,
  tags              text[]        NOT NULL DEFAULT '{}',
  requires_human    boolean       NOT NULL DEFAULT false,
  raw_response      jsonb,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- =============================================================================
-- 14. knowledge_documents
-- =============================================================================

CREATE TABLE knowledge_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  source_type     text        NOT NULL,
  body            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_documents_org_id ON knowledge_documents (organization_id);

-- =============================================================================
-- 15. knowledge_chunks
-- =============================================================================

CREATE TABLE knowledge_chunks (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid          NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content         text          NOT NULL,
  embedding       vector(1536)  NOT NULL,
  metadata        jsonb         NOT NULL DEFAULT '{}',
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- HNSW index for fast vector cosine similarity search
CREATE INDEX idx_knowledge_chunks_embedding
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

-- =============================================================================
-- 16. support_jobs
-- =============================================================================

CREATE TABLE support_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type        text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'dead')),
  attempts        integer     NOT NULL DEFAULT 0,
  max_attempts    integer     NOT NULL DEFAULT 5,
  last_error      text,
  run_after       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- Partial index for efficient job queue claiming: only pending jobs
CREATE INDEX idx_support_jobs_pending
  ON support_jobs (status, run_after)
  WHERE status = 'pending';

-- =============================================================================
-- 17. audit_logs
-- =============================================================================

CREATE TABLE audit_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        text,
  actor_type      text        NOT NULL CHECK (actor_type IN ('user', 'system', 'ai')),
  action          text        NOT NULL,
  resource_type   text        NOT NULL,
  resource_id     text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org_created ON audit_logs (organization_id, created_at DESC);

-- =============================================================================
-- @down
-- Reverse the entire initial schema. Order matters: child tables before
-- parents (CASCADE handles FK chains but explicit order makes the diff
-- easier to read and reduces the chance that a future CASCADE change breaks
-- the rollback). Extensions last — we keep pgcrypto/vector available so any
-- subsequent migration that depends on them can still resolve at parse time
-- before being dropped itself.
-- =============================================================================
DROP TABLE IF EXISTS audit_logs        CASCADE;
DROP TABLE IF EXISTS support_jobs      CASCADE;
DROP TABLE IF EXISTS knowledge_chunks  CASCADE;
DROP TABLE IF EXISTS knowledge_documents CASCADE;
DROP TABLE IF EXISTS ai_decisions      CASCADE;
DROP TABLE IF EXISTS ai_settings       CASCADE;
DROP TABLE IF EXISTS email_delivery_events CASCADE;
DROP TABLE IF EXISTS email_addresses   CASCADE;
DROP TABLE IF EXISTS email_provider_accounts CASCADE;
DROP TABLE IF EXISTS sms_delivery_events    CASCADE;
DROP TABLE IF EXISTS sms_phone_numbers      CASCADE;
DROP TABLE IF EXISTS sms_provider_accounts  CASCADE;
DROP TABLE IF EXISTS messages          CASCADE;
DROP TABLE IF EXISTS conversations     CASCADE;
DROP TABLE IF EXISTS contacts          CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organizations     CASCADE;
DROP EXTENSION IF EXISTS "vector";
DROP EXTENSION IF EXISTS "pgcrypto";
-- @end
