-- 011_ai_settings_embedding_model.sql
-- Adds embedding_model column and updates chat model default to gpt-5-mini.

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS embedding_model text
    NOT NULL DEFAULT 'openai/text-embedding-3-small';

ALTER TABLE ai_settings
  ALTER COLUMN model SET DEFAULT 'openai/gpt-5-mini';

COMMENT ON COLUMN ai_settings.embedding_model IS
  'Embedding model used for knowledge-base similarity search. Independent of `model` (chat model). Note: changing this requires re-indexing the knowledge base — similarity scores will degrade until re-embedded. See docs/known-issues/embedding-model-migration.md for details.';
