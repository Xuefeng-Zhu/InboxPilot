-- 020_bind_pending_ai_drafts.sql
-- Bind the approvable draft state to one immutable AI decision. This prevents
-- an older draft from being sent after regeneration produced a newer decision.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pending_ai_decision_id uuid
    REFERENCES public.ai_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sending_ai_decision_id uuid
    REFERENCES public.ai_decisions(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_ai_draft_owner_state_check CHECK (
    (
      pending_ai_decision_id IS NULL
      OR (ai_state = 'drafted' AND sending_ai_decision_id IS NULL)
    )
    AND (
      sending_ai_decision_id IS NULL
      OR (ai_state = 'thinking' AND pending_ai_decision_id IS NULL)
    )
  );

CREATE INDEX IF NOT EXISTS idx_conversations_pending_ai_decision
  ON public.conversations (pending_ai_decision_id)
  WHERE pending_ai_decision_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_sending_ai_decision
  ON public.conversations (sending_ai_decision_id)
  WHERE sending_ai_decision_id IS NOT NULL;

-- State/status transitions performed by existing routes do not know about the
-- pointers. Clear unchanged pointers whenever those fields change. RPCs that
-- intentionally claim, restore, or finish a draft explicitly move the owner
-- between columns in the same UPDATE, so their value is preserved. Keeping a
-- separate sending owner prevents an old dispatch cleanup from touching a new
-- source-turn worker that subsequently entered the shared `thinking` state.
CREATE OR REPLACE FUNCTION public.clear_stale_pending_ai_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (
    NEW.ai_state IS DISTINCT FROM OLD.ai_state
    OR NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    IF NEW.pending_ai_decision_id IS NOT DISTINCT FROM OLD.pending_ai_decision_id THEN
      NEW.pending_ai_decision_id := NULL;
    END IF;
    IF NEW.sending_ai_decision_id IS NOT DISTINCT FROM OLD.sending_ai_decision_id THEN
      NEW.sending_ai_decision_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_clear_stale_pending_ai_draft
  ON public.conversations;
CREATE TRIGGER trg_conversations_clear_stale_pending_ai_draft
  BEFORE UPDATE OF ai_state, status, pending_ai_decision_id, sending_ai_decision_id
  ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_stale_pending_ai_draft();

-- AiAgentService first atomically finalizes the source turn as `drafted`, then
-- inserts its decision. Publishing the pointer from the insert transaction
-- avoids any state where an older pointer is approvable under the new draft.
CREATE OR REPLACE FUNCTION public.publish_inserted_ai_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  conversation_org_id uuid;
BEGIN
  -- Serialize decision publication per conversation. After a concurrent
  -- insert releases this row lock, the UPDATE below runs as a new statement
  -- and sees the committed decision before comparing `(created_at, id)`.
  SELECT conversation.organization_id
  INTO conversation_org_id
  FROM public.conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
  FOR UPDATE;

  IF conversation_org_id IS NULL THEN
    RAISE EXCEPTION 'AI decision conversation % does not exist', NEW.conversation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF conversation_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'AI decision organization mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS decision_message
    WHERE decision_message.id = NEW.message_id
      AND decision_message.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'AI decision message conversation mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  UPDATE public.conversations AS conversation
  SET
    ai_state = CASE
      WHEN NEW.response_text IS NOT NULL
        AND NEW.requires_human = false
        AND NEW.message_id = conversation.latest_message_id
        AND EXISTS (
          SELECT 1
          FROM public.messages AS source_message
          WHERE source_message.id = NEW.message_id
            AND source_message.conversation_id = NEW.conversation_id
            AND source_message.direction = 'inbound'
            AND source_message.sender_type = 'contact'
        )
      THEN conversation.ai_state
      ELSE 'idle'
    END,
    pending_ai_decision_id = CASE
      WHEN NEW.response_text IS NOT NULL
        AND NEW.requires_human = false
        AND NEW.message_id = conversation.latest_message_id
        AND EXISTS (
          SELECT 1
          FROM public.messages AS source_message
          WHERE source_message.id = NEW.message_id
            AND source_message.conversation_id = NEW.conversation_id
            AND source_message.direction = 'inbound'
            AND source_message.sender_type = 'contact'
        )
      THEN NEW.id
      ELSE NULL
    END,
    updated_at = now()
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.status = 'open'
    AND conversation.ai_state = 'drafted'
    AND conversation.sending_ai_decision_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.ai_decisions AS newer_decision
      WHERE newer_decision.conversation_id = NEW.conversation_id
        AND (
          newer_decision.created_at > NEW.created_at
          OR (
            newer_decision.created_at = NEW.created_at
            AND newer_decision.id > NEW.id
          )
        )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_decisions_publish_inserted_draft
  ON public.ai_decisions;
CREATE TRIGGER trg_ai_decisions_publish_inserted_draft
  AFTER INSERT ON public.ai_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.publish_inserted_ai_draft();

-- Backfill from the latest decision overall, then test whether that exact row
-- is sendable/current. Selecting only among sendable rows could incorrectly
-- resurrect D1 behind a newer failed, escalation, or imported D2 decision.
WITH latest_decisions AS (
  SELECT DISTINCT ON (decision.conversation_id)
    decision.id,
    decision.conversation_id,
    decision.organization_id,
    decision.message_id,
    decision.response_text,
    decision.requires_human
  FROM public.ai_decisions AS decision
  ORDER BY decision.conversation_id, decision.created_at DESC, decision.id DESC
)
UPDATE public.conversations AS conversation
SET
  pending_ai_decision_id = latest.id,
  updated_at = now()
FROM latest_decisions AS latest
JOIN public.messages AS source_message
  ON source_message.id = latest.message_id
  AND source_message.conversation_id = latest.conversation_id
  AND source_message.direction = 'inbound'
  AND source_message.sender_type = 'contact'
WHERE conversation.ai_state = 'drafted'
  AND conversation.status = 'open'
  AND latest.conversation_id = conversation.id
  AND latest.organization_id = conversation.organization_id
  AND latest.message_id = conversation.latest_message_id
  AND latest.response_text IS NOT NULL
  AND latest.requires_human = false;

-- Do not leave legacy rows advertising an unusable draft. Any drafted row
-- that could not bind to a valid latest decision becomes an explicit idle
-- state, so the UI and API agree that there is nothing to approve/regenerate.
UPDATE public.conversations
SET
  ai_state = 'idle',
  updated_at = now()
WHERE ai_state = 'drafted'
  AND pending_ai_decision_id IS NULL;

CREATE OR REPLACE FUNCTION public.claim_pending_ai_draft(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_ai_decision_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  UPDATE public.conversations AS conversation
  SET
    ai_state = 'thinking',
    pending_ai_decision_id = NULL,
    sending_ai_decision_id = p_ai_decision_id,
    updated_at = now()
  WHERE conversation.id = p_conversation_id
    AND conversation.organization_id = p_organization_id
    AND conversation.status = 'open'
    AND conversation.ai_state = 'drafted'
    AND conversation.pending_ai_decision_id = p_ai_decision_id
    AND conversation.sending_ai_decision_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.ai_decisions AS decision
      JOIN public.messages AS source_message
        ON source_message.id = decision.message_id
        AND source_message.conversation_id = conversation.id
        AND source_message.direction = 'inbound'
        AND source_message.sender_type = 'contact'
      WHERE decision.id = p_ai_decision_id
        AND decision.conversation_id = conversation.id
        AND decision.organization_id = conversation.organization_id
        AND decision.message_id = conversation.latest_message_id
        AND decision.response_text IS NOT NULL
        AND decision.requires_human = false
    )
  RETURNING conversation.id INTO claimed_id;

  RETURN claimed_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_ai_draft(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_ai_draft(uuid, uuid, uuid)
  TO project_admin;

CREATE OR REPLACE FUNCTION public.restore_pending_ai_draft(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_ai_decision_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  restored_id uuid;
BEGIN
  UPDATE public.conversations AS conversation
  SET
    ai_state = 'drafted',
    pending_ai_decision_id = p_ai_decision_id,
    sending_ai_decision_id = NULL,
    updated_at = now()
  WHERE conversation.id = p_conversation_id
    AND conversation.organization_id = p_organization_id
    AND conversation.status = 'open'
    AND conversation.ai_state = 'thinking'
    AND conversation.pending_ai_decision_id IS NULL
    AND conversation.sending_ai_decision_id = p_ai_decision_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_decisions AS decision
      JOIN public.messages AS source_message
        ON source_message.id = decision.message_id
        AND source_message.conversation_id = conversation.id
        AND source_message.direction = 'inbound'
        AND source_message.sender_type = 'contact'
      WHERE decision.id = p_ai_decision_id
        AND decision.conversation_id = conversation.id
        AND decision.organization_id = conversation.organization_id
        AND decision.message_id = conversation.latest_message_id
        AND decision.response_text IS NOT NULL
        AND decision.requires_human = false
        AND NOT EXISTS (
          SELECT 1
          FROM public.ai_decisions AS newer_decision
          WHERE newer_decision.conversation_id = decision.conversation_id
            AND newer_decision.organization_id = decision.organization_id
            AND (
              newer_decision.created_at > decision.created_at
              OR (
                newer_decision.created_at = decision.created_at
                AND newer_decision.id > decision.id
              )
            )
        )
    )
  RETURNING conversation.id INTO restored_id;

  RETURN restored_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_pending_ai_draft(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_pending_ai_draft(uuid, uuid, uuid)
  TO project_admin;

-- Finish only the exact dispatch claim created above. A newer inbound message
-- or a manual state/status transition clears sending_ai_decision_id in the
-- BEFORE UPDATE trigger. The old request then returns false instead of
-- changing the newer turn's `thinking` state.
CREATE OR REPLACE FUNCTION public.finish_pending_ai_draft(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_ai_decision_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  finished_id uuid;
BEGIN
  UPDATE public.conversations AS conversation
  SET
    ai_state = 'idle',
    pending_ai_decision_id = NULL,
    sending_ai_decision_id = NULL,
    updated_at = now()
  WHERE conversation.id = p_conversation_id
    AND conversation.organization_id = p_organization_id
    AND conversation.status = 'open'
    AND conversation.ai_state = 'thinking'
    AND conversation.pending_ai_decision_id IS NULL
    AND conversation.sending_ai_decision_id = p_ai_decision_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_decisions AS decision
      JOIN public.messages AS source_message
        ON source_message.id = decision.message_id
        AND source_message.conversation_id = conversation.id
        AND source_message.direction = 'inbound'
        AND source_message.sender_type = 'contact'
      WHERE decision.id = p_ai_decision_id
        AND decision.conversation_id = conversation.id
        AND decision.organization_id = conversation.organization_id
        AND decision.message_id = conversation.latest_message_id
    )
  RETURNING conversation.id INTO finished_id;

  RETURN finished_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_pending_ai_draft(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_pending_ai_draft(uuid, uuid, uuid)
  TO project_admin;

-- Claim regeneration and enqueue its durable job in one transaction. Approval
-- and regeneration both require the same drafted/pending decision, so only one
-- can win the conversation-row update. A lost race never leaves behind a job
-- that can later overwrite the winning flow.
CREATE OR REPLACE FUNCTION public.enqueue_regenerate_ai_draft(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_source_message_id uuid,
  p_pending_ai_decision_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  claimed_id uuid;
  regeneration_key text;
BEGIN
  UPDATE public.conversations AS conversation
  SET
    ai_state = 'thinking',
    pending_ai_decision_id = NULL,
    sending_ai_decision_id = NULL,
    updated_at = now()
  WHERE conversation.id = p_conversation_id
    AND conversation.organization_id = p_organization_id
    AND conversation.status = 'open'
    AND conversation.ai_state = 'drafted'
    AND conversation.latest_message_id = p_source_message_id
    AND conversation.pending_ai_decision_id = p_pending_ai_decision_id
    AND conversation.sending_ai_decision_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.ai_decisions AS decision
      JOIN public.messages AS source_message
        ON source_message.id = decision.message_id
        AND source_message.conversation_id = conversation.id
        AND source_message.direction = 'inbound'
        AND source_message.sender_type = 'contact'
      WHERE decision.id = p_pending_ai_decision_id
        AND decision.conversation_id = conversation.id
        AND decision.organization_id = conversation.organization_id
        AND decision.message_id = p_source_message_id
        AND decision.response_text IS NOT NULL
        AND decision.requires_human = false
    )
  RETURNING conversation.id INTO claimed_id;

  IF claimed_id IS NULL THEN
    RETURN false;
  END IF;

  regeneration_key := format(
    '[["conversationId",%s],["messageId",%s],["operation","regenerate_ai_draft"],["pendingAiDecisionId",%s]]',
    to_jsonb(p_conversation_id::text)::text,
    to_jsonb(p_source_message_id::text)::text,
    to_jsonb(p_pending_ai_decision_id::text)::text
  );

  INSERT INTO public.support_jobs (
    organization_id,
    job_type,
    payload,
    idempotency_key,
    status,
    attempts,
    max_attempts,
    run_after
  ) VALUES (
    p_organization_id,
    'process_ai_message',
    jsonb_build_object(
      'conversationId', p_conversation_id::text,
      'messageId', p_source_message_id::text,
      'pendingAiDecisionId', p_pending_ai_decision_id::text
    ),
    regeneration_key,
    'pending',
    0,
    5,
    now()
  )
  ON CONFLICT (organization_id, job_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status IN ('pending', 'claimed', 'failed')
    DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_regenerate_ai_draft(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_regenerate_ai_draft(uuid, uuid, uuid, uuid)
  TO project_admin;
