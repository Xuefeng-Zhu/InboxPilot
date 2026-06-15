-- 012_replace_knowledge_chunks.sql
-- InboxPilot — Atomically replace all chunks for a knowledge document.
--
-- Re-indexing an existing document used to delete old chunks before inserting
-- the new embedded chunks. If the replacement insert failed, the document lost
-- its last known-good searchable chunks. This RPC keeps the delete + insert in
-- one database transaction so a failure rolls the full replacement back.

CREATE OR REPLACE FUNCTION replace_knowledge_chunks(
  p_document_id uuid,
  p_organization_id uuid,
  p_chunks jsonb
)
RETURNS SETOF knowledge_chunks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  document_org uuid;
BEGIN
  SELECT organization_id INTO document_org
  FROM knowledge_documents
  WHERE id = p_document_id;

  IF document_org IS NULL THEN
    RAISE EXCEPTION
      'replace_knowledge_chunks: knowledge document % does not exist',
      p_document_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF document_org <> p_organization_id THEN
    RAISE EXCEPTION
      'replace_knowledge_chunks: organization_id mismatch (got %, expected %)',
      p_organization_id, document_org
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  DELETE FROM knowledge_chunks
  WHERE document_id = p_document_id;

  RETURN QUERY
  INSERT INTO knowledge_chunks (
    document_id,
    organization_id,
    content,
    embedding,
    metadata
  )
  SELECT
    p_document_id,
    p_organization_id,
    chunk_row.content,
    chunk_row.embedding::text::vector(1536),
    COALESCE(chunk_row.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset(COALESCE(p_chunks, '[]'::jsonb)) AS chunk_row(
    content text,
    embedding jsonb,
    metadata jsonb
  )
  RETURNING *;
END;
$$;
