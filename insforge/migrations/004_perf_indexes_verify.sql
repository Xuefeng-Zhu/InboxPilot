-- 004_perf_indexes_verify.sql
-- Standalone harness that proves HIGH-4's fix.
-- Run order:
--   1. CREATE DATABASE inboxpilot_verify
--   2. \i 001_initial_schema.sql
--   3. \i 002_rpc_functions.sql
--   4. \i 003_rls_policies.sql
--   5. \i 004_perf_indexes.sql  -- (we'll do this AFTER the "before" EXPLAIN)
--
-- This file is a scratch script, NOT part of the migration set.
-- It is included in the PR as docs/evidence so reviewers can replay it.
-- Drop the database after running.

-- Need a real org + contact + conversation to satisfy the FK chain
-- before inserting 10k messages.
INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Verify Co', 'verify-co', now(), now())
ON CONFLICT (id) DO NOTHING;

-- InboxPilot does not have a top-level `users` table; the auth.users table
-- is managed by InsForge. Skip the user insert.

INSERT INTO contacts (id, organization_id, name,
 email,
 created_at,
 updated_at
 )
 VALUES (
 '00000000-0000-0000-0000-0000000000c1',
 '00000000-0000-0000-0000-000000000001',
 'Verify Contact',
 'verify-contact@example.com',
 now(), now()
 )
ON CONFLICT (id) DO NOTHING;

INSERT INTO conversations (id, organization_id, contact_id, status, channel, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-0000000b0001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000c1',
  'open',
  'sms',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- 10,000 messages for that conversation.
INSERT INTO messages (
  conversation_id, sender_type, direction, channel, body, created_at
)
SELECT
  '00000000-0000-0000-0000-0000000b0001',
  CASE WHEN i % 2 = 0 THEN 'contact' ELSE 'user' END,
  CASE WHEN i % 2 = 0 THEN 'inbound'  ELSE 'outbound' END,
  'sms',
  'msg ' || i,
  now() - ((10000 - i) || ' seconds')::interval
FROM generate_series(1, 10000) AS s(i);

ANALYZE messages;
SELECT count(*) AS row_count FROM messages
  WHERE conversation_id = '00000000-0000-0000-0000-0000000b0001';

-- The exact query MessageThread.tsx issues.
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT *
FROM messages
WHERE conversation_id = '00000000-0000-0000-0000-0000000b0001'
ORDER BY created_at ASC;
