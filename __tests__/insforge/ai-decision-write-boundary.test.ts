import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../insforge/migrations/019_restrict_ai_decision_writes.sql', import.meta.url),
  'utf8',
);

describe('AI decision write boundary migration', () => {
  it('removes browser mutation policies and table privileges', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS ai_decisions_insert');
    expect(migration).toContain('DROP POLICY IF EXISTS ai_decisions_update');
    expect(migration).toContain('DROP POLICY IF EXISTS ai_decisions_delete');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.ai_decisions');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('preserves server CRUD and tenant-scoped browser reads', () => {
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_decisions',
    );
    expect(migration).toContain('TO project_admin');
    expect(migration).not.toContain('REVOKE SELECT');
  });
});
