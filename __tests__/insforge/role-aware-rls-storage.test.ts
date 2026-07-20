import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL(
  '../../insforge/migrations/014_role_aware_rls_and_knowledge_storage.sql',
  import.meta.url,
);
const migration = readFileSync(migrationPath, 'utf8');
const knowledgeJobBindingMigration = readFileSync(
  new URL(
    '../../insforge/migrations/015_bind_knowledge_jobs_to_documents.sql',
    import.meta.url,
  ),
  'utf8',
);
const legacyAccessCleanupMigration = readFileSync(
  new URL(
    '../../insforge/migrations/017_lock_down_legacy_webchat_access.sql',
    import.meta.url,
  ),
  'utf8',
);
const knowledgeListPage = readFileSync(
  new URL('../../app/knowledge/page.tsx', import.meta.url),
  'utf8',
);
const knowledgeDetailPage = readFileSync(
  new URL('../../app/knowledge/[id]/page.tsx', import.meta.url),
  'utf8',
);
const knowledgeMutations = readFileSync(
  new URL('../../app/knowledge/mutations.ts', import.meta.url),
  'utf8',
);

describe('role-aware RLS and knowledge storage migration', () => {
  it('uses pinned SECURITY DEFINER helpers to avoid recursive membership RLS', () => {
    expect(migration).toMatch(
      /FUNCTION public\.user_has_org_role[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/,
    );
    expect(migration).toMatch(
      /FUNCTION public\.user_has_storage_org_role[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/,
    );
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.user_has_org_role(uuid, text[]) FROM PUBLIC');
  });

  it('keeps settings readable to agents but writable only by owners and admins', () => {
    expect(migration).toMatch(
      /sms_provider_accounts_select[\s\S]*ARRAY\['owner', 'admin', 'agent'\]/,
    );
    expect(migration).toMatch(
      /ai_settings_update[\s\S]*ARRAY\['owner', 'admin'\][\s\S]*WITH CHECK/,
    );
    expect(migration).toMatch(
      /webchat_widgets_delete[\s\S]*ARRAY\['owner', 'admin'\]/,
    );
  });

  it('blocks direct organization and membership privilege escalation', () => {
    expect(migration).toMatch(/organizations_insert[\s\S]*WITH CHECK \(false\)/);
    expect(migration).toContain(
      'DROP POLICY IF EXISTS org_members_insert ON public.organization_members',
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS org_members_update ON public.organization_members',
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS org_members_delete ON public.organization_members',
    );
    expect(migration).not.toContain('CREATE POLICY org_members_insert');
    expect(migration).not.toContain('CREATE POLICY org_members_update');
    expect(migration).not.toContain('CREATE POLICY org_members_delete');
  });

  it('allows every member to read knowledge while reserving writes for managers', () => {
    expect(migration).toMatch(
      /knowledge_documents_select[\s\S]*ARRAY\['owner', 'admin', 'agent', 'viewer'\]/,
    );
    expect(migration).toMatch(
      /knowledge_documents_insert[\s\S]*ARRAY\['owner', 'admin'\]/,
    );
    expect(migration).toContain("job_type = 'process_knowledge_document'");
    expect(migration).not.toContain('CREATE POLICY support_jobs_update');
  });

  it('binds browser-enqueued knowledge jobs to a document in the same organization', () => {
    expect(knowledgeJobBindingMigration).toMatch(
      /FUNCTION public\.knowledge_document_belongs_to_org[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/,
    );
    expect(knowledgeJobBindingMigration).toContain('kd.id::text = p_document_id');
    expect(knowledgeJobBindingMigration).toContain(
      'kd.organization_id = p_organization_id',
    );
    expect(knowledgeJobBindingMigration).toContain(
      "p_organization_id,\n    ARRAY['owner', 'admin']",
    );
    expect(knowledgeJobBindingMigration).toContain(
      "COALESCE(payload ->> 'documentId', payload ->> 'document_id')",
    );
    expect(knowledgeJobBindingMigration).toContain(
      'public.user_has_org_role(organization_id',
    );
  });

  it('binds client-written file keys to their document organization', () => {
    const documentPolicies = migration.slice(
      migration.indexOf('CREATE POLICY knowledge_documents_select'),
      migration.indexOf('DROP POLICY IF EXISTS knowledge_chunks_select'),
    );
    expect(documentPolicies.match(/file_key LIKE \(organization_id::text \|\| '\/documents\/%'\)/g))
      .toHaveLength(2);
    expect(documentPolicies).toContain('(file_url IS NULL AND file_key IS NULL)');
  });

  it('keeps legacy file documents editable without permitting new keyless files', () => {
    const insertPolicy = migration.slice(
      migration.indexOf('CREATE POLICY knowledge_documents_insert'),
      migration.indexOf('CREATE POLICY knowledge_documents_update'),
    );
    const updatePolicy = migration.slice(
      migration.indexOf('CREATE POLICY knowledge_documents_update'),
      migration.indexOf('CREATE POLICY knowledge_documents_delete'),
    );

    expect(migration).toContain('FUNCTION public.preserves_legacy_knowledge_file');
    expect(insertPolicy).not.toContain('preserves_legacy_knowledge_file');
    expect(updatePolicy).toContain(
      'public.preserves_legacy_knowledge_file(id, organization_id, file_url, file_key)',
    );
    expect(migration).toContain('AND kd.file_url = p_file_url');
  });

  it('stores file-only documents with an empty body so extraction failures stay failed', () => {
    expect(knowledgeMutations).toContain('body: input.document.body,');
    expect(knowledgeMutations).not.toContain("body: input.document.body || (fileName ?? ''),");
  });

  it('prevents browser audit inserts from impersonating system or AI actors', () => {
    const auditPolicy = migration.slice(
      migration.indexOf('CREATE POLICY audit_logs_insert'),
      migration.indexOf('-- F. Secret-safe client SELECT grants'),
    );
    expect(auditPolicy).toContain("ARRAY['owner', 'admin', 'agent']");
    expect(auditPolicy).not.toContain('viewer');
    expect(auditPolicy).toContain("actor_type = 'user'");
    expect(auditPolicy).toContain('actor_id = auth.uid()::text');
  });

  it('replaces broad SELECT grants with explicit secret-safe columns', () => {
    expect(migration).toContain(
      'REVOKE SELECT ON TABLE public.sms_provider_accounts FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain(
      'REVOKE SELECT ON TABLE public.email_provider_accounts FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain(
      'REVOKE SELECT ON TABLE public.webchat_widgets FROM PUBLIC, anon, authenticated',
    );

    const grantSection = migration.slice(migration.indexOf('-- F. Secret-safe client SELECT grants'));
    expect(grantSection).not.toMatch(/GRANT SELECT \([^;]*credentials_secret_id/);
    expect(grantSection).not.toMatch(/GRANT SELECT \([^;]*hmac_secret/);
  });

  it('removes legacy public webchat policies and direct thread access', () => {
    expect(legacyAccessCleanupMigration).toContain(
      'DROP POLICY IF EXISTS webchat_widgets_service_select ON public.webchat_widgets',
    );
    expect(legacyAccessCleanupMigration).toContain(
      'DROP POLICY IF EXISTS webchat_threads_service_all ON public.webchat_threads',
    );
    expect(legacyAccessCleanupMigration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.webchat_threads FROM PUBLIC, anon, authenticated',
    );
    expect(legacyAccessCleanupMigration).not.toMatch(
      /CREATE POLICY\s+webchat_threads_/,
    );
    expect(legacyAccessCleanupMigration).toContain(
      'DROP FUNCTION IF EXISTS public.debug_auth_info()',
    );
  });

  it('adds file keys and scopes storage objects to organization-prefixed paths', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS file_key text');
    expect(migration).toContain("bucket = 'knowledge-files'");
    expect(migration).toContain('(storage.foldername(key))[1]');
    expect(migration).toContain("uploaded_by = (SELECT auth.jwt() ->> 'sub')");
    expect(migration).toContain('AS RESTRICTIVE FOR INSERT TO authenticated');
    expect(migration).toMatch(
      /knowledge_files_anon_guard[\s\S]*AS RESTRICTIVE FOR ALL TO anon[\s\S]*bucket <> 'knowledge-files'/,
    );
    expect(migration).not.toMatch(/UPDATE\s+storage\.buckets/i);
  });

  it('wires upload rollback and file deletion into both knowledge screens', () => {
    expect(knowledgeMutations).toContain('file_key: fileKey');
    expect(knowledgeMutations).toContain('rollbackKnowledgeUpload(fileKey');
    expect(knowledgeMutations).toContain('removeKnowledgeFile(fileKey)');
    expect(knowledgeListPage).toContain('deleteKnowledgeDocument({');
    expect(knowledgeDetailPage).toContain('deleteKnowledgeDocument({');
  });
});
