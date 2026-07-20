-- 022_atomic_ai_decision_finalization.sql
-- Persist an AI decision and publish its terminal conversation state in one
-- transaction. A failed decision insert must never leave a conversation
-- advertising a draft that has no approvable pending decision.

-- The pre-022 worker commits its terminal conversation state before inserting
-- the decision. Pause every process-jobs trigger and drain active invocations
-- before this migration. The table lock blocks new claims during the migration;
-- the explicit guard prevents an already-claimed old worker from crossing the
-- stricter draft/decision boundary after it commits.
LOCK TABLE public.support_jobs IN SHARE ROW EXCLUSIVE MODE;

DO $worker_quiescence$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.support_jobs AS job
    WHERE job.job_type = 'process_ai_message'
      AND job.status = 'claimed'
  ) THEN
    RAISE EXCEPTION
      'migration 022 requires all claimed AI jobs to finish or be recovered'
      USING
        ERRCODE = 'object_not_in_prerequisite_state',
        HINT = 'Pause every process-jobs trigger, wait for active invocations, recover stale claims, and retry.';
  END IF;
END;
$worker_quiescence$;

-- Repair any split state left by a worker failure between migration 020's
-- final source transition and the following ai_decisions insert.
UPDATE public.conversations
SET
  ai_state = 'failed',
  updated_at = now()
WHERE ai_state = 'drafted'
  AND pending_ai_decision_id IS NULL;

-- A drafted conversation is valid only when it owns the exact decision that
-- can be approved. The atomic RPC below inserts that decision before setting
-- both fields in one guarded UPDATE.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_ai_draft_owner_state_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_ai_draft_owner_state_check CHECK (
    (
      (
        ai_state = 'drafted'
        AND pending_ai_decision_id IS NOT NULL
        AND sending_ai_decision_id IS NULL
      )
      OR (
        ai_state <> 'drafted'
        AND pending_ai_decision_id IS NULL
      )
    )
    AND (
      sending_ai_decision_id IS NULL
      OR (ai_state = 'thinking' AND pending_ai_decision_id IS NULL)
    )
  );

CREATE OR REPLACE FUNCTION public.finalize_ai_turn_with_decision(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_source_message_id uuid,
  p_source_job_id uuid,
  p_message_id uuid,
  p_decision_type text,
  p_confidence numeric,
  p_reasoning_summary text,
  p_response_text text,
  p_tags text[],
  p_requires_human boolean,
  p_raw_response jsonb,
  p_ai_state text,
  p_status text,
  p_expected_ai_state text,
  p_expected_status text
)
RETURNS SETOF public.ai_decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  locked_conversation_id uuid;
  created_decision public.ai_decisions%ROWTYPE;
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

  -- Lock the conversation before inserting the decision. The message insert
  -- trigger takes the same row lock, so a later customer/human turn either
  -- wins before this guard (and this function returns no row) or waits until
  -- the decision and terminal state commit together.
  SELECT conversation.id
  INTO locked_conversation_id
  FROM public.conversations AS conversation
  WHERE conversation.id = p_conversation_id
    AND conversation.organization_id = p_organization_id
    AND (
      p_source_message_id IS NULL
      OR (
        conversation.latest_message_id = p_source_message_id
        AND EXISTS (
          SELECT 1
          FROM public.messages AS source_message
          WHERE source_message.id = p_source_message_id
            AND source_message.conversation_id = conversation.id
            AND source_message.direction = 'inbound'
            AND source_message.sender_type = 'contact'
        )
      )
    )
    AND (
      p_expected_ai_state IS NULL
      OR conversation.ai_state = p_expected_ai_state
    )
    AND (
      p_expected_status IS NULL
      OR conversation.status = p_expected_status
    )
  FOR UPDATE;

  IF locked_conversation_id IS NULL THEN
    RETURN;
  END IF;

  IF p_source_message_id IS NOT NULL
    AND p_message_id IS DISTINCT FROM p_source_message_id THEN
    RAISE EXCEPTION 'AI decision message does not match its source turn'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS decision_message
    WHERE decision_message.id = p_message_id
      AND decision_message.conversation_id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'AI decision message conversation mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF p_source_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.support_jobs AS source_job
    WHERE source_job.id = p_source_job_id
      AND source_job.organization_id = p_organization_id
      AND source_job.job_type = 'process_ai_message'
  ) THEN
    RAISE EXCEPTION 'AI decision source job organization or type mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF p_ai_state = 'drafted' AND (
    p_response_text IS NULL
    OR p_requires_human
    OR p_message_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      JOIN public.messages AS source_message
        ON source_message.id = conversation.latest_message_id
        AND source_message.conversation_id = conversation.id
        AND source_message.direction = 'inbound'
        AND source_message.sender_type = 'contact'
      WHERE conversation.id = p_conversation_id
        AND source_message.id = p_message_id
    )
  ) THEN
    RAISE EXCEPTION 'drafted AI decisions require the latest inbound contact message and response text'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  INSERT INTO public.ai_decisions (
    conversation_id,
    organization_id,
    source_job_id,
    message_id,
    decision_type,
    confidence,
    reasoning_summary,
    response_text,
    tags,
    requires_human,
    raw_response
  ) VALUES (
    p_conversation_id,
    p_organization_id,
    p_source_job_id,
    p_message_id,
    p_decision_type,
    p_confidence,
    p_reasoning_summary,
    p_response_text,
    COALESCE(p_tags, '{}'::text[]),
    p_requires_human,
    p_raw_response
  )
  RETURNING * INTO created_decision;

  UPDATE public.conversations AS conversation
  SET
    ai_state = p_ai_state,
    status = COALESCE(p_status, conversation.status),
    pending_ai_decision_id = CASE
      WHEN p_ai_state = 'drafted' THEN created_decision.id
      ELSE NULL
    END,
    sending_ai_decision_id = NULL,
    updated_at = now()
  WHERE conversation.id = locked_conversation_id;

  RETURN NEXT created_decision;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ai_turn_with_decision(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, text, text[], boolean,
  jsonb, text, text, text, text
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ai_turn_with_decision(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, text, text[], boolean,
  jsonb, text, text, text, text
)
  TO project_admin;
