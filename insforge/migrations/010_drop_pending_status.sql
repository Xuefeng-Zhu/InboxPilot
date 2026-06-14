-- Migration 010: Drop 'pending' from conversations.status CHECK constraint
--
-- The 'pending' value was specified in the original ConversationStatus type
-- and the initial schema (001_initial_schema.sql), but no service code ever
-- assigns it to a conversation. The state-machine diagram in
-- docs/reference/architecture.md shows an unlabeled Open → Pending edge;
-- the implemented 3-state model (open / resolved / escalated, with ai_state
-- carrying agent activity) is the de facto behavior. The Stitch UI redesign
-- explicitly omitted a 'pending' color token, and the UI's "Pending" filter
-- pill always returned 0 conversations.
--
-- This migration drops the old CHECK constraint and replaces it with one
-- that does not include 'pending'. Any existing rows with status='pending'
-- (there should be none in production) would need to be remediated first.
--
-- Constraint name: Postgres auto-generates 'conversations_status_check'
-- from the inline CHECK on 001_initial_schema.sql line 67. If a prior ALTER
-- renamed it (e.g. 'conversations_status1_check'), the IF EXISTS guards
-- the DROP. If the ADD below fails because the original name persists, the
-- operator can rerun with the actual name surfaced from
-- `pg_constraint.conname` for the conversations table.

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'resolved', 'escalated'));
