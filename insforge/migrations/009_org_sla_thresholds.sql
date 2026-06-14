-- 009_org_sla_thresholds.sql
-- InboxPilot — Add per-organization SLA chip thresholds and a denormalized
-- `last_message_direction` on conversations for the kanban split-inbox lanes.
--
-- `organizations.sla_thresholds` is jsonb (NOT NULL) with a default of
-- `{"greenMs": 300000, "amberMs": 3600000}` (5 min green, 60 min amber, else red).
-- `conversations.last_message_direction` mirrors the latest message's `direction`
-- (nullable — empty conversations keep NULL). Both columns are denormalized for
-- query performance so the kanban "Awaiting reply" lane and SLA chip do not need
-- a subquery per row.
--
-- This file is idempotent: ALTERs use `ADD COLUMN IF NOT EXISTS` (the inline
-- CHECK is part of the column definition, so it is re-applied only when the
-- column itself is created). The backfill UPDATE is guarded with
-- `IS NULL` so re-running is a safe no-op.

-- -----------------------------------------------------------------------------
-- 1. organizations.sla_thresholds
-- -----------------------------------------------------------------------------

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sla_thresholds jsonb
    NOT NULL DEFAULT '{"greenMs": 300000, "amberMs": 3600000}'::jsonb;

COMMENT ON COLUMN organizations.sla_thresholds IS
  'Per-org SLA chip thresholds in milliseconds. Default: greenMs=300000 (5min), amberMs=3600000 (60min); anything older is red. Used by the kanban inbox SLA chip.';

-- -----------------------------------------------------------------------------
-- 2. conversations.last_message_direction
-- -----------------------------------------------------------------------------

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_direction text
    CHECK (last_message_direction IN ('inbound', 'outbound') OR last_message_direction IS NULL);

COMMENT ON COLUMN conversations.last_message_direction IS
  'Direction of the most recent message on this conversation (''inbound'' from contact, ''outbound'' from user/ai/system). Nullable for empty conversations. Backfilled from messages.direction in this migration; kept in sync by InboundMessageService / OutboundMessageService. Used by the kanban ''Awaiting reply'' lane filter.';

-- -----------------------------------------------------------------------------
-- 3. Backfill last_message_direction from the most recent message per conversation
-- -----------------------------------------------------------------------------

WITH latest_message_direction AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id,
    direction
  FROM messages
  ORDER BY conversation_id, created_at DESC
)
UPDATE conversations
SET
  last_message_direction = latest_message_direction.direction,
  updated_at = now()
FROM latest_message_direction
WHERE conversations.id = latest_message_direction.conversation_id
  AND conversations.last_message_direction IS NULL;
