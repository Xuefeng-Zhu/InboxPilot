-- 006_ai_settings_knowledge_required.sql
-- InboxPilot AI Customer Support Platform — knowledge_required flag
-- Closes HIGH-9 from docs/QA_BUG_HUNT.md.
--
-- Symptom: packages/support-core/src/services/escalation-rules.ts:157-170
-- MissingKnowledgeRule fired whenever an org had no knowledge chunks,
-- which is the day-1 state of every new tenant. That made every inbound
-- message escalate to a human agent before the LLM even got a look.
--
-- Fix: gate the rule on a new ai_settings.knowledge_required boolean,
-- defaulting to false. The LLM already handles "no knowledge" via the
-- "if you don't know, escalate" system-prompt instruction. Orgs that
-- require strict KB coverage (legal, medical, finance) can opt in
-- via the ai_settings UI.
--
-- The application code in
-- packages/support-core/src/repositories/ai-settings-repository.ts
-- already defaults a missing value to false, so a pre-migration row
-- behaves correctly even before this migration runs on its host. The
-- migration is here so fresh installs also pick up the column.

-- =============================================================================
-- Add the column with a safe default so existing rows are valid immediately.
-- =============================================================================

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS knowledge_required boolean NOT NULL DEFAULT false;

-- =============================================================================
-- Optional: a CHECK constraint that prevents NULL from sneaking in if the
-- column is ever re-added without the default. Defence in depth.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_settings_knowledge_required_not_null'
  ) THEN
    ALTER TABLE ai_settings
      ADD CONSTRAINT ai_settings_knowledge_required_not_null
      CHECK (knowledge_required IS NOT NULL);
  END IF;
END
$$;

-- =============================================================================
-- @down
-- Reverse the column add. Order: drop the CHECK first so the DROP COLUMN
-- does not have to scan the table twice.
-- =============================================================================

-- ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_knowledge_required_not_null;
-- ALTER TABLE ai_settings DROP COLUMN IF EXISTS knowledge_required;
