-- 016_job_and_ai_decision_idempotency.sql
-- Close retry and concurrency races across the asynchronous pipeline:
--   1. enforce active job and source-job decision idempotency;
--   2. quarantine abandoned claims instead of leaving them permanently stuck;
--   3. revision-guard knowledge re-indexing against newer edits; and
--   4. atomically repair the message_received audit after webhook retries.

ALTER TABLE support_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_jobs_active_idempotency
  ON support_jobs (organization_id, job_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('pending', 'claimed', 'failed');

ALTER TABLE ai_decisions
  ADD COLUMN IF NOT EXISTS source_job_id uuid
    REFERENCES support_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_decisions_source_job
  ON ai_decisions (source_job_id)
  WHERE source_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_jobs_stale_claim
  ON support_jobs (updated_at)
  WHERE status = 'claimed';

-- A full database outage can prevent both completion and quarantine writes.
-- On a later worker invocation, move abandoned claims to an operator-visible
-- dead state rather than replaying a handler whose external side effects are
-- unknown. A zero-limit health probe remains read-only.
CREATE OR REPLACE FUNCTION public.claim_support_jobs(claim_limit int DEFAULT 5)
RETURNS SETOF support_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF claim_limit > 0 THEN
    UPDATE support_jobs
    SET
      status = 'dead',
      last_error = COALESCE(last_error || '; ', '') ||
        'Claim lease expired; manual reconciliation required',
      updated_at = now()
    WHERE status = 'claimed'
      AND updated_at < now() - interval '15 minutes';
  END IF;

  RETURN QUERY
  UPDATE support_jobs
  SET status = 'claimed', updated_at = now()
  WHERE id IN (
    SELECT sj.id
    FROM support_jobs sj
    WHERE sj.run_after <= now()
      AND sj.status IN ('pending', 'failed')
    ORDER BY sj.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT claim_limit
  )
  RETURNING *;
END;
$$;

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS content_revision uuid NOT NULL DEFAULT gen_random_uuid();

-- New browser-enqueued knowledge jobs must bind to the exact document
-- revision they intend to process. Rows already queued before this migration
-- are handled safely by snapshotting the current revision in the worker.
DROP POLICY IF EXISTS support_jobs_insert ON public.support_jobs;
CREATE POLICY support_jobs_insert ON public.support_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    job_type = 'process_knowledge_document'
    AND public.user_has_org_role(organization_id, ARRAY['owner', 'admin'])
    AND public.knowledge_document_belongs_to_org(
      COALESCE(payload ->> 'documentId', payload ->> 'document_id'),
      organization_id
    )
    AND payload ->> 'revision' IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.knowledge_documents AS kd
      WHERE kd.id::text = COALESCE(payload ->> 'documentId', payload ->> 'document_id')
        AND kd.organization_id = support_jobs.organization_id
        AND kd.content_revision::text = payload ->> 'revision'
    )
  );

CREATE OR REPLACE FUNCTION public.replace_knowledge_chunks_if_revision(
  p_document_id uuid,
  p_organization_id uuid,
  p_content_revision uuid,
  p_chunks jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_org uuid;
  current_revision uuid;
BEGIN
  SELECT organization_id, content_revision
  INTO current_org, current_revision
  FROM knowledge_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF current_org IS NULL THEN
    RAISE EXCEPTION 'knowledge document % does not exist', p_document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF current_org <> p_organization_id THEN
    RAISE EXCEPTION 'knowledge document organization mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF current_revision <> p_content_revision THEN
    RETURN false;
  END IF;

  DELETE FROM knowledge_chunks WHERE document_id = p_document_id;
  INSERT INTO knowledge_chunks (
    document_id, organization_id, content, embedding, metadata
  )
  SELECT
    p_document_id,
    p_organization_id,
    chunk_row.content,
    chunk_row.embedding::text::vector(1536),
    COALESCE(chunk_row.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset(COALESCE(p_chunks, '[]'::jsonb)) AS chunk_row(
    content text,
    embedding jsonb,
    metadata jsonb
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_knowledge_chunks_if_revision(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_knowledge_chunks_if_revision(uuid, uuid, uuid, jsonb)
  TO project_admin;

CREATE OR REPLACE FUNCTION public.ensure_message_received_audit(
  p_organization_id uuid,
  p_message_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  message_org uuid;
BEGIN
  SELECT c.organization_id
  INTO message_org
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.id = p_message_id;

  IF message_org IS NULL THEN
    RAISE EXCEPTION 'message % does not exist', p_message_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF message_org <> p_organization_id THEN
    RAISE EXCEPTION 'message organization mismatch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_message_id::text, 0)
  );
  IF EXISTS (
    SELECT 1
    FROM audit_logs
    WHERE organization_id = p_organization_id
      AND action = 'message_received'
      AND resource_type = 'message'
      AND resource_id = p_message_id::text
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO audit_logs (
    organization_id,
    actor_id,
    actor_type,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    p_organization_id,
    NULL,
    'system',
    'message_received',
    'message',
    p_message_id::text,
    COALESCE(p_metadata, '{}'::jsonb)
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_message_received_audit(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_message_received_audit(uuid, uuid, jsonb)
  TO project_admin;
