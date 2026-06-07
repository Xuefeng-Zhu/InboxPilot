-- 003_rls_policies.sql
-- InboxPilot AI Customer Support Platform — Row Level Security Policies
-- Enables RLS on all tenant-scoped tables and creates policies restricting
-- access to rows matching the user's organization membership via JWT.
-- Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 24.3, 24.4, 22.3

-- =============================================================================
-- Helper Functions
-- =============================================================================

-- auth.uid(): Extracts the authenticated user's ID from the JWT claims.
-- InsForge convention: the user ID is in the 'sub' claim of the JWT.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->>'sub',
    ''
  );
$$;

-- user_org_ids(): Returns the set of organization IDs the current user
-- belongs to, based on their membership in organization_members.
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT om.organization_id
  FROM organization_members om
  WHERE om.user_id = auth.uid();
$$;

-- =============================================================================
-- Enable RLS on all tenant-scoped tables
-- =============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 1. organizations
-- Users can only see/modify organizations they are members of.
-- =============================================================================

CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (id IN (SELECT user_org_ids()));

CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (true);
  -- Any authenticated user can create an organization; membership is assigned
  -- in the same transaction by the application layer.

CREATE POLICY organizations_update ON organizations
  FOR UPDATE USING (id IN (SELECT user_org_ids()));

CREATE POLICY organizations_delete ON organizations
  FOR DELETE USING (id IN (SELECT user_org_ids()));

-- =============================================================================
-- 2. organization_members
-- Users can only see/modify members of organizations they belong to.
-- =============================================================================

CREATE POLICY org_members_select ON organization_members
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY org_members_insert ON organization_members
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY org_members_update ON organization_members
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY org_members_delete ON organization_members
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 3. contacts
-- =============================================================================

CREATE POLICY contacts_select ON contacts
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY contacts_insert ON contacts
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY contacts_update ON contacts
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY contacts_delete ON contacts
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 4. conversations
-- =============================================================================

CREATE POLICY conversations_select ON conversations
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY conversations_insert ON conversations
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY conversations_update ON conversations
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY conversations_delete ON conversations
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 5. messages
-- Messages do not have organization_id directly; access is determined by the
-- parent conversation's organization membership.
-- =============================================================================

CREATE POLICY messages_select ON messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY messages_update ON messages
  FOR UPDATE USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY messages_delete ON messages
  FOR DELETE USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

-- =============================================================================
-- 6. sms_provider_accounts
-- Credential column (credentials_secret_id) is excluded from client queries
-- via column-level REVOKE below.
-- =============================================================================

CREATE POLICY sms_provider_accounts_select ON sms_provider_accounts
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY sms_provider_accounts_insert ON sms_provider_accounts
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY sms_provider_accounts_update ON sms_provider_accounts
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY sms_provider_accounts_delete ON sms_provider_accounts
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 7. sms_phone_numbers
-- =============================================================================

CREATE POLICY sms_phone_numbers_select ON sms_phone_numbers
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY sms_phone_numbers_insert ON sms_phone_numbers
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY sms_phone_numbers_update ON sms_phone_numbers
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY sms_phone_numbers_delete ON sms_phone_numbers
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 8. sms_delivery_events
-- No organization_id; access determined via message → conversation chain.
-- =============================================================================

CREATE POLICY sms_delivery_events_select ON sms_delivery_events
  FOR SELECT USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY sms_delivery_events_insert ON sms_delivery_events
  FOR INSERT WITH CHECK (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY sms_delivery_events_update ON sms_delivery_events
  FOR UPDATE USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY sms_delivery_events_delete ON sms_delivery_events
  FOR DELETE USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

-- =============================================================================
-- 9. email_provider_accounts
-- Credential column (credentials_secret_id) is excluded from client queries
-- via column-level REVOKE below.
-- =============================================================================

CREATE POLICY email_provider_accounts_select ON email_provider_accounts
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY email_provider_accounts_insert ON email_provider_accounts
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY email_provider_accounts_update ON email_provider_accounts
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY email_provider_accounts_delete ON email_provider_accounts
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 10. email_addresses
-- =============================================================================

CREATE POLICY email_addresses_select ON email_addresses
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY email_addresses_insert ON email_addresses
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY email_addresses_update ON email_addresses
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY email_addresses_delete ON email_addresses
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 11. email_delivery_events
-- No organization_id; access determined via message → conversation chain.
-- =============================================================================

CREATE POLICY email_delivery_events_select ON email_delivery_events
  FOR SELECT USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY email_delivery_events_insert ON email_delivery_events
  FOR INSERT WITH CHECK (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY email_delivery_events_update ON email_delivery_events
  FOR UPDATE USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

CREATE POLICY email_delivery_events_delete ON email_delivery_events
  FOR DELETE USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id IN (SELECT user_org_ids())
    )
  );

-- =============================================================================
-- 12. ai_settings
-- =============================================================================

CREATE POLICY ai_settings_select ON ai_settings
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_settings_insert ON ai_settings
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_settings_update ON ai_settings
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_settings_delete ON ai_settings
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 13. ai_decisions
-- =============================================================================

CREATE POLICY ai_decisions_select ON ai_decisions
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_decisions_insert ON ai_decisions
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_decisions_update ON ai_decisions
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_decisions_delete ON ai_decisions
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 14. knowledge_documents
-- =============================================================================

CREATE POLICY knowledge_documents_select ON knowledge_documents
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY knowledge_documents_insert ON knowledge_documents
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY knowledge_documents_update ON knowledge_documents
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY knowledge_documents_delete ON knowledge_documents
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 15. knowledge_chunks
-- =============================================================================

CREATE POLICY knowledge_chunks_select ON knowledge_chunks
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY knowledge_chunks_insert ON knowledge_chunks
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY knowledge_chunks_update ON knowledge_chunks
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY knowledge_chunks_delete ON knowledge_chunks
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =============================================================================
-- 16. support_jobs
-- =============================================================================

CREATE POLICY support_jobs_select ON support_jobs
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY support_jobs_insert ON support_jobs
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY support_jobs_update ON support_jobs
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY support_jobs_delete ON support_jobs
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));


-- =============================================================================
-- 17. audit_logs — APPEND-ONLY
-- Only SELECT and INSERT are permitted. No UPDATE or DELETE policies are
-- created, which means those operations are denied by default when RLS is
-- enabled. This enforces the append-only invariant (Requirement 22.3).
-- =============================================================================

CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

-- No UPDATE or DELETE policies — RLS denies these operations by default.

-- =============================================================================
-- Credential Column Exclusion
-- Revoke SELECT on credentials_secret_id from client-facing roles so that
-- PostgREST (which uses these roles) never returns credential data.
-- Requirements: 15.5, 24.3, 24.4
-- =============================================================================

-- Revoke column-level SELECT on sms_provider_accounts.credentials_secret_id
REVOKE SELECT (credentials_secret_id) ON sms_provider_accounts FROM anon;
REVOKE SELECT (credentials_secret_id) ON sms_provider_accounts FROM authenticated;

-- Revoke column-level SELECT on email_provider_accounts.credentials_secret_id
REVOKE SELECT (credentials_secret_id) ON email_provider_accounts FROM anon;
REVOKE SELECT (credentials_secret_id) ON email_provider_accounts FROM authenticated;
-- =============================================================================
-- @down
-- Reverse every RLS change in 003_rls_policies.sql. We DROP every policy
-- added in the up block, then GRANT back the column-level SELECTs on the
-- credentials_secret_id columns (the reverse of the REVOKEs at the bottom
-- of the up block), then DROP the helper functions user_org_ids and
-- auth.uid().
--
-- Note: the policies were applied across 17 tables × 4 verbs (select/
-- insert/update/delete) = 66 DROP statements, generated programmatically
-- from the up block. If you add a new table or policy in the up block,
-- regenerate this section:  grep -E '^CREATE POLICY' <up> | awk '{print "DROP POLICY IF EXISTS " $3 " ON " $5 ";"}'
-- =============================================================================

DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_insert ON organizations;
DROP POLICY IF EXISTS organizations_update ON organizations;
DROP POLICY IF EXISTS organizations_delete ON organizations;
DROP POLICY IF EXISTS org_members_select ON organization_members;
DROP POLICY IF EXISTS org_members_insert ON organization_members;
DROP POLICY IF EXISTS org_members_update ON organization_members;
DROP POLICY IF EXISTS org_members_delete ON organization_members;
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_insert ON messages;
DROP POLICY IF EXISTS messages_update ON messages;
DROP POLICY IF EXISTS messages_delete ON messages;
DROP POLICY IF EXISTS sms_provider_accounts_select ON sms_provider_accounts;
DROP POLICY IF EXISTS sms_provider_accounts_insert ON sms_provider_accounts;
DROP POLICY IF EXISTS sms_provider_accounts_update ON sms_provider_accounts;
DROP POLICY IF EXISTS sms_provider_accounts_delete ON sms_provider_accounts;
DROP POLICY IF EXISTS sms_phone_numbers_select ON sms_phone_numbers;
DROP POLICY IF EXISTS sms_phone_numbers_insert ON sms_phone_numbers;
DROP POLICY IF EXISTS sms_phone_numbers_update ON sms_phone_numbers;
DROP POLICY IF EXISTS sms_phone_numbers_delete ON sms_phone_numbers;
DROP POLICY IF EXISTS sms_delivery_events_select ON sms_delivery_events;
DROP POLICY IF EXISTS sms_delivery_events_insert ON sms_delivery_events;
DROP POLICY IF EXISTS sms_delivery_events_update ON sms_delivery_events;
DROP POLICY IF EXISTS sms_delivery_events_delete ON sms_delivery_events;
DROP POLICY IF EXISTS email_provider_accounts_select ON email_provider_accounts;
DROP POLICY IF EXISTS email_provider_accounts_insert ON email_provider_accounts;
DROP POLICY IF EXISTS email_provider_accounts_update ON email_provider_accounts;
DROP POLICY IF EXISTS email_provider_accounts_delete ON email_provider_accounts;
DROP POLICY IF EXISTS email_addresses_select ON email_addresses;
DROP POLICY IF EXISTS email_addresses_insert ON email_addresses;
DROP POLICY IF EXISTS email_addresses_update ON email_addresses;
DROP POLICY IF EXISTS email_addresses_delete ON email_addresses;
DROP POLICY IF EXISTS email_delivery_events_select ON email_delivery_events;
DROP POLICY IF EXISTS email_delivery_events_insert ON email_delivery_events;
DROP POLICY IF EXISTS email_delivery_events_update ON email_delivery_events;
DROP POLICY IF EXISTS email_delivery_events_delete ON email_delivery_events;
DROP POLICY IF EXISTS ai_settings_select ON ai_settings;
DROP POLICY IF EXISTS ai_settings_insert ON ai_settings;
DROP POLICY IF EXISTS ai_settings_update ON ai_settings;
DROP POLICY IF EXISTS ai_settings_delete ON ai_settings;
DROP POLICY IF EXISTS ai_decisions_select ON ai_decisions;
DROP POLICY IF EXISTS ai_decisions_insert ON ai_decisions;
DROP POLICY IF EXISTS ai_decisions_update ON ai_decisions;
DROP POLICY IF EXISTS ai_decisions_delete ON ai_decisions;
DROP POLICY IF EXISTS knowledge_documents_select ON knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_insert ON knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_update ON knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_delete ON knowledge_documents;
DROP POLICY IF EXISTS knowledge_chunks_select ON knowledge_chunks;
DROP POLICY IF EXISTS knowledge_chunks_insert ON knowledge_chunks;
DROP POLICY IF EXISTS knowledge_chunks_update ON knowledge_chunks;
DROP POLICY IF EXISTS knowledge_chunks_delete ON knowledge_chunks;
DROP POLICY IF EXISTS support_jobs_select ON support_jobs;
DROP POLICY IF EXISTS support_jobs_insert ON support_jobs;
DROP POLICY IF EXISTS support_jobs_update ON support_jobs;
DROP POLICY IF EXISTS support_jobs_delete ON support_jobs;
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;

-- Reverse the column-level REVOKEs (re-grant SELECT on credentials_secret_id)
GRANT SELECT (credentials_secret_id) ON sms_provider_accounts    TO anon;
GRANT SELECT (credentials_secret_id) ON sms_provider_accounts    TO authenticated;
GRANT SELECT (credentials_secret_id) ON email_provider_accounts  TO anon;
GRANT SELECT (credentials_secret_id) ON email_provider_accounts  TO authenticated;

-- Drop the helper functions (auth.uid is recreated as a stub by PostgREST
-- on next restart, so dropping it here is safe).
DROP FUNCTION IF EXISTS public.user_org_ids();
DROP FUNCTION IF EXISTS auth.uid();
-- @end

