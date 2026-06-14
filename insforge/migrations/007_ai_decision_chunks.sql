-- 007_ai_decision_chunks.sql
-- InboxPilot — Persist which knowledge chunks grounded an AI decision.
--
-- Adds a tenant-scoped join table plus server-side validation and an
-- idempotent RPC used by the process-jobs worker. The table is append-only:
-- rows are created when an AI decision cites one or more knowledge chunks,
-- and cascades clean up links when decisions or chunks are deleted.

CREATE TABLE ai_decision_chunks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_decision_id    uuid        NOT NULL REFERENCES ai_decisions(id) ON DELETE CASCADE,
  knowledge_chunk_id uuid       NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_decision_id, knowledge_chunk_id)
);

CREATE INDEX idx_ai_decision_chunks_chunk_id
  ON ai_decision_chunks (knowledge_chunk_id);

CREATE INDEX idx_ai_decision_chunks_decision_id
  ON ai_decision_chunks (ai_decision_id);

CREATE INDEX idx_ai_decision_chunks_org_id
  ON ai_decision_chunks (organization_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE ai_decision_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_decision_chunks_select ON ai_decision_chunks
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_decision_chunks_insert ON ai_decision_chunks
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY ai_decision_chunks_delete ON ai_decision_chunks
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- No update policy: rows are append-only audit records.

-- =============================================================================
-- Trigger: derive and validate organization_id
-- =============================================================================
--
-- The denormalized organization_id must be derived from the FK targets, not
-- trusted from the client. Otherwise a caller could label a cross-tenant edge
-- with an organization they belong to and satisfy the simple RLS check.

CREATE OR REPLACE FUNCTION public.ai_decision_chunks_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  decision_org uuid;
  chunk_org    uuid;
  caller_org_match boolean;
BEGIN
  SELECT organization_id INTO decision_org
  FROM ai_decisions
  WHERE id = NEW.ai_decision_id;

  IF decision_org IS NULL THEN
    RAISE EXCEPTION
      'ai_decision_chunks: ai_decision % does not exist',
      NEW.ai_decision_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT organization_id INTO chunk_org
  FROM knowledge_chunks
  WHERE id = NEW.knowledge_chunk_id;

  IF chunk_org IS NULL THEN
    RAISE EXCEPTION
      'ai_decision_chunks: knowledge_chunk % does not exist',
      NEW.knowledge_chunk_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF decision_org <> chunk_org THEN
    RAISE EXCEPTION
      'ai_decision_chunks: cross-tenant reference rejected (decision org %, chunk org %)',
      decision_org, chunk_org
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := decision_org;
  ELSIF NEW.organization_id <> decision_org THEN
    RAISE EXCEPTION
      'ai_decision_chunks: organization_id mismatch (got %, expected %)',
      NEW.organization_id, decision_org
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Caller classification. The trigger is SECURITY DEFINER so
  -- current_user is the function owner, but session_user is the
  -- actual Postgres role of the connection — that's the signal that
  -- distinguishes the platform's admin paths from anon/user traffic.
  -- InsForge admin/API-key calls are documented to connect as
  -- "project_admin" and may not carry request.jwt.claims at all;
  -- Supabase-style service-role calls connect as "service_role".
  -- We accept either role, and the JWT-claim role is treated as a
  -- redundant fallback for any future caller whose session_user is
  -- not on the trust list but who carries a recognized claim. User
  -- JWTs still require membership in the target org, and any other
  -- shape (anon, missing role, unrecognised role) is rejected so an
  -- anon caller cannot reach the membership-skip path even if the
  -- RPC grant is ever loosened.
  IF auth.uid() IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM organization_members
      WHERE user_id = auth.uid()::text
        AND organization_id = NEW.organization_id
    ) INTO caller_org_match;

    IF NOT caller_org_match THEN
      RAISE EXCEPTION
        'ai_decision_chunks: caller is not a member of organization %',
        NEW.organization_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF session_user IN ('project_admin', 'service_role', 'postgres') THEN
    -- Trusted platform role — skip the membership check. The
    -- cross-tenant invariant in the earlier steps is the only gate.
    NULL;
  ELSIF coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
          ''
        ) IN ('service_role', 'project_admin') THEN
    -- Redundant signal: JWT claim names a trusted role even though
    -- session_user is something else (e.g. a connection pool role
    -- that has been GRANTed the function). Allow it.
    NULL;
  ELSE
    RAISE EXCEPTION
      'ai_decision_chunks: unauthenticated caller not permitted',
      NEW.organization_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_decision_chunks_validate
  BEFORE INSERT ON ai_decision_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.ai_decision_chunks_validate();

-- =============================================================================
-- RPC: idempotent worker insert
-- =============================================================================
--
-- process-jobs runs with the service-role key and calls this RPC to batch
-- insert chunk refs. ON CONFLICT makes retries safe after partial success.

CREATE OR REPLACE FUNCTION public.insert_ai_decision_chunks(
  p_ai_decision_id   uuid,
  p_organization_id  uuid,
  p_chunk_ids        uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
BEGIN
  IF p_chunk_ids IS NULL
     OR array_length(p_chunk_ids, 1) IS NULL
     OR array_length(p_chunk_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  WITH input_rows AS (
    SELECT
      p_ai_decision_id    AS ai_decision_id,
      unnest(p_chunk_ids) AS knowledge_chunk_id,
      p_organization_id   AS organization_id
  ),
  inserted AS (
    INSERT INTO ai_decision_chunks (ai_decision_id, knowledge_chunk_id, organization_id)
    SELECT ai_decision_id, knowledge_chunk_id, organization_id FROM input_rows
    ON CONFLICT (ai_decision_id, knowledge_chunk_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO inserted_count FROM inserted;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_ai_decision_chunks(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_ai_decision_chunks(uuid, uuid, uuid[]) TO project_admin;
