import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL(
  '../../insforge/migrations/014_role_aware_rls_and_knowledge_storage.sql',
  import.meta.url,
);
const migration = readFileSync(migrationPath, 'utf8');
const knowledgeListPage = readFileSync(
  new URL('../../app/knowledge/page.tsx', import.meta.url),
  'utf8',
);
const knowledgeDetailPage = readFileSync(
  new URL('../../app/knowledge/[id]/page.tsx', import.meta.url),
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

  it('binds client-written file keys to their document organization', () => {
    const documentPolicies = migration.slice(
      migration.indexOf('CREATE POLICY knowledge_documents_select'),
      migration.indexOf('DROP POLICY IF EXISTS knowledge_chunks_select'),
    );
    expect(documentPolicies.match(/file_key LIKE \(organization_id::text \|\| '\/documents\/%'\)/g))
      .toHaveLength(2);
    expect(documentPolicies).toContain('(file_url IS NULL AND file_key IS NULL)');
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
    expect(knowledgeListPage).toContain('file_key: fileKey');
    expect(knowledgeListPage).toContain('rollbackKnowledgeUpload(fileKey');
    expect(knowledgeListPage).toContain('removeKnowledgeFile(doc.file_key)');
    expect(knowledgeDetailPage).toContain('removeKnowledgeFile(doc.file_key)');
  });
});
