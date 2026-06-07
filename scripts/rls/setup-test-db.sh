#!/usr/bin/env bash
# =============================================================================
# scripts/rls/setup-test-db.sh — Provision a fresh DB for the RLS probe suite.
# =============================================================================
#
# Usage:
#   scripts/rls/setup-test-db.sh                 # create a brand-new DB
#   scripts/rls/setup-test-db.sh <name>          # use a specific DB name
#   scripts/rls/setup-test-db.sh <name> --keep   # do not drop the DB on exit
#
# What it does:
#   1. Creates a fresh Postgres database (or reuses the one passed in).
#   2. Installs pgcrypto + vector.
#   3. Applies migrations 001 → 008 (in order, with @down blocks stripped).
#   4. Creates the typical InsForge client roles (`anon`, `authenticated`)
#      and the test user roles (`rls_user_a`, `rls_user_b`, `rls_user_c`).
#   5. Issues the typical InsForge bootstrap:
#        GRANT SELECT, INSERT, UPDATE, DELETE
#          ON ALL TABLES IN SCHEMA public
#          TO anon, authenticated;
#      This is the same grant that, in production, undoes the
#      column-level REVOKEs from migration 003 for the credential
#      columns — so we exercise the real privilege shape the test cares
#      about.
#   6. Seeds 2 organizations (alice in org A, bob in org B) with one
#      row in each of the 17 tables.
#
# The probe test (`packages/support-core/__tests__/integration/rls-policies.test.ts`)
# reads `RLS_TEST_DB`, `RLS_TEST_DB_AS_POSTGRES`, and `RLS_TEST_KEEP_DB`
# from the environment to drive setup / teardown. This script is the
# "human-friendly" wrapper for the same flow.
#
# Requires:
#   - sudo access to `postgres`
#   - python3 in $PATH
#   - psql in $PATH
#
# Idempotency:
#   - Re-running on an existing DB drops and re-creates it (unless --keep).
#   - Re-running on a non-existent DB creates it.
#   - Re-running with a specific name and --keep is a no-op for setup.
# =============================================================================

set -euo pipefail

# ---- Locate repo root ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$REPO_ROOT/insforge/migrations"
STRIP_DIR="/tmp/rls_test_stripped"

# ---- Args ----
DBNAME="${1:-}"
KEEP_DB=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP_DB=1 ;;
  esac
done

if [[ -z "$DBNAME" ]]; then
  DBNAME="rls_test_$(date +%s%N)"
fi

echo "==> target DB: $DBNAME"

# ---- Privileged commands run via sudo ----
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1"

# ---- Strip @down blocks ----
mkdir -p "$STRIP_DIR"
chmod 755 "$STRIP_DIR"
for mig in 001_initial_schema.sql 002_rpc_functions.sql 003_rls_policies.sql \
           004_perf_indexes.sql 005_analytics_aggregation.sql \
           006_ai_settings_knowledge_required.sql \
           007_org_rpc_functions.sql 008_credentials_column_grant.sql; do
  if [[ -f "$MIG_DIR/$mig" ]]; then
    python3 "$SCRIPT_DIR/strip-down.py" "$MIG_DIR/$mig" > "$STRIP_DIR/$mig"
    chmod 644 "$STRIP_DIR/$mig"
  fi
done

# ---- Drop / create DB ----
if [[ "$KEEP_DB" -eq 1 ]] && sudo -u postgres psql -At -c "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" | grep -q 1; then
  echo "==> --keep set and DB exists, skipping recreate"
else
  $PSQL -c "DROP DATABASE IF EXISTS $DBNAME;" >/dev/null 2>&1 || true
  $PSQL -c "CREATE DATABASE $DBNAME;" >/dev/null
fi

# ---- Extensions ----
$PSQL -d "$DBNAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

# ---- Apply migrations in order ----
# We apply 001-007 first. Migration 008 is role-dependent: its REVOKEs
# only do useful work AFTER the InsForge bootstrap grant has been
# issued (the grant is what re-opens the credential column). So:
#   1. Apply 001-007 (these create tables, RLS policies, the
#      create_organization RPC, etc. — none require client roles.)
#   2. Create the client roles.
#   3. Issue the bootstrap GRANT.
#   4. Apply 008 (REVOKEs now actually have something to revoke, then
#      the column-level GRANTs replace them.)
#   5. Re-apply 008 for idempotency (it short-circuits on no-op).
for mig in 001_initial_schema.sql 002_rpc_functions.sql 003_rls_policies.sql \
           004_perf_indexes.sql 005_analytics_aggregation.sql \
           006_ai_settings_knowledge_required.sql \
           007_org_rpc_functions.sql; do
  if [[ -f "$STRIP_DIR/$mig" ]]; then
    echo "==> applying $mig"
    $PSQL -d "$DBNAME" -f "$STRIP_DIR/$mig" >/dev/null
  fi
done

# ---- Roles + bootstrap grants ----
# We model the production privilege shape: anon + authenticated are
# non-superuser client roles that the InsForge bootstrap grants broad
# table-level access on. The test then PROBES as these roles with a
# JWT-style `request.jwt.claims` setting.
$PSQL -d "$DBNAME" >/dev/null <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_user_a') THEN
    CREATE ROLE rls_user_a NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_user_b') THEN
    CREATE ROLE rls_user_b NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, rls_user_a, rls_user_b, service_role;

-- The critical bootstrap grant: re-grants SELECT on every column,
-- which is what undoes migration 003's column-level REVOKE on
-- credentials_secret_id. The test verifies that migration 008's
-- table-level REVOKE on the two credential tables re-closes the
-- column.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, rls_user_a, rls_user_b;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, rls_user_a, rls_user_b;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, rls_user_a, rls_user_b;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, rls_user_a, rls_user_b;
EOSQL

# ---- Apply migration 008 LAST (after the bootstrap grant) ----
# Migration 008 is the CRITICAL-2 fix: it REVOKEs the table-level
# client privilege on sms/email_provider_accounts, then re-grants at
# the column level. This only works as intended when the bootstrap
# GRANT has already happened (the bootstrap is what re-opens the
# credential column). Apply it once after the bootstrap.
if [[ -f "$STRIP_DIR/008_credentials_column_grant.sql" ]]; then
  echo "==> applying 008_credentials_column_grant.sql (after bootstrap)"
  $PSQL -d "$DBNAME" -f "$STRIP_DIR/008_credentials_column_grant.sql" >/dev/null
fi

# ---- Seed 2 organizations (alice / bob) ----
$PSQL -d "$DBNAME" >/dev/null <<'EOSQL'
-- Two orgs
INSERT INTO organizations (id, name, slug) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Org A', 'org-a'),
  ('a0000000-0000-4000-8000-000000000002', 'Org B', 'org-b');

-- Membership
INSERT INTO organization_members (id, organization_id, user_id, role) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'usr_alice', 'owner'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'usr_bob',   'owner');

-- Contacts (one per org)
INSERT INTO contacts (id, organization_id, name, email) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Alice contact', 'a@example.com'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Bob contact',   'b@example.com');

-- Conversations
INSERT INTO conversations (id, organization_id, contact_id, channel, status, ai_state) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'sms', 'open', 'idle'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'sms', 'open', 'idle');

-- Messages
INSERT INTO messages (id, conversation_id, sender_type, direction, channel, body) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'contact', 'inbound', 'sms', 'hi from A'),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'contact', 'inbound', 'sms', 'hi from B');

-- SMS provider accounts (with credential columns)
INSERT INTO sms_provider_accounts (id, organization_id, provider, label, credentials_secret_id) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'twilio', 'Twilio A', 'twilio-secret-a'),
  ('fa000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'twilio', 'Twilio B', 'twilio-secret-b');
INSERT INTO sms_phone_numbers (id, provider_account_id, organization_id, phone_number) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '+155****0001'),
  ('fb000000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '+155****0002');
INSERT INTO sms_delivery_events (id, message_id, status) VALUES
  ('fc000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'sent'),
  ('fc000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'sent');

-- Email provider accounts
INSERT INTO email_provider_accounts (id, organization_id, provider, label, credentials_secret_id) VALUES
  ('fd000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'postmark', 'Postmark A', 'postmark-secret-a'),
  ('fd000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'postmark', 'Postmark B', 'postmark-secret-b');
INSERT INTO email_addresses (id, provider_account_id, organization_id, email_address) VALUES
  ('fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'a@inbox.example'),
  ('fe000000-0000-4000-8000-000000000002', 'fd000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'b@inbox.example');
INSERT INTO email_delivery_events (id, message_id, status) VALUES
  ('ff000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'sent'),
  ('ff000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'sent');

-- AI settings + decisions
INSERT INTO ai_settings (id, organization_id) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');
INSERT INTO ai_decisions (id, conversation_id, organization_id, decision_type, confidence) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'respond', 0.85),
  ('e2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'respond', 0.85);

-- Knowledge
INSERT INTO knowledge_documents (id, organization_id, title, source_type, body, status) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A doc', 'faq', 'A body', 'ready'),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'B doc', 'faq', 'B body', 'ready');
INSERT INTO knowledge_chunks (id, document_id, organization_id, content, embedding) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A chunk', (SELECT ('[' || array_to_string(array_agg(0), ',') || ']')::vector FROM generate_series(1, 1536))),
  ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'B chunk', (SELECT ('[' || array_to_string(array_agg(0), ',') || ']')::vector FROM generate_series(1, 1536)));

-- Support jobs
INSERT INTO support_jobs (id, organization_id, job_type, status) VALUES
  ('aa000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'inbound_message', 'pending'),
  ('aa000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'inbound_message', 'pending');

-- Audit logs (1 per org)
INSERT INTO audit_logs (id, organization_id, actor_type, action, resource_type, resource_id) VALUES
  ('ab000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'user', 'org_a_action', 'test', 'a'),
  ('ab000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'user', 'org_b_action', 'test', 'b');
EOSQL

echo "==> RLS test DB ready: $DBNAME"
echo "DBNAME=$DBNAME"
echo "export RLS_TEST_DB=$DBNAME"
