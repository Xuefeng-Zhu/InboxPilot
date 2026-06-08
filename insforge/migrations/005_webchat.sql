-- 005_webchat.sql
-- Web Chat Widget: schema changes for the webchat channel.
-- Adds 'webchat' to channel CHECK constraints and creates webchat_widgets + webchat_threads tables.

-- =============================================================================
-- A. Loosen channel CHECK constraints to allow 'webchat'
-- =============================================================================

ALTER TABLE conversations DROP CONSTRAINT conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('sms', 'email', 'webchat'));

ALTER TABLE messages DROP CONSTRAINT messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('sms', 'email', 'webchat'));

-- =============================================================================
-- B. webchat_widgets — one row per configured widget per org
-- =============================================================================

CREATE TABLE webchat_widgets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  widget_token      text        NOT NULL UNIQUE,
  hmac_secret       text        NOT NULL,
  allowed_domains   text[]      NOT NULL DEFAULT '{}',
  position          text        NOT NULL DEFAULT 'bottom-right' CHECK (position IN ('bottom-right', 'bottom-left')),
  primary_color     text        DEFAULT '#2563eb',
  greeting          text,
  pre_chat_enabled  boolean     NOT NULL DEFAULT false,
  ai_mode_override  text        CHECK (ai_mode_override IN ('off', 'draft_only', 'auto_reply')),
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webchat_widgets_org ON webchat_widgets (organization_id);

-- =============================================================================
-- C. webchat_threads — one row per visitor session
-- =============================================================================

CREATE TABLE webchat_threads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  widget_id         uuid        NOT NULL REFERENCES webchat_widgets(id) ON DELETE CASCADE,
  conversation_id   uuid        NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id        uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  visitor_token_jti text        NOT NULL UNIQUE,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  identified_at     timestamptz,
  page_url          text,
  referrer          text,
  user_agent        text,
  ip_country        text,
  ip_city           text,
  metadata          jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_webchat_threads_widget_visitor ON webchat_threads (widget_id, last_seen_at DESC);
CREATE INDEX idx_webchat_threads_conversation ON webchat_threads (conversation_id);

-- =============================================================================
-- D. RLS policies for webchat tables
-- =============================================================================

ALTER TABLE webchat_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE webchat_threads ENABLE ROW LEVEL SECURITY;

-- webchat_widgets: org members can read/write their own org's widgets
CREATE POLICY webchat_widgets_select ON webchat_widgets
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY webchat_widgets_insert ON webchat_widgets
  FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY webchat_widgets_update ON webchat_widgets
  FOR UPDATE USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY webchat_widgets_delete ON webchat_widgets
  FOR DELETE USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

-- webchat_threads: org members can read/write their own org's threads
CREATE POLICY webchat_threads_select ON webchat_threads
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY webchat_threads_insert ON webchat_threads
  FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY webchat_threads_update ON webchat_threads
  FOR UPDATE USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY webchat_threads_delete ON webchat_threads
  FOR DELETE USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = current_setting('request.jwt.claims', true)::json->>'sub'));
