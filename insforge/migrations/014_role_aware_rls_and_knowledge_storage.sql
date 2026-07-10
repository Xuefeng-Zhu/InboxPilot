-- 014_role_aware_rls_and_knowledge_storage.sql
-- Enforces the application RBAC matrix at the database boundary and makes
-- knowledge-file access organization-scoped.
--
-- Operational follow-up: this migration cannot change storage bucket
-- visibility. After applying it, mark the existing `knowledge-files` bucket
-- private through InsForge's bucket configuration/dashboard. Do not update
-- storage.buckets directly.

-- =============================================================================
-- A. Knowledge file metadata
-- =============================================================================

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_key text;

COMMENT ON COLUMN public.knowledge_documents.file_key IS
  'Object key in the private knowledge-files bucket. Required for authenticated download and deletion.';

-- =============================================================================
-- B. Non-recursive role helpers
-- =============================================================================

-- Keep the existing tenant helper, but pin its search path and qualify the
-- table it reads. SECURITY DEFINER prevents organization_members RLS from
-- recursively invoking this function.
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT om.organization_id
  FROM public.organization_members AS om
  WHERE om.user_id = auth.uid()::text;
$$;

CREATE OR REPLACE FUNCTION public.user_has_org_role(
  p_organization_id uuid,
  p_allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()::text
      AND om.role = ANY (p_allowed_roles)
  );
$$;

-- Storage paths carry the organization UUID as text in their first segment.
-- Comparing as text makes malformed or legacy keys fail closed instead of
-- raising an invalid-UUID error for the entire query.
CREATE OR REPLACE FUNCTION public.user_has_storage_org_role(
  p_organization_id text,
  p_allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS om
    WHERE om.organization_id::text = p_organization_id
      AND om.user_id = auth.uid()::text
      AND om.role = ANY (p_allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.user_org_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_org_role(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_storage_org_role(text, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.user_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_org_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_storage_org_role(text, text[]) TO authenticated;

-- =============================================================================
-- C. Organization and settings RBAC
-- =============================================================================

-- Organization settings require manage_org (owner/admin); deletion remains
-- owner-only, matching the support-core RBAC matrix.
DROP POLICY IF EXISTS organizations_insert ON public.organizations;
CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS organizations_delete ON public.organizations;
CREATE POLICY organizations_delete ON public.organizations
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(id, ARRAY['owner']));

-- Membership changes go through RBAC-checked, service-role API routes. Leaving
-- any direct client mutation policy here would let a member promote themself
-- to owner and bypass every role-aware policy below. The SECURITY DEFINER
-- onboarding RPC continues to create the first owner membership.
DROP POLICY IF EXISTS org_members_insert ON public.organization_members;
DROP POLICY IF EXISTS org_members_update ON public.organization_members;
DROP POLICY IF EXISTS org_members_delete ON public.organization_members;

-- Agents may view settings; viewers may not. Only owners/admins may mutate.
DROP POLICY IF EXISTS sms_provider_accounts_select ON public.sms_provider_accounts;
DROP POLICY IF EXISTS sms_provider_accounts_insert ON public.sms_provider_accounts;
DROP POLICY IF EXISTS sms_provider_accounts_update ON public.sms_provider_accounts;
DROP POLICY IF EXISTS sms_provider_accounts_delete ON public.sms_provider_accounts;
CREATE POLICY sms_provider_accounts_select ON public.sms_provider_accounts
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent']));
CREATE POLICY sms_provider_accounts_insert ON public.sms_provider_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY sms_provider_accounts_update ON public.sms_provider_accounts
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY sms_provider_accounts_delete ON public.sms_provider_accounts
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS sms_phone_numbers_select ON public.sms_phone_numbers;
DROP POLICY IF EXISTS sms_phone_numbers_insert ON public.sms_phone_numbers;
DROP POLICY IF EXISTS sms_phone_numbers_update ON public.sms_phone_numbers;
DROP POLICY IF EXISTS sms_phone_numbers_delete ON public.sms_phone_numbers;
CREATE POLICY sms_phone_numbers_select ON public.sms_phone_numbers
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent']));
CREATE POLICY sms_phone_numbers_insert ON public.sms_phone_numbers
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY sms_phone_numbers_update ON public.sms_phone_numbers
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY sms_phone_numbers_delete ON public.sms_phone_numbers
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS email_provider_accounts_select ON public.email_provider_accounts;
DROP POLICY IF EXISTS email_provider_accounts_insert ON public.email_provider_accounts;
DROP POLICY IF EXISTS email_provider_accounts_update ON public.email_provider_accounts;
DROP POLICY IF EXISTS email_provider_accounts_delete ON public.email_provider_accounts;
CREATE POLICY email_provider_accounts_select ON public.email_provider_accounts
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent']));
CREATE POLICY email_provider_accounts_insert ON public.email_provider_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY email_provider_accounts_update ON public.email_provider_accounts
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY email_provider_accounts_delete ON public.email_provider_accounts
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS email_addresses_select ON public.email_addresses;
DROP POLICY IF EXISTS email_addresses_insert ON public.email_addresses;
DROP POLICY IF EXISTS email_addresses_update ON public.email_addresses;
DROP POLICY IF EXISTS email_addresses_delete ON public.email_addresses;
CREATE POLICY email_addresses_select ON public.email_addresses
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent']));
CREATE POLICY email_addresses_insert ON public.email_addresses
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY email_addresses_update ON public.email_addresses
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY email_addresses_delete ON public.email_addresses
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS ai_settings_select ON public.ai_settings;
DROP POLICY IF EXISTS ai_settings_insert ON public.ai_settings;
DROP POLICY IF EXISTS ai_settings_update ON public.ai_settings;
DROP POLICY IF EXISTS ai_settings_delete ON public.ai_settings;
CREATE POLICY ai_settings_select ON public.ai_settings
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent']));
CREATE POLICY ai_settings_insert ON public.ai_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY ai_settings_update ON public.ai_settings
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY ai_settings_delete ON public.ai_settings
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS webchat_widgets_select ON public.webchat_widgets;
DROP POLICY IF EXISTS webchat_widgets_insert ON public.webchat_widgets;
DROP POLICY IF EXISTS webchat_widgets_update ON public.webchat_widgets;
DROP POLICY IF EXISTS webchat_widgets_delete ON public.webchat_widgets;
CREATE POLICY webchat_widgets_select ON public.webchat_widgets
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent']));
CREATE POLICY webchat_widgets_insert ON public.webchat_widgets
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY webchat_widgets_update ON public.webchat_widgets
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY webchat_widgets_delete ON public.webchat_widgets
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

-- =============================================================================
-- D. Knowledge RBAC and job queue protection
-- =============================================================================

DROP POLICY IF EXISTS knowledge_documents_select ON public.knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_insert ON public.knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_update ON public.knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_delete ON public.knowledge_documents;
CREATE POLICY knowledge_documents_select ON public.knowledge_documents
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent', 'viewer']));
CREATE POLICY knowledge_documents_insert ON public.knowledge_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_org_role(organization_id, ARRAY['owner', 'admin'])
    AND (
      (file_url IS NULL AND file_key IS NULL)
      OR (
        file_url IS NOT NULL
        AND file_key LIKE (organization_id::text || '/documents/%')
      )
    )
  );
CREATE POLICY knowledge_documents_update ON public.knowledge_documents
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (
    public.user_has_org_role(organization_id, ARRAY['owner', 'admin'])
    AND (
      (file_url IS NULL AND file_key IS NULL)
      OR (
        file_url IS NOT NULL
        AND file_key LIKE (organization_id::text || '/documents/%')
      )
    )
  );
CREATE POLICY knowledge_documents_delete ON public.knowledge_documents
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS knowledge_chunks_select ON public.knowledge_chunks;
DROP POLICY IF EXISTS knowledge_chunks_insert ON public.knowledge_chunks;
DROP POLICY IF EXISTS knowledge_chunks_update ON public.knowledge_chunks;
DROP POLICY IF EXISTS knowledge_chunks_delete ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_select ON public.knowledge_chunks
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin', 'agent', 'viewer']));
CREATE POLICY knowledge_chunks_insert ON public.knowledge_chunks
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY knowledge_chunks_update ON public.knowledge_chunks
  FOR UPDATE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY knowledge_chunks_delete ON public.knowledge_chunks
  FOR DELETE TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));

-- Browser clients only enqueue knowledge-processing jobs. Job workers use the
-- project-admin/service role and bypass RLS for claiming and state changes.
DROP POLICY IF EXISTS support_jobs_select ON public.support_jobs;
DROP POLICY IF EXISTS support_jobs_insert ON public.support_jobs;
DROP POLICY IF EXISTS support_jobs_update ON public.support_jobs;
DROP POLICY IF EXISTS support_jobs_delete ON public.support_jobs;
CREATE POLICY support_jobs_select ON public.support_jobs
  FOR SELECT TO authenticated
  USING (public.user_has_org_role(organization_id, ARRAY['owner', 'admin']));
CREATE POLICY support_jobs_insert ON public.support_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    job_type = 'process_knowledge_document'
    AND public.user_has_org_role(organization_id, ARRAY['owner', 'admin'])
  );

-- =============================================================================
-- E. Append-only audit identity
-- =============================================================================

DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_org_role(
      organization_id,
      ARRAY['owner', 'admin', 'agent']
    )
    AND actor_type = 'user'
    AND actor_id = auth.uid()::text
  );

-- =============================================================================
-- F. Secret-safe client SELECT grants
-- =============================================================================

-- A column-level REVOKE does not override an existing table-level SELECT.
-- Remove the broad grant first, then grant only the safe client columns.
REVOKE SELECT ON TABLE public.sms_provider_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, organization_id, provider, label, is_active, metadata, created_at, updated_at
) ON public.sms_provider_accounts TO authenticated;

REVOKE SELECT ON TABLE public.email_provider_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, organization_id, provider, label, is_active, metadata, created_at, updated_at
) ON public.email_provider_accounts TO authenticated;

REVOKE SELECT ON TABLE public.webchat_widgets FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, organization_id, name, widget_token, allowed_domains, position,
  primary_color, greeting, pre_chat_enabled, ai_mode_override, is_active,
  created_at, updated_at
) ON public.webchat_widgets TO authenticated;

-- =============================================================================
-- G. Private, organization-scoped knowledge storage
-- =============================================================================

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_files_select ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_insert ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_update ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_delete ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_role_guard_select ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_role_guard_insert ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_role_guard_update ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_role_guard_delete ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_anon_guard ON storage.objects;

CREATE POLICY knowledge_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = 'knowledge-files'
    AND public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin', 'agent', 'viewer']
    )
  );

CREATE POLICY knowledge_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'knowledge-files'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  );

CREATE POLICY knowledge_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket = 'knowledge-files'
    AND public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  )
  WITH CHECK (
    bucket = 'knowledge-files'
    AND public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  );

CREATE POLICY knowledge_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket = 'knowledge-files'
    AND public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  );

-- Restrictive guards ensure any platform-installed owner policy or future
-- permissive storage policy cannot OR around the knowledge-file RBAC rules.
CREATE POLICY knowledge_files_role_guard_select ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket <> 'knowledge-files'
    OR public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin', 'agent', 'viewer']
    )
  );

CREATE POLICY knowledge_files_role_guard_insert ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket <> 'knowledge-files'
    OR (
      uploaded_by = (SELECT auth.jwt() ->> 'sub')
      AND public.user_has_storage_org_role(
        (storage.foldername(key))[1],
        ARRAY['owner', 'admin']
      )
    )
  );

CREATE POLICY knowledge_files_role_guard_update ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    bucket <> 'knowledge-files'
    OR public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  )
  WITH CHECK (
    bucket <> 'knowledge-files'
    OR public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  );

CREATE POLICY knowledge_files_role_guard_delete ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    bucket <> 'knowledge-files'
    OR public.user_has_storage_org_role(
      (storage.foldername(key))[1],
      ARRAY['owner', 'admin']
    )
  );

CREATE POLICY knowledge_files_anon_guard ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon
  USING (bucket <> 'knowledge-files')
  WITH CHECK (bucket <> 'knowledge-files');

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
