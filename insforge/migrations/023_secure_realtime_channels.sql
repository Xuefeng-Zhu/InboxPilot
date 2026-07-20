-- 023_secure_realtime_channels.sql
-- Restrict organization realtime subscriptions to members of that exact
-- organization while preserving visitor-token widget channels. Browser roles
-- must not be able to publish forged realtime messages directly.

CREATE OR REPLACE FUNCTION public.is_valid_widget_realtime_channel(
  p_widget_id text,
  p_visitor_token_jti text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    p_widget_id <> ''
    AND p_visitor_token_jti <> ''
    AND EXISTS (
      SELECT 1
      FROM public.webchat_threads AS thread
      WHERE thread.widget_id::text = p_widget_id
        AND thread.visitor_token_jti = p_visitor_token_jti
    );
$$;

REVOKE ALL ON FUNCTION public.is_valid_widget_realtime_channel(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_widget_realtime_channel(text, text)
  TO anon, authenticated;

ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inboxpilot_org_channel_subscribe
  ON realtime.channels;
CREATE POLICY inboxpilot_org_channel_subscribe
  ON realtime.channels
  FOR SELECT
  TO authenticated
  USING (
    pattern = 'org:%'
    AND split_part(realtime.channel_name(), ':', 1) = 'org'
    AND split_part(realtime.channel_name(), ':', 2) IN (
      SELECT organization_id::text
      FROM public.user_org_ids() AS organization_id
    )
    AND split_part(realtime.channel_name(), ':', 3) = ''
  );

DROP POLICY IF EXISTS inboxpilot_widget_channel_subscribe
  ON realtime.channels;
CREATE POLICY inboxpilot_widget_channel_subscribe
  ON realtime.channels
  FOR SELECT
  TO anon, authenticated
  USING (
    pattern = 'widget:%:%'
    AND split_part(realtime.channel_name(), ':', 1) = 'widget'
    AND split_part(realtime.channel_name(), ':', 4) = ''
    AND public.is_valid_widget_realtime_channel(
      split_part(realtime.channel_name(), ':', 2),
      split_part(realtime.channel_name(), ':', 3)
    )
  );

-- Application publishers use the project-admin-only
-- public.publish_realtime_message RPC. Browser roles only subscribe.
REVOKE INSERT, UPDATE, DELETE ON realtime.channels
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON realtime.messages
  FROM PUBLIC, anon, authenticated;
