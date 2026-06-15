-- 013_realtime_publish_and_channels.sql
--
-- Combined realtime repair:
-- 1. Enable org-scoped inbox channels used by the Inbox and Symphony UIs.
-- 2. Enable per-visitor widget channels used by the embedded webchat.
-- 3. Expose a narrow public RPC wrapper for server-side realtime publishes.
--
-- Current app code subscribes and publishes on:
--   org:<organization_id>
--   widget:<webchat_widgets.id>:<visitor_token_jti>
--
-- The native publisher is `realtime.publish(...)`, but the database RPC API
-- exposes public-schema functions only. The wrapper below replaces the stale
-- `/realtime/v1/api/broadcast` server publish path, which returns 404 on the
-- live backend. Execute is granted only to `project_admin`, the role used by
-- server-side API keys.

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES (
  'org:%',
  'Per-organization inbox events (org:<organization_id>) for new messages and conversation updates.',
  true
)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES (
  'widget:%:%',
  'Per-visitor webchat thread (widget:<webchat_widgets.id>:<jti>). jti is unguessable, channel-name secrecy isolates visitors.',
  true
)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;

CREATE OR REPLACE FUNCTION public.publish_realtime_message(
  p_channel_name text,
  p_event_name text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
BEGIN
  RETURN realtime.publish(p_channel_name, p_event_name, p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_realtime_message(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_realtime_message(text, text, jsonb) TO project_admin;
