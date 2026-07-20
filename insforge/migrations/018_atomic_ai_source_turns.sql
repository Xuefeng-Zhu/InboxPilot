-- 018_atomic_ai_source_turns.sql
-- Make an inbound message's AI work linearizable with later conversation turns.
-- The latest message marker and AI-state reset are written in the same
-- transaction as each message insert. Service workers then use one guarded
-- UPDATE to claim or finalize work for an immutable inbound source message.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS latest_message_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL;

-- Apply this migration before deploying the strict worker and while scheduled
-- process-jobs invocations are paused. This lock also prevents new queue claims
-- during the migration transaction; an already-running invocation must finish
-- before migration starts.
LOCK TABLE public.support_jobs IN SHARE ROW EXCLUSIVE MODE;

-- The latest-message marker is a server-maintained integrity boundary. The
-- browser only reads these tables; all real message/conversation mutations run
-- through JWT-authorized Next.js routes or service-role functions. RLS alone
-- is not enough because the historical policies allow any organization member
-- to fabricate a message or rewrite conversation state directly.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.conversations
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.messages
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations
  TO project_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages
  TO project_admin;

-- Backfill the deterministic `(created_at, id)` latest message for existing
-- conversations before workers start relying on the marker.
UPDATE public.conversations AS conversation
SET latest_message_id = (
  SELECT message.id
  FROM public.messages AS message
  WHERE message.conversation_id = conversation.id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
)
WHERE conversation.latest_message_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_latest_message_id
  ON public.conversations (latest_message_id)
  WHERE latest_message_id IS NOT NULL;

-- Release compatibility: jobs queued by the pre-source-binding regenerate
-- route contain only a conversation ID. Bind active legacy rows to the latest
-- inbound contact message before the new worker starts enforcing messageId.
-- If an equivalent source-bound job already exists, dead-letter the legacy
-- duplicate instead of violating the active idempotency constraint or replaying
-- the same AI turn twice.
WITH legacy_job_sources AS (
  SELECT
    job.id AS job_id,
    job.organization_id,
    conversation.id AS conversation_id,
    source_message.id AS source_message_id,
    format(
      '[["conversationId",%s],["messageId",%s],["operation","regenerate_ai_draft"]]',
      to_jsonb(conversation.id::text)::text,
      to_jsonb(source_message.id::text)::text
    ) AS canonical_key
  FROM public.support_jobs AS job
  JOIN public.conversations AS conversation
    ON conversation.id::text = COALESCE(
      job.payload ->> 'conversationId',
      job.payload ->> 'conversation_id'
    )
    AND conversation.organization_id = job.organization_id
  JOIN LATERAL (
    SELECT message.id
    FROM public.messages AS message
    WHERE message.conversation_id = conversation.id
      AND message.direction = 'inbound'
      AND message.sender_type = 'contact'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS source_message ON true
  WHERE job.job_type = 'process_ai_message'
    AND job.status IN ('pending', 'claimed', 'failed')
    AND COALESCE(job.payload ->> 'messageId', job.payload ->> 'message_id') IS NULL
), duplicate_legacy_jobs AS (
  SELECT legacy.job_id
  FROM legacy_job_sources AS legacy
  WHERE
    EXISTS (
      SELECT 1
      FROM public.support_jobs AS existing
      WHERE existing.id <> legacy.job_id
        AND existing.organization_id = legacy.organization_id
        AND existing.job_type = 'process_ai_message'
        AND existing.idempotency_key = legacy.canonical_key
    )
    OR EXISTS (
      SELECT 1
      FROM legacy_job_sources AS earlier_legacy
      WHERE earlier_legacy.job_id < legacy.job_id
        AND earlier_legacy.organization_id = legacy.organization_id
        AND earlier_legacy.canonical_key = legacy.canonical_key
    )
)
UPDATE public.support_jobs AS job
SET
  status = 'dead',
  last_error = concat_ws(
    '; ',
    NULLIF(job.last_error, ''),
    'Migration 018: legacy job duplicates an existing source-bound AI job; not replayed'
  ),
  updated_at = now()
FROM duplicate_legacy_jobs AS duplicate_job
WHERE job.id = duplicate_job.job_id;

WITH legacy_job_sources AS (
  SELECT
    job.id AS job_id,
    conversation.id AS conversation_id,
    source_message.id AS source_message_id,
    format(
      '[["conversationId",%s],["messageId",%s],["operation","regenerate_ai_draft"]]',
      to_jsonb(conversation.id::text)::text,
      to_jsonb(source_message.id::text)::text
    ) AS canonical_key
  FROM public.support_jobs AS job
  JOIN public.conversations AS conversation
    ON conversation.id::text = COALESCE(
      job.payload ->> 'conversationId',
      job.payload ->> 'conversation_id'
    )
    AND conversation.organization_id = job.organization_id
  JOIN LATERAL (
    SELECT message.id
    FROM public.messages AS message
    WHERE message.conversation_id = conversation.id
      AND message.direction = 'inbound'
      AND message.sender_type = 'contact'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS source_message ON true
  WHERE job.job_type = 'process_ai_message'
    AND job.status IN ('pending', 'claimed', 'failed')
    AND COALESCE(job.payload ->> 'messageId', job.payload ->> 'message_id') IS NULL
)
UPDATE public.support_jobs AS job
SET
  payload = (job.payload - 'conversation_id' - 'message_id') || jsonb_build_object(
    'conversationId', legacy.conversation_id::text,
    'messageId', legacy.source_message_id::text
  ),
  idempotency_key = legacy.canonical_key,
  updated_at = now()
FROM legacy_job_sources AS legacy
WHERE job.id = legacy.job_id;

-- Rows that cannot be bound safely must remain visible to operators and must
-- never be interpreted as fresh work by the strict post-migration worker.
UPDATE public.support_jobs AS job
SET
  status = 'dead',
  last_error = concat_ws(
    '; ',
    NULLIF(job.last_error, ''),
    'Migration 018: legacy process_ai_message job has no valid inbound contact source; manual review required'
  ),
  updated_at = now()
WHERE job.job_type = 'process_ai_message'
  AND job.status IN ('pending', 'claimed', 'failed')
  AND COALESCE(job.payload ->> 'messageId', job.payload ->> 'message_id') IS NULL;

-- Delayed auto-reply fallback jobs must carry the same immutable source turn
-- as their AI decision. Upgrade active pre-migration jobs from that durable
-- decision link, then dead-letter rows that cannot be bound safely.
WITH fallback_sources AS (
  SELECT
    job.id AS job_id,
    decision.message_id AS source_message_id
  FROM public.support_jobs AS job
  JOIN public.ai_decisions AS decision
    ON decision.id::text = COALESCE(
      job.payload ->> 'aiDecisionId',
      job.payload ->> 'ai_decision_id'
    )
    AND decision.organization_id = job.organization_id
  JOIN public.messages AS source_message
    ON source_message.id = decision.message_id
    AND source_message.conversation_id::text = COALESCE(
      job.payload ->> 'conversationId',
      job.payload ->> 'conversation_id'
    )
    AND source_message.direction = 'inbound'
    AND source_message.sender_type = 'contact'
  WHERE job.job_type = 'send_outbound_message'
    AND job.status IN ('pending', 'claimed', 'failed')
    AND COALESCE(
      job.payload ->> 'sourceMessageId',
      job.payload ->> 'source_message_id'
    ) IS NULL
)
UPDATE public.support_jobs AS job
SET
  payload = (job.payload - 'source_message_id') || jsonb_build_object(
    'sourceMessageId', fallback.source_message_id::text
  ),
  updated_at = now()
FROM fallback_sources AS fallback
WHERE job.id = fallback.job_id;

UPDATE public.support_jobs AS job
SET
  status = 'dead',
  last_error = concat_ws(
    '; ',
    NULLIF(job.last_error, ''),
    'Migration 018: queued auto-reply has no valid inbound source; stale dispatch suppressed'
  ),
  updated_at = now()
WHERE job.job_type = 'send_outbound_message'
  AND job.status IN ('pending', 'claimed', 'failed')
  AND COALESCE(
    job.payload ->> 'sourceMessageId',
    job.payload ->> 'source_message_id'
  ) IS NULL;

CREATE OR REPLACE FUNCTION public.sync_conversation_latest_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Updating the conversation row serializes concurrent inserts. The ordered
  -- predicate prevents an older imported message from moving the marker back.
  UPDATE public.conversations AS conversation
  SET
    latest_message_id = NEW.id,
    last_message_at = NEW.created_at,
    last_message_direction = NEW.direction,
    -- A new contact/human turn, or any message that lands while AI is still
    -- thinking, cancels that in-flight work. Preserve `auto_replied` when its
    -- own AI outbound row lands because Analytics uses that durable state.
    ai_state = CASE
      WHEN conversation.ai_state = 'thinking'
        OR (NEW.direction = 'inbound' AND NEW.sender_type = 'contact')
        OR (NEW.direction = 'outbound' AND NEW.sender_type = 'user')
      THEN 'idle'
      ELSE conversation.ai_state
    END,
    updated_at = now()
  WHERE conversation.id = NEW.conversation_id
    AND (
      conversation.latest_message_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.messages AS current_message
        WHERE current_message.id = conversation.latest_message_id
          AND (current_message.created_at, current_message.id)
            <= (NEW.created_at, NEW.id)
      )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_sync_conversation_latest ON public.messages;
CREATE TRIGGER trg_messages_sync_conversation_latest
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_conversation_latest_message();

-- Reconcile once after trigger installation. This closes the deployment
-- window in which a message could have committed after the first backfill but
-- before the trigger existed; future inserts are maintained transactionally.
WITH latest_messages AS (
  SELECT DISTINCT ON (message.conversation_id)
    message.conversation_id,
    message.id,
    message.created_at,
    message.direction,
    message.sender_type
  FROM public.messages AS message
  ORDER BY message.conversation_id, message.created_at DESC, message.id DESC
)
UPDATE public.conversations AS conversation
SET
  latest_message_id = latest.id,
  last_message_at = latest.created_at,
  last_message_direction = latest.direction,
  ai_state = CASE
    WHEN conversation.ai_state = 'thinking'
      OR (latest.direction = 'inbound' AND latest.sender_type = 'contact')
      OR (latest.direction = 'outbound' AND latest.sender_type = 'user')
    THEN 'idle'
    ELSE conversation.ai_state
  END,
  updated_at = now()
FROM latest_messages AS latest
WHERE latest.conversation_id = conversation.id
  AND conversation.latest_message_id IS DISTINCT FROM latest.id;

-- Atomically claim/finalize AI work only while the immutable source message is
-- still the conversation's latest turn. The conversation-row lock shared with
-- the insert trigger gives a deterministic order:
--   * transition first -> reply intent precedes the later message;
--   * message first -> this transition returns false and performs no write.
CREATE OR REPLACE FUNCTION public.transition_ai_source_turn(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_source_message_id uuid,
  p_ai_state text,
  p_status text DEFAULT NULL,
  p_expected_ai_state text DEFAULT NULL,
  p_expected_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  transitioned_id uuid;
BEGIN
  IF p_ai_state NOT IN (
    'idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed'
  ) THEN
    RAISE EXCEPTION 'invalid AI state %', p_ai_state
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'resolved', 'escalated') THEN
    RAISE EXCEPTION 'invalid conversation status %', p_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_expected_ai_state IS NOT NULL AND p_expected_ai_state NOT IN (
    'idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed'
  ) THEN
    RAISE EXCEPTION 'invalid expected AI state %', p_expected_ai_state
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_expected_status IS NOT NULL AND p_expected_status NOT IN (
    'open', 'resolved', 'escalated'
  ) THEN
    RAISE EXCEPTION 'invalid expected conversation status %', p_expected_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.conversations AS conversation
  SET
    ai_state = p_ai_state,
    status = COALESCE(p_status, conversation.status),
    updated_at = now()
  WHERE conversation.id = p_conversation_id
    AND conversation.organization_id = p_organization_id
    AND conversation.latest_message_id = p_source_message_id
    AND (p_expected_ai_state IS NULL OR conversation.ai_state = p_expected_ai_state)
    AND (p_expected_status IS NULL OR conversation.status = p_expected_status)
    AND EXISTS (
      SELECT 1
      FROM public.messages AS source_message
      WHERE source_message.id = p_source_message_id
        AND source_message.conversation_id = conversation.id
        AND source_message.direction = 'inbound'
        AND source_message.sender_type = 'contact'
    )
  RETURNING conversation.id INTO transitioned_id;

  RETURN transitioned_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_ai_source_turn(
  uuid, uuid, uuid, text, text, text, text
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_ai_source_turn(
  uuid, uuid, uuid, text, text, text, text
)
  TO project_admin;
