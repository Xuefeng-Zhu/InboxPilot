-- 007_org_rpc_functions.sql
-- InboxPilot AI Customer Support Platform — Organization RPC Functions
-- Closes CRITICAL-1 from docs/RLS_AUDIT.md (parent card t_qa_rls_audit).
--
-- Background
-- ----------
-- The `organizations` table is the only table whose INSERT policy is fully
-- open: `CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (true);`
-- (see insforge/migrations/003_rls_policies.sql:66-69). Every other table
-- gates INSERT on `organization_id IN (SELECT user_org_ids())`, but the
-- organization has no `organization_id` to check against — the org IS the
-- tenant root. The design relied on the application layer to insert the
-- matching `organization_members` row in the same transaction, but RLS
-- does not enforce that — it just permits the INSERT.
--
-- Impact
-- ------
-- - Slug squatting: any authenticated user can race to create organizations
--   with desirable slugs (`google`, `acme`, etc.) and lock out legitimate
--   customers.
-- - Inconsistent invariant: the only "open door" in an otherwise airtight
--   RLS design. Every other table is org-scoped on every verb.
--
-- Fix
-- ---
-- 1. Close the direct-INSERT door (this migration is paired with a
--    pre-existing change to insforge/migrations/003_rls_policies.sql that
--    changes the policy to `WITH CHECK (false)`; see migration header).
-- 2. Provide a single SECURITY DEFINER RPC `create_organization(name, slug)`
--    that, in one transaction, inserts the organization row, inserts the
--    matching `organization_members` row (role = 'owner'), and writes the
--    `audit_logs` row (`action = 'organization_created'`). The owner is
--    always the JWT caller (auth.uid() from the 'sub' claim) — there is
--    no `owner_user_id` parameter, by design, to prevent impersonation
--    via a forged parameter.
-- 3. Grant EXECUTE on the RPC to `authenticated` so JWT-bearing clients can
--    bootstrap their own tenants. Anon (unauthenticated) cannot.
-- 4. The application code in
--    packages/support-core/src/services/organization-service.ts now calls
--    this RPC via `db.rpc('create_organization', {...})` instead of going
--    through `OrganizationRepository.create` + `MemberRepository.create`.
--
-- Why SECURITY DEFINER + the migration owner is right
-- ---------------------------------------------------
-- SECURITY DEFINER runs the function body with the privileges of the
-- function OWNER (the role that ran `CREATE FUNCTION`). Migrations in this
-- project run as `postgres` (the database superuser), which holds the
-- `BYPASSRLS` attribute. The function therefore inserts into
-- `organizations`, `organization_members`, and `audit_logs` without being
-- subject to their RLS policies. The JWT context (`request.jwt.claims`)
-- is preserved across the SECURITY DEFINER boundary, so the audit log
-- entry can record the real `actor_id` and `actor_type = 'user'`.
--
-- The function does not accept an arbitrary `id` — the database assigns it
-- via `gen_random_uuid()`. This prevents the caller from predicting and
-- squatting on UUIDs and prevents them from impersonating a known org.

-- =============================================================================
-- 1. create_organization(name text, slug text)
--    Returns the inserted organization row, with both inserts and the audit
--    log entry committed atomically. The owner is always the caller
--    (auth.uid() from the JWT 'sub' claim) — there is no way to bootstrap
--    an org for another user, which prevents impersonation via a forged
--    owner_user_id parameter.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_organization(
  name text,
  slug text
)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn_create_org$
DECLARE
  caller_id text;
  new_org organizations;
  new_member organization_members;
BEGIN
  -- Derive the owner from the JWT, not from a parameter. This closes the
  -- impersonation vector where a caller could pass another user's id and
  -- bootstrap an org under their identity. We trap the JSON-parse failure
  -- that occurs when `request.jwt.claims` is unset (the `->>'sub'` returns
  -- NULL and the surrounding `coalesce(..., '')` returns '' — but an
  -- outright NULL or non-JSON value in the GUC raises an exception inside
  -- auth.uid() and surfaces as a confusing JSON error otherwise).
  BEGIN
    caller_id := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'create_organization: caller must be authenticated (auth.uid() raised: %)', SQLERRM
        USING ERRCODE = '42501';  -- insufficient_privilege
  END;
  IF caller_id IS NULL OR length(trim(caller_id)) = 0 THEN
    RAISE EXCEPTION 'create_organization: caller must be authenticated (auth.uid() is empty)'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Guard rails. Each is a hard failure with a clear error message; the
  -- caller (OrganizationService) wraps these in HTTP 400/422.
  IF name IS NULL OR length(trim(name)) = 0 THEN
    RAISE EXCEPTION 'create_organization: name must be a non-empty string'
      USING ERRCODE = '22023';
  END IF;
  IF slug IS NULL OR length(trim(slug)) = 0 THEN
    RAISE EXCEPTION 'create_organization: slug must be a non-empty string'
      USING ERRCODE = '22023';
  END IF;

  -- 1. The organization row. UNIQUE (slug) is enforced by the table
  --    (insforge/migrations/001_initial_schema.sql:19), so a collision
  --    raises `unique_violation` here and the whole transaction aborts.
  --    The caller can retry with a different slug; LOW-5 in docs/QA_BUG_HUNT.md
  --    tracks adding a slug-uniqueness retry at the service layer.
  INSERT INTO organizations (name, slug)
  VALUES (trim(name), trim(slug))
  RETURNING * INTO new_org;

  -- 2. The matching owner membership. UNIQUE (organization_id, user_id)
  --    means a re-call for the same user is a no-op conflict (handled at
  --    the service layer in LOW-4/LOW-5 of docs/QA_BUG_HUNT.md).
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org.id, caller_id, 'owner')
  RETURNING * INTO new_member;

  -- 3. The audit log entry. Append-only by RLS design (no UPDATE/DELETE
  --    policies); we use the same SECURITY DEFINER context that bypasses
  --    the SELECT/INSERT policies. `actor_type = 'user'` because the call
  --    originated from an authenticated client.
  INSERT INTO audit_logs (
    organization_id,
    actor_id,
    actor_type,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    new_org.id,
    caller_id,
    'user',
    'organization_created',
    'organization',
    new_org.id::text,
    jsonb_build_object(
      'name', new_org.name,
      'slug', new_org.slug,
      'via',  'create_organization_rpc'
    )
  );

  RETURN new_org;
END;
$fn_create_org$;

-- =============================================================================
-- 2. Grants
--    `authenticated` is the only client role that may bootstrap a tenant
--    (it corresponds to a JWT-bearing user in the InsForge PostgREST
--    auth model). `anon` cannot. `project_admin` and the function owner
--    (postgres) are covered by their inherent privileges.
-- =============================================================================

REVOKE ALL ON FUNCTION public.create_organization(text, text) FROM PUBLIC;

-- GRANT to `authenticated` is the production target. We wrap it in a DO
-- block so the migration also applies cleanly in local dev / CI / audit
-- DBs that may not have created the `authenticated` role yet (e.g. a
-- `sudo -u postgres createdb inboxpilot_dev` followed by raw `psql -f`
-- runs, which don't go through the InsForge bootstrap that creates the
-- role). If the role is absent we log a NOTICE rather than failing the
-- migration — the RPC body still installs, and a later bootstrap
-- migration can grant EXECUTE without re-running this whole file.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
  ELSE
    RAISE NOTICE 'create_organization: role "authenticated" not present; skipping GRANT EXECUTE. Apply after the InsForge bootstrap creates the role.';
  END IF;
END
$$;

-- =============================================================================
-- 3. Tighten the open INSERT policy on `organizations`
--    Direct INSERT is denied. The only path to create an organization is
--    through the `create_organization` RPC above.
--
--    Note: this idempotently DROPs and re-CREATEs the policy, so re-running
--    the migration (e.g. from a partial rollback) is safe. The DROP+CREATE
--    pair also handles the case where an operator previously patched the
--    policy manually.
-- =============================================================================

DROP POLICY IF EXISTS organizations_insert ON organizations;
CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (false);
  -- Direct INSERT is denied. Use the public.create_organization RPC
  -- (SECURITY DEFINER, granted to `authenticated`) to bootstrap a tenant.
  -- See insforge/migrations/007_org_rpc_functions.sql.

-- =============================================================================
-- @down
-- Reverse every change made by this migration.
-- 1. Restore the original permissive INSERT policy (matches the verbatim
--    text from insforge/migrations/003_rls_policies.sql:66-69 so a roll-
--    forward does not produce a policy diff).
-- 2. Drop the RPC function. The REVOKE-then-DROP order doesn't matter
--    (the function is dropped from the catalog; the grant goes with it),
--    but we REVOKE EXECUTE explicitly to keep `pg_proc_aclmask` clean.
-- =============================================================================

-- 1. Restore the original permissive INSERT policy
DROP POLICY IF EXISTS organizations_insert ON organizations;
CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (true);
  -- Reverted to the pre-007 state. See insforge/migrations/003_rls_policies.sql:66-69.

-- 2. Drop the RPC. REVOKE is wrapped in a role-exists check to mirror the
--    idempotent up-migration (don't fail the rollback just because the
--    `authenticated` role isn't present locally).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM authenticated;
  END IF;
END
$$;
DROP FUNCTION IF EXISTS public.create_organization(text, text);
-- @end
