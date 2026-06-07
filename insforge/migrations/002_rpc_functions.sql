-- 002_rpc_functions.sql
-- InboxPilot AI Customer Support Platform — RPC Functions
-- Creates match_knowledge_chunks (pgvector cosine similarity search)
-- and claim_support_jobs (atomic job claiming with SELECT FOR UPDATE SKIP LOCKED).

-- =============================================================================
-- match_knowledge_chunks
-- Accepts a query embedding vector and organization ID, returns the top
-- matching knowledge chunks ranked by cosine similarity using pgvector.
-- Requirements: 10.5
-- =============================================================================

CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_org_id uuid,
  match_limit int DEFAULT 5,
  match_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql AS $fn_match$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kc.content,
    kc.metadata,
    (1 - (kc.embedding <=> query_embedding))::float AS similarity
  FROM knowledge_chunks kc
  WHERE kc.organization_id = match_org_id
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_limit;
END;
$fn_match$;

-- =============================================================================
-- claim_support_jobs
-- Atomically claims up to N pending jobs whose run_after has passed, using
-- SELECT FOR UPDATE SKIP LOCKED to avoid contention between concurrent workers.
-- Requirements: 13.2
-- =============================================================================

CREATE OR REPLACE FUNCTION claim_support_jobs(
  claim_limit int DEFAULT 5
)
RETURNS SETOF support_jobs
LANGUAGE plpgsql AS $fn_claim$
BEGIN
  RETURN QUERY
  UPDATE support_jobs
  SET status = 'claimed', updated_at = now()
  WHERE id IN (
    SELECT sj.id FROM support_jobs sj
    WHERE sj.status = 'pending'
      AND sj.run_after <= now()
    ORDER BY sj.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT claim_limit
  )
  RETURNING *;
END;
$fn_claim$;

-- =============================================================================
-- @down
-- Drop the two RPC functions added by this migration. IF EXISTS guards
-- against the case where a previous partial rollback already removed one.
-- =============================================================================
DROP FUNCTION IF EXISTS public.claim_support_jobs(int);
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(uuid, vector(1536), float, int);
-- @end
