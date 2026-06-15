-- 013_webchat_realtime_widget_channel.sql
--
-- Enable the per-visitor webchat realtime channel pattern so the wchat
-- iframe (loaded in a third-party site, connected via the InsForge SDK
-- Realtime client with the anon key) can subscribe to channels of the
-- form `widget:<webchat_widgets.id>:<jti>` and receive agent/AI replies
-- pushed by the `send-reply` / `approve-ai-draft` realtime broadcast.
--
-- Without this pattern, `insforge.realtime.subscribe('widget:...')` is
-- rejected by the Realtime gateway. The InsForge SDK integration guide
-- is explicit: "The frontend can only subscribe to channel names that
-- match an enabled backend channel pattern." The server-side broadcast
-- in `send-reply` (REST, service role) still publishes, but with no
-- matching pattern no client is ever admitted to the room, so visitors
-- never receive agent/AI replies in real time.
--
-- The `jti` is an unguessable UUID minted per-thread in
-- `webchat-thread-init` and stored in `webchat_threads.visitor_token_jti`,
-- so channel-name secrecy provides visitor isolation. No additional RLS
-- policy is required: the default (RLS disabled on `realtime.channels`,
-- or a permissive policy) allows the subscribe; the secrecy of `jti`
-- is the access control.

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES (
  'widget:%',
  'Per-visitor webchat thread (widget:<webchat_widgets.id>:<jti>). jti is unguessable, channel-name secrecy isolates visitors.',
  true
)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description,
    enabled = EXCLUDED.enabled;
