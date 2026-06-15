-- 008_claim_failed_jobs.sql
-- InboxPilot — Make failed jobs claimable again after backoff, and
-- add a partial index that serves both the pending and the
-- retryable-failed claim paths so the worker doesn't full-scan
-- support_jobs once failed/dead/completed rows accumulate.
--
-- PostgresJobQueue.fail() marks transient handler errors as status='failed'
-- and pushes run_after forward with exponential backoff. The original claimer
-- only selected pending jobs, so failed rows were never retried. The
-- 001 schema added a partial index over pending rows only; once failed
-- rows accumulate, the new claim path has no index to drive it. The
-- replacement index below covers both.

DROP INDEX IF EXISTS idx_support_jobs_pending;

CREATE INDEX IF NOT EXISTS idx_support_jobs_claimable
  ON support_jobs (run_after, created_at)
  WHERE status IN ('pending', 'failed');

-- The old claim_support_jobs(max_count integer) signature is dropped so the
-- CREATE OR REPLACE below can rename the parameter to claim_limit. Postgres
-- disallows renaming parameters in CREATE OR REPLACE — only the body can
-- change. This DROP is a no-op on a fresh DB; it only fires when upgrading
-- from a project that had migration 002 applied.
DROP FUNCTION IF EXISTS public.claim_support_jobs(integer);

CREATE OR REPLACE FUNCTION claim_support_jobs(claim_limit int DEFAULT 5)
RETURNS SETOF support_jobs
LANGUAGE plpgsql
SET search_path = public
AS $fn_claim$
BEGIN
  RETURN QUERY
  UPDATE support_jobs
  SET status = 'claimed', updated_at = now()
  WHERE id IN (
    SELECT sj.id FROM support_jobs sj
    WHERE sj.run_after <= now()
      AND (sj.status = 'pending' OR sj.status = 'failed')
    ORDER BY sj.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT claim_limit
  )
  RETURNING *;
END;
$fn_claim$;
