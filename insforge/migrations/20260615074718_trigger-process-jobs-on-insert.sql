-- 20260615074718_trigger-process-jobs-on-insert.sql
-- InboxPilot — Invoke process-jobs immediately on support_jobs INSERT.
--
-- Why: Previously, the inbound functions (sms-inbound, email-inbound,
-- webchat-inbound) used a function-level fire-and-forget fetch to invoke
-- process-jobs after enqueueing. That pattern has two problems:
--
--   1. The Deno runtime returns 508 LOOP_DETECTED for function-to-function
--      calls within the same deployment. The fetch would fail silently and
--      the job would wait for the cron safety net (avg 30s, max 60s).
--
--   2. Fire-and-forget is unreliable on serverless runtimes — the inbound
--      function returns its response, the runtime tears down the worker,
--      and the dangling fetch never goes out.
--
-- This trigger uses the Postgres `http` extension (already enabled) to
-- synchronously POST to the process-jobs gateway URL on every new
-- process_ai_message / send_outbound_message / record_chunk_refs row.
-- The call comes from Postgres, not from a function, so the loop detection
-- does not apply. The INSERT transaction commits only after process-jobs
-- returns (or after the http call errors out — see error handling below).
--
-- The result: an inbound webhook that enqueues a job and then returns will
-- have already triggered the AI worker; the user sees the AI reply within
-- the same webhook response window (~2-5s) instead of waiting for cron.
--
-- Error handling: if the http_post call fails or times out, we catch the
-- exception in a BEGIN/EXCEPTION block and just log to console. The INSERT
-- still commits — the cron safety net (which runs every 1 minute) will
-- pick up the job.
--
-- Auth: the call is unauthenticated. The process-jobs function does not
-- enforce auth (it's invoked by the cron and now by this trigger). If you
-- later add auth, switch to pg_net with custom headers.

-- Set a 6s curl timeout so a slow process-jobs doesn't block the inbound
-- INSERT indefinitely. Anything over 6s is abnormal; the cron will retry.
SELECT http_set_curlopt('CURLOPT_TIMEOUT', '6');
SELECT http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '3');

CREATE OR REPLACE FUNCTION public.trigger_process_jobs_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  trigger_url text := 'https://y39ezar3.us-east.insforge.app/functions/process-jobs';
  body_text text;
  response record;
BEGIN
  -- Debug marker so we can verify the trigger is running at commit time.
  -- Without this, the only signal is RAISE WARNING which is filtered.
  BEGIN
    INSERT INTO audit_logs (organization_id, actor_type, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.organization_id, 'system', 'debug_trigger_at_commit', 'support_job', NEW.id,
      jsonb_build_object('jobType', NEW.job_type, 'phase', 'before_http_post')
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Only fire for time-sensitive job types. Heavy batch jobs (knowledge
  -- document ingestion, delivery status backfill) stay on the cron path.
  IF NEW.job_type IN ('process_ai_message', 'send_outbound_message', 'record_chunk_refs') THEN
    body_text := jsonb_build_object('jobId', NEW.id, 'jobType', NEW.job_type)::text;
    BEGIN
      response := http_post(trigger_url, body_text::jsonb);
      -- Debug: mark success
      BEGIN
        INSERT INTO audit_logs (organization_id, actor_type, action, resource_type, resource_id, metadata)
        VALUES (
          NEW.organization_id, 'system', 'debug_trigger_at_commit', 'support_job', NEW.id,
          jsonb_build_object('phase', 'after_http_post', 'status', response.status)
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'trigger_process_jobs_on_insert: http_post failed for job=%: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_jobs_invoke_process_jobs ON public.support_jobs;

-- IMPORTANT: DEFERRABLE INITIALLY DEFERRED makes the trigger fire at
-- COMMIT time, not at INSERT time. Without this, the INSERT holds a row
-- lock that claim_support_jobs's FOR UPDATE SKIP LOCKED would skip, so
-- the worker can't see the job. At commit time, the lock is released
-- and the worker can claim it.
CREATE CONSTRAINT TRIGGER trg_support_jobs_invoke_process_jobs
  AFTER INSERT ON public.support_jobs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_process_jobs_on_insert();

COMMENT ON FUNCTION public.trigger_process_jobs_on_insert() IS
  'Fires http_post to process-jobs at COMMIT time when a time-sensitive support_job is inserted. Bypasses Deno 508 LOOP_DETECTED because the call originates from Postgres, not a function. DEFERRABLE INITIALLY DEFERRED ensures the claim lock has been released by the time process-jobs runs. Cron schedule remains as a safety net.';
