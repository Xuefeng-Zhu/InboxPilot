-- 015_bind_knowledge_jobs_to_documents.sql
-- Prevents authenticated managers from enqueueing a service-role knowledge
-- job for a document owned by another organization.

CREATE OR REPLACE FUNCTION public.knowledge_document_belongs_to_org(
  p_document_id text,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.user_has_org_role(
    p_organization_id,
    ARRAY['owner', 'admin']
  ) AND EXISTS (
    SELECT 1
    FROM public.knowledge_documents AS kd
    WHERE kd.id::text = p_document_id
      AND kd.organization_id = p_organization_id
  );
$$;

REVOKE ALL ON FUNCTION public.knowledge_document_belongs_to_org(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.knowledge_document_belongs_to_org(text, uuid) TO authenticated;

DROP POLICY IF EXISTS support_jobs_insert ON public.support_jobs;
CREATE POLICY support_jobs_insert ON public.support_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    job_type = 'process_knowledge_document'
    AND public.user_has_org_role(organization_id, ARRAY['owner', 'admin'])
    AND public.knowledge_document_belongs_to_org(
      COALESCE(payload ->> 'documentId', payload ->> 'document_id'),
      organization_id
    )
  );
