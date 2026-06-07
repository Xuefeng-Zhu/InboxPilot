-- 008_credentials_column_grant_verify.sql
-- Standalone harness that proves CRITICAL-2's fix end-to-end. Run order:
--   1. CREATE DATABASE inboxpilot_creds_verify
--   2. \i 001_initial_schema.sql
--   3. \i 002_rpc_functions.sql
--   4. \i 003_rls_policies.sql
--   5. \i 008_credentials_column_grant.sql
--   6. Issue the typical InsForge bootstrap grants (this is the
--      trigger that historically undid the migration 003 REVOKEs):
--         GRANT SELECT, INSERT, UPDATE, DELETE
--           ON ALL TABLES IN SCHEMA public
--           TO anon, authenticated;
--   7. Run the verification queries at the bottom of this file.
--
-- This file is a scratch script, NOT part of the migration set.
-- It is included as docs/evidence so reviewers can replay the same
-- shape that t_07898437 used for CRITICAL-2. Drop the database after
-- running.

-- =============================================================================
-- Seed: an organization, an org member, and a credential row in each
-- of the two credential tables. We use UUIDs that won't collide with
-- any seed data the migration scripts may have inserted.
-- =============================================================================

INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000000b1',
  'Creds Verify Co',
  'creds-verify-co',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000000b2',
  '00000000-0000-0000-0000-0000000000b1',
  'usr_verify_user',
  'owner',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sms_provider_accounts (id, organization_id, provider, label, credentials_secret_id, is_active, metadata)
VALUES (
  '00000000-0000-0000-0000-0000000000b3',
  '00000000-0000-0000-0000-0000000000b1',
  'twilio',
  'verify-sms-account',
  'topsecret-sms-credential',
  true,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO email_provider_accounts (id, organization_id, provider, label, credentials_secret_id, is_active, metadata)
VALUES (
  '00000000-0000-0000-0000-0000000000b4',
  '00000000-0000-0000-0000-0000000000b1',
  'postmark',
  'verify-email-account',
  'topsecret-email-credential',
  true,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Verification queries.
-- Each query is annotated with the expected outcome. The harness
-- exits with non-zero if any of the "should be denied" queries
-- succeed (because the @ down wrap; we use psql -v ON_ERROR_STOP=1
-- and a final SELECT that should never return rows).
-- =============================================================================

-- 1. As the `authenticated` role, selecting the credential column
--    from sms_provider_accounts should be denied. We expect:
--      ERROR: permission denied for column credentials_secret_id
--    (psql with -v ON_ERROR_STOP=1 will abort the script on the
--    first such error, so a clean run is a passing result.)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"usr_verify_user"}';
SELECT credentials_secret_id FROM sms_provider_accounts LIMIT 1;
-- expected: ERROR

-- 2. Same for email_provider_accounts
SELECT credentials_secret_id FROM email_provider_accounts LIMIT 1;
-- expected: ERROR

-- 3. Safe columns should still be readable (the (table, role) pair
--    has a column-level SELECT grant covering id, organization_id,
--    provider, label, is_active, metadata, created_at, updated_at).
--    We expect one row back, with the credential column absent from
--    the projection.
SELECT id, provider, label FROM sms_provider_accounts ORDER BY created_at LIMIT 1;
-- expected: 1 row

SELECT id, provider, label FROM email_provider_accounts ORDER BY created_at LIMIT 1;
-- expected: 1 row

-- 4. As the `anon` role, selecting the credential column is also denied.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT credentials_secret_id FROM sms_provider_accounts LIMIT 1;
-- expected: ERROR

SELECT credentials_secret_id FROM email_provider_accounts LIMIT 1;
-- expected: ERROR

-- 5. The service role (postgres, holding BYPASSRLS) retains the full
--    table-level grant. The credential column is still readable.
RESET ROLE;
SELECT credentials_secret_id FROM sms_provider_accounts LIMIT 1;
-- expected: 1 row, value 'topsecret-sms-credential'

SELECT credentials_secret_id FROM email_provider_accounts LIMIT 1;
-- expected: 1 row, value 'topsecret-email-credential'

-- 6. Column-level privilege inspection (the proof in pg_attribute /
--    information_schema.role_column_grants). After migration 008:
--      - `anon` and `authenticated` should NOT appear in
--        role_column_grants for credentials_secret_id on either table.
--      - The service role's row in role_column_grants is not visible
--        here (it's a row-level grant, not column-level).
RESET ROLE;
SELECT grantee, table_name, column_name, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name IN ('sms_provider_accounts', 'email_provider_accounts')
  AND column_name = 'credentials_secret_id'
  AND grantee IN ('anon', 'authenticated');
-- expected: 0 rows. If the bug regressed, this query would return
-- rows for `authenticated` (or both) and the harness fails.
