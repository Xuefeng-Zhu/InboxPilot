-- Backfill conversation activity timestamps so inbox pagination can order rows reliably.
-- Conversations with messages use their latest message timestamp; empty conversations
-- fall back to their own creation timestamp.

WITH latest_messages AS (
  SELECT conversation_id, max(created_at) AS latest_message_at
  FROM messages
  GROUP BY conversation_id
)
UPDATE conversations AS conversations
SET
  last_message_at = latest_messages.latest_message_at,
  updated_at = now()
FROM latest_messages
WHERE conversations.id = latest_messages.conversation_id
  AND (
    conversations.last_message_at IS NULL
    OR conversations.last_message_at < latest_messages.latest_message_at
  );

UPDATE conversations
SET
  last_message_at = created_at,
  updated_at = now()
WHERE last_message_at IS NULL;
