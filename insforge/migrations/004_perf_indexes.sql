-- 004_perf_indexes.sql
-- InboxPilot AI Customer Support Platform — Performance Indexes
-- Closes HIGH-4 from docs/QA_BUG_HUNT.md.
--
-- Hot path: components/inbox/MessageThread.tsx:59-63
--     insforge.database.from('messages')
--       .select('*')
--       .eq('conversation_id', conversationId)
--       .order('created_at', { ascending: true });
--
-- With no supporting index, Postgres does a seq scan on `messages`
-- followed by an in-memory sort. At the stated 10k-messages-per-conversation
-- design point the inbox thread is rendered after a full table scan on
-- every poll (and on every realtime event — useRealtime triggers a
-- refetch). The existing idx_messages_provider_external_id is partial
-- (only rows where provider IS NOT NULL AND external_message_id IS NOT
-- NULL) and leads with `provider`, so it cannot help this query.

-- =============================================================================
-- Composite index matching the exact query: equality on conversation_id,
-- then ASC sort on created_at so the planner can return rows already in
-- order with no Sort node above.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at ASC);

-- =============================================================================
-- ANALYZE
-- Make sure the planner has up-to-date statistics for the new index.
-- A fresh table with no analyze will sometimes still prefer seq scan.
-- =============================================================================

ANALYZE messages;

-- =============================================================================
-- @down
-- Drop the index. IF EXISTS guards against partial-rollback replays.
-- =============================================================================

DROP INDEX IF EXISTS idx_messages_conversation_created;
-- @end
