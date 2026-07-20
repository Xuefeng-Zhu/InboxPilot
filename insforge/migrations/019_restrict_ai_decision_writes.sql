-- 019_restrict_ai_decision_writes.sql
-- AI decisions are server-produced execution records, not member-authored
-- content. Organization membership previously allowed browser callers to
-- forge, replace, or delete a decision through PostgREST.

DROP POLICY IF EXISTS ai_decisions_insert ON public.ai_decisions;
DROP POLICY IF EXISTS ai_decisions_update ON public.ai_decisions;
DROP POLICY IF EXISTS ai_decisions_delete ON public.ai_decisions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.ai_decisions
  FROM PUBLIC, anon, authenticated;

-- Server-side Next.js routes and InsForge functions use project_admin. Keep
-- their explicit CRUD boundary while browser roles retain read-only access
-- through the existing tenant-scoped SELECT policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_decisions
  TO project_admin;
