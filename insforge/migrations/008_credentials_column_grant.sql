-- 008_credentials_column_grant.sql
-- InboxPilot AI Customer Support Platform — Credential Column Privilege Fix
-- Closes CRITICAL-2 from docs/RLS_AUDIT.md (parent card t_qa_rls_audit →
-- card t_07898437).
--
-- Background
-- ----------
-- insforge/migrations/003_rls_policies.sql:418-423 issues column-level
-- REVOKEs intended to hide sms_provider_accounts.credentials_secret_id and
-- email_provider_accounts.credentials_secret_id from `anon` and
-- `authenticated`. The RLS design comments (lines 165-168, 240-243) make
-- the intent explicit.
--
-- The implementation does NOT work in production: the InsForge bootstrap
-- runs `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA
-- public TO anon, authenticated;` AFTER the migrations apply. A
-- table-level GRANT re-grants SELECT on every column, overwriting the
-- column-level REVOKE. A `SELECT credentials_secret_id FROM
-- sms_provider_accounts` as the `authenticated` role then returns the
-- secret (verified empirically by the audit that opened t_07898437).
--
-- Why this migration is a different shape from the original REVOKE
-- ----------------------------------------------------------------
-- In PostgreSQL, a table-level GRANT takes precedence over any
-- column-level grant for the same column. So:
--
--   GRANT SELECT ON tbl TO role;        -- bootstrap step
--   REVOKE SELECT (col) ON tbl FROM role;  -- from migration 003
--
-- leaves the table-level grant in effect, and `role` retains SELECT on
-- `col`. The reverse (column-level GRANT after a table-level GRANT) is
-- also a no-op. The only way to narrow to a column subset is to FIRST
-- REVOKE the table-level privilege, THEN re-grant at column level.
--
-- This migration therefore:
--   1. REVOKEs the table-level SELECT/INSERT/UPDATE/DELETE on
--      sms_provider_accounts and email_provider_accounts from
--      `anon` and `authenticated` (undoing the bootstrap's
--      table-level grant for these two tables only).
--   2. Re-grants SELECT / INSERT / UPDATE at column level, on the
--      safe columns. `credentials_secret_id` is NEVER granted to a
--      client role.
--
-- The service role (the role that runs edge functions, holding the
-- service_role / BYPASSRLS attribute) is untouched and retains its full
-- table-level grant.
--
-- Why this is the right fix
-- -------------------------
-- - The bootstrap's table-level grant on these two tables is what
--   re-opens the credential column. We undo it for these tables only —
--   every other table keeps the broad bootstrap grant and is protected
--   by RLS row policies.
-- - A column-level GRANT, with `credentials_secret_id` absent from the
--   column list, gives PostgREST exactly the safe column set we want
--   to expose. `SELECT credentials_secret_id FROM sms_provider_accounts`
--   raises a permission error.
-- - All statements are idempotent: a fresh DB and a previously-
--   bootstrapped DB end up in the same state. Re-running the migration
--   is safe.
-- - Role checks are wrapped in a DO block so the migration applies
--   cleanly in dev / CI / audit DBs that may not have created the
--   `anon` and `authenticated` roles yet (matches the pattern from
--   insforge/migrations/007_org_rpc_functions.sql:175-183).

-- =============================================================================
-- 1. REVOKE the table-level client privileges on the two credential tables.
--    We do this before re-granting at column level. Without this REVOKE,
--    the column-level GRANTs below would be shadowed by the bootstrap's
--    `GRANT SELECT ON ALL TABLES` and the credential column would still
--    be readable.
--
--    We REVOKE only what the bootstrap typically grants: SELECT, INSERT,
--    UPDATE, DELETE. We do NOT touch TRUNCATE, REFERENCES, TRIGGER, or
--    MAINTAIN — those are not granted by the bootstrap, and we do not
--    need to revoke them.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE ON sms_provider_accounts   FROM anon;
    REVOKE SELECT, INSERT, UPDATE, DELETE ON email_provider_accounts FROM anon;
  ELSE
    RAISE NOTICE '008_credentials_column_grant: role "anon" not present; skipping client REVOKEs. Apply after the InsForge bootstrap creates the role.';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE ON sms_provider_accounts   FROM authenticated;
    REVOKE SELECT, INSERT, UPDATE, DELETE ON email_provider_accounts FROM authenticated;
  ELSE
    RAISE NOTICE '008_credentials_column_grant: role "authenticated" not present; skipping client REVOKEs. Apply after the InsForge bootstrap creates the role.';
  END IF;
END
$$;

-- =============================================================================
-- 2. GRANT column-level SELECT to `anon` and `authenticated`. The credential
--    column is intentionally absent — it is never granted to a client role.
--    This is the safe set PostgREST will return for `SELECT *` from these
--    tables, and a `SELECT credentials_secret_id` query will now raise
--    `ERROR: permission denied for column credentials_secret_id`.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON sms_provider_accounts TO anon;
    GRANT SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON email_provider_accounts TO anon;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON sms_provider_accounts TO authenticated;
    GRANT SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON email_provider_accounts TO authenticated;
  END IF;
END
$$;

-- =============================================================================
-- 3. GRANT column-level INSERT / UPDATE to `authenticated` (writes are gated
--    on RLS row policies; the column list excludes `credentials_secret_id`
--    so a client cannot set or change the credential reference directly).
--    The `updated_at` column is excluded from the client UPDATE grant
--    because the application code uses database triggers / now() defaults
--    to maintain it — letting the client set it would let them backdate
--    or future-date rows, which is a quiet integrity bug.
--
--    `anon` does not need INSERT / UPDATE (it is unauthenticated and
--    RLS `WITH CHECK` blocks writes from it anyway).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT INSERT (id, organization_id, provider, label, is_active, metadata)
      ON sms_provider_accounts TO authenticated;
    GRANT UPDATE (organization_id, provider, label, is_active, metadata)
      ON sms_provider_accounts TO authenticated;

    GRANT INSERT (id, organization_id, provider, label, is_active, metadata)
      ON email_provider_accounts TO authenticated;
    GRANT UPDATE (organization_id, provider, label, is_active, metadata)
      ON email_provider_accounts TO authenticated;
  END IF;
END
$$;

-- =============================================================================
-- 4. Defence in depth: explicitly REVOKE the credential column from `anon`
--    and `authenticated`. The migration 003 REVOKEs (lines 418-423) already
--    do this, but re-issuing them after the bootstrap grant cycle makes the
--    intent explicit and survives the case where the table-level REVOKE
--    above was somehow skipped (e.g. role-existence guard short-circuited).
--
--    If the table-level REVOKE succeeded, this REVOKE is a no-op (the
--    privilege is already absent). If the table-level REVOKE was skipped
--    because the role was missing, this REVOKE also short-circuits — the
--    role does not exist. Either way, the statement is safe to run.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE SELECT (credentials_secret_id) ON sms_provider_accounts   FROM anon;
    REVOKE SELECT (credentials_secret_id) ON email_provider_accounts FROM anon;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE SELECT (credentials_secret_id) ON sms_provider_accounts   FROM authenticated;
    REVOKE SELECT (credentials_secret_id) ON email_provider_accounts FROM authenticated;
  END IF;
END
$$;

-- =============================================================================
-- @down
-- Reverse every change made by this migration. We:
--   1. REVOKE the column-level SELECT / INSERT / UPDATE from `anon` and
--      `authenticated` (the table-level grant was undone in the up
--      block — re-granting at table level puts the bootstrap state back).
--   2. Re-grant the table-level SELECT, INSERT, UPDATE, DELETE to
--      `anon` and `authenticated` (matches the typical InsForge
--      bootstrap output).
--   3. Re-grant the column-level SELECT on `credentials_secret_id`
--      (reverses the defence-in-depth REVOKEs in the up block).
--
-- All steps are wrapped in role-exists DO blocks so the down block is
-- also portable to dev / CI DBs that may not have the `anon` and
-- `authenticated` roles.
-- =============================================================================

-- 1. Remove the column-level grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON sms_provider_accounts   FROM anon;
    REVOKE SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON email_provider_accounts FROM anon;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON sms_provider_accounts   FROM authenticated;
    REVOKE SELECT (id, organization_id, provider, label, is_active, metadata, created_at, updated_at)
      ON email_provider_accounts FROM authenticated;

    REVOKE INSERT (id, organization_id, provider, label, is_active, metadata)
      ON sms_provider_accounts   FROM authenticated;
    REVOKE UPDATE (organization_id, provider, label, is_active, metadata)
      ON sms_provider_accounts   FROM authenticated;

    REVOKE INSERT (id, organization_id, provider, label, is_active, metadata)
      ON email_provider_accounts FROM authenticated;
    REVOKE UPDATE (organization_id, provider, label, is_active, metadata)
      ON email_provider_accounts FROM authenticated;
  END IF;
END
$$;

-- 2. Restore the table-level grants (matches the typical InsForge bootstrap)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sms_provider_accounts   TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON email_provider_accounts TO anon;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sms_provider_accounts   TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON email_provider_accounts TO authenticated;
  END IF;
END
$$;

-- 3. Re-grant the credential column at column level (reverse of the
--    defence-in-depth REVOKEs in the up block; matches the up block
--    of migration 003 lines 418-423).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT (credentials_secret_id) ON sms_provider_accounts   TO anon;
    GRANT SELECT (credentials_secret_id) ON email_provider_accounts TO anon;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT (credentials_secret_id) ON sms_provider_accounts   TO authenticated;
    GRANT SELECT (credentials_secret_id) ON email_provider_accounts TO authenticated;
  END IF;
END
$$;
-- @end
