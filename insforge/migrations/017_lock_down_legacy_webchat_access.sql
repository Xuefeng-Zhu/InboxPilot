-- 017_lock_down_legacy_webchat_access.sql
-- Removes permissive policies and grants left behind by older deployments.
-- Trusted functions and Next.js routes use project_admin and do not require
-- direct anon/authenticated access to webchat_threads.

-- Legacy platform/service policies were not created by the tracked migrations,
-- but existed in deployed environments and combined with later policies using
-- PostgreSQL's permissive OR semantics.
DROP POLICY IF EXISTS webchat_widgets_service_select ON public.webchat_widgets;
DROP POLICY IF EXISTS webchat_threads_service_all ON public.webchat_threads;

-- Browser clients never read or mutate thread rows directly. Visitor-token
-- functions and trusted server routes own the complete thread lifecycle.
DROP POLICY IF EXISTS webchat_threads_select ON public.webchat_threads;
DROP POLICY IF EXISTS webchat_threads_insert ON public.webchat_threads;
DROP POLICY IF EXISTS webchat_threads_update ON public.webchat_threads;
DROP POLICY IF EXISTS webchat_threads_delete ON public.webchat_threads;

REVOKE ALL PRIVILEGES ON TABLE public.webchat_threads FROM PUBLIC, anon, authenticated;

-- Widget configuration is tenant-scoped by migration 014. Remove inherited
-- anonymous privileges so only its authenticated, column-safe grants remain.
REVOKE ALL PRIVILEGES ON TABLE public.webchat_widgets FROM PUBLIC, anon;

-- This untracked troubleshooting helper exposed authentication context and had
-- no application caller. Remove it instead of leaving a callable definer path.
DROP FUNCTION IF EXISTS public.debug_auth_info();
