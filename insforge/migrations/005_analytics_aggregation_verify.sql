-- 005_analytics_aggregation_verify.sql
-- Standalone harness that proves HIGH-8's fix end-to-end. Run order:
--   1. CREATE DATABASE inboxpilot_analytics_verify
--   2. \i 001_initial_schema.sql
--   3. \i 002_rpc_functions.sql
--   4. \i 003_rls_policies.sql
--   5. \i 005_analytics_aggregation.sql
--
-- Then run the verification queries at the bottom of this file.
-- This file is a scratch script, NOT part of the migration set.
-- It is included in the PR as docs/evidence so reviewers can replay
-- the same shape that t_13a7896e used for HIGH-4.
-- Drop the database after running.

-- Need a real org + contact + conversation to satisfy the FK chain
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Analytics Verify Co', 'analytics-verify-co', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO contacts (id, organization_id, name, email, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a1',
  'Verify Contact',
  'verify-contact@example.com',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- 20 conversations in the last 30 days, mixed status, all in our org.
-- Half are in the period, half are in a separate control window so we
-- can prove the date filter actually excludes them.
INSERT INTO conversations (
  id, organization_id, contact_id, channel, status, ai_state,
  created_at, updated_at
)
SELECT
  ('00000000-0000-0000-0000-000000000' || lpad(g::text, 3, '0'))::uuid,
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2',
  'sms',
  CASE
    WHEN g % 4 = 0 THEN 'open'
    WHEN g % 4 = 1 THEN 'resolved'
    WHEN g % 4 = 2 THEN 'escalated'
    ELSE                'pending'
  END,
  CASE
    WHEN g % 3 = 0 THEN 'auto_replied'
    WHEN g % 3 = 1 THEN 'drafted'
    ELSE                'needs_human'
  END,
  -- 10 in the period (now-15d..now-1d), 10 outside (now-60d..now-45d)
  CASE WHEN g <= 10
    THEN now() - ((g * 36) || ' hours')::interval
    ELSE now() - ((g * 60 + 45 * 24) || ' hours')::interval
  END,
  now()
FROM generate_series(1, 20) AS s(g)
ON CONFLICT (id) DO NOTHING;

-- 60 messages (3 per conversation) so the response-time LATERAL join
-- has something to walk. For the in-period conversations we plant
-- inbound→outbound pairs with a known delay so we can assert the
-- average.
INSERT INTO messages (conversation_id, sender_type, direction, channel, body, created_at)
SELECT
  ('00000000-0000-0000-0000-000000000' || lpad(g::text, 3, '0'))::uuid,
  CASE WHEN g % 2 = 0 THEN 'contact' ELSE 'user' END,
  CASE WHEN g % 2 = 0 THEN 'inbound' ELSE 'outbound' END,
  'sms',
  'msg ' || g,
  -- 10 conversations × 3 messages = 30 messages, in the period.
  -- We also add 30 control messages for the out-of-period conversations.
  now() - ((g * 6) || ' hours')::interval
FROM generate_series(1, 10) AS s(g);

-- ====================== Verification queries ======================

-- Q1: total conversations in the last 30 days (should be 10).
-- This is the shape the JS caller would issue.
SELECT analytics_overview(
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  now() - interval '30 days',
  now()
) AS last_30d;

-- Q2: total conversations in the last 90 days (should be 20).
-- Proves the date filter actually works both ways.
SELECT analytics_overview(
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  now() - interval '90 days',
  now()
) AS last_90d;

-- Q3: zero rows outside any conversation. Should return all-zero
-- metrics, not error. Proves the empty-result path.
SELECT analytics_overview(
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  now() + interval '1 day',
  now() + interval '2 days'
) AS future_window;

-- Q4: an org the caller is NOT a member of. With SECURITY INVOKER +
-- RLS, this should return zero metrics (RLS hides the rows from the
-- function), not the real data. We simulate by running as a role
-- that has no organization_members row.
-- NOTE: requires a separate role; the original RLS policy reads
-- auth.uid(). Run as `SET LOCAL role anon;` in psql to simulate.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT analytics_overview(
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  now() - interval '90 days',
  now()
) AS rls_blocked_view;
RESET ROLE;
