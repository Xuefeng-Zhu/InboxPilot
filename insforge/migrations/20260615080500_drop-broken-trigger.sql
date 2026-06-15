-- 20260615080500_drop-broken-trigger.sql
-- Drops the trigger that fires http_post on every support_jobs insert. The
-- http extension is unreliable in this project (returns NULL content), so
-- the trigger is a no-op that adds latency. The cron schedule (now 10s
-- cadence) handles job processing.

DROP TRIGGER IF EXISTS trg_support_jobs_invoke_process_jobs ON public.support_jobs;
DROP FUNCTION IF EXISTS public.trigger_process_jobs_on_insert();
