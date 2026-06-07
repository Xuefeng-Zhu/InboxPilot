-- 005_analytics_aggregation.sql
-- InboxPilot AI Customer Support Platform — Analytics Aggregation RPC
-- Closes HIGH-8 from docs/QA_BUG_HUNT.md.
--
-- Background (HIGH-8):
--   app/analytics/page.tsx used to issue two unbounded-then-truncated
--   queries against the conversations and messages tables:
--     1) conversations: select ... .gte('created_at', startIso).limit(10000)
--        → SQL filtered only on start_date, end_date was filtered in JS,
--          with >10k rows the totals were silently wrong.
--     2) messages: select ... .in('conversation_id', convIds.slice(0, 100))
--          .limit(5000)
--        → response-time average was computed over the FIRST 100
--          conversations and the first 5k messages; the rest were
--          silently dropped.
--
-- This migration adds a single server-side aggregation function,
-- `analytics_overview(p_organization_id, p_start, p_end)`, that returns
-- the same metrics the page used to compute in JS — but computed over
-- the FULL filtered set in SQL, with both gte AND lte date bounds
-- enforced server-side. The response-time calc uses LAG() to pair each
-- inbound message with the next outbound reply in the same conversation,
-- which is the standard SQL way to express "time to first reply" and is
-- bounded by the conversation, not by a JS slice.
--
-- Security: SECURITY INVOKER (default) so the RLS policies on the
-- underlying tables (003_rls_policies.sql) still apply. A caller who
-- is not a member of p_organization_id gets 0 rows / empty metrics
-- (the same result shape as "no data in the period"), which matches
-- the existing convention in 002_rpc_functions.sql.
--
-- Performance: a covering index on (organization_id, created_at) on
-- `conversations` already exists as `idx_conversations_org_last_message`
-- (001_initial_schema.sql:79), and `idx_messages_conversation_created`
-- (004_perf_indexes.sql) backs the response-time LAG walk. The ai_state
-- filter uses a partial scan, the status group by is small (4 values).
-- All aggregations are bounded by p_start..p_end in SQL.

-- =============================================================================
-- analytics_overview
-- Returns counts grouped by status, AI auto-reply rate, and the average
-- time between an inbound message and the next outbound message in the
-- same conversation, all restricted to the given organization and
-- [p_start, p_end] date range (inclusive on both ends).
--
-- Args:
--   p_organization_id  uuid    — the org the caller is querying
--   p_start            timestamptz — inclusive lower bound on
--                                   conversation.created_at
--   p_end              timestamptz — inclusive upper bound on
--                                   conversation.created_at
--
-- Returns: one row, one column (metrics jsonb). The single-row shape
-- keeps the RPC idempotent and avoids a pagination concern in the
-- caller.
-- =============================================================================

CREATE OR REPLACE FUNCTION analytics_overview(
  p_organization_id uuid,
  p_start           timestamptz,
  p_end             timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $fn_analytics$
DECLARE
  v_total              bigint := 0;
  v_open               bigint := 0;
  v_resolved           bigint := 0;
  v_escalated          bigint := 0;
  v_pending            bigint := 0;
  v_ai_processed       bigint := 0;
  v_ai_auto_replied    bigint := 0;
  v_avg_response_ms    double precision := null;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Status counts + AI rate.
  --    Single scan: conversations with created_at in [p_start, p_end]
  --    AND organization_id = p_organization_id. RLS still applies
  --    (SECURITY INVOKER), so a caller who is not a member of the org
  --    will get 0 rows here.
  -- ---------------------------------------------------------------------------
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE status = 'open')::bigint,
    count(*) FILTER (WHERE status = 'resolved')::bigint,
    count(*) FILTER (WHERE status = 'escalated')::bigint,
    count(*) FILTER (WHERE status = 'pending')::bigint,
    count(*) FILTER (
      WHERE ai_state IN ('auto_replied', 'drafted', 'needs_human')
    )::bigint,
    count(*) FILTER (WHERE ai_state = 'auto_replied')::bigint
  INTO
    v_total, v_open, v_resolved, v_escalated, v_pending,
    v_ai_processed, v_ai_auto_replied
  FROM conversations
  WHERE organization_id = p_organization_id
    AND created_at >= p_start
    AND created_at <= p_end;

  -- ---------------------------------------------------------------------------
  -- 2) Average response time.
  --    For each inbound message whose conversation is in the period AND
  --    belongs to p_organization_id, find the next outbound message in
  --    the same conversation and take the difference. AVG over the
  --    matched pairs. LAG() with a PARTITION walks messages in
  --    created_at order within a conversation; the standard "time to
  --    first reply" pattern pairs an inbound row with the next row that
  --    is outbound in the same conversation. We use a self-join via
  --    DISTINCT ON rather than LAG() because LAG would force a synthetic
  --    row for every non-inbound message; the self-join version is
  --    bounded by the number of inbound rows in the period.
  --
  --    This is the SQL analog of the buggy JS in
  --    app/analytics/page.tsx:138-156 and runs over EVERY conversation
  --    in the period, not the first 100, and EVERY message in those
  --    conversations up to the period end, not the first 5,000.
  -- ---------------------------------------------------------------------------
  SELECT avg(extract(epoch from (outbound.created_at - inbound.created_at)) * 1000.0)
    INTO v_avg_response_ms
  FROM (
    SELECT DISTINCT ON (m.conversation_id, m.created_at)
      m.id            AS message_id,
      m.conversation_id,
      m.created_at
    FROM messages m
    JOIN conversations c
      ON c.id = m.conversation_id
    WHERE c.organization_id = p_organization_id
      AND c.created_at >= p_start
      AND c.created_at <= p_end
      AND m.direction = 'inbound'
    ORDER BY m.conversation_id, m.created_at
  ) inbound
  JOIN LATERAL (
    SELECT m2.created_at
    FROM messages m2
    WHERE m2.conversation_id = inbound.conversation_id
      AND m2.direction = 'outbound'
      AND m2.created_at > inbound.created_at
    ORDER BY m2.created_at ASC
    LIMIT 1
  ) outbound ON true;

  -- ---------------------------------------------------------------------------
  -- 3) Bundle into one row. Use jsonb_build_object so the response
  --    shape is stable and the JS caller can destructure by name.
  --    aiAutoReplyRate is null when no AI-processed conversations
  --    exist in the period, matching the page's existing
  --    "null → em-dash" convention.
  -- ---------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'totalConversations',      v_total,
    'openConversations',       v_open,
    'resolvedConversations',   v_resolved,
    'escalatedConversations',  v_escalated,
    'pendingConversations',    v_pending,
    'aiProcessedConversations', v_ai_processed,
    'aiAutoRepliedConversations', v_ai_auto_replied,
    'aiAutoReplyRate',
      CASE
        WHEN v_ai_processed > 0
        THEN v_ai_auto_replied::float / v_ai_processed::float
        ELSE null
      END,
    'averageResponseTimeMs',   v_avg_response_ms
  );
END;
$fn_analytics$;

-- =============================================================================
-- @down
-- Drop the analytics function. IF EXISTS guards against partial-rollback
-- replays. There are no other objects added by this migration.
-- =============================================================================
DROP FUNCTION IF EXISTS public.analytics_overview(uuid, timestamptz, timestamptz);
-- @end
