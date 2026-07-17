import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../insforge/migrations/016_job_and_ai_decision_idempotency.sql', import.meta.url),
  'utf8',
);

describe('job and AI-decision idempotency migration', () => {
  it('enforces one active job per tenant, type, and idempotency key', () => {
    expect(migration).toContain('idx_support_jobs_active_idempotency');
    expect(migration).toContain('(organization_id, job_type, idempotency_key)');
    expect(migration).toContain("status IN ('pending', 'claimed', 'failed')");
  });

  it('binds each AI decision to at most one source job', () => {
    expect(migration).toContain('source_job_id uuid');
    expect(migration).toContain('REFERENCES support_jobs(id) ON DELETE SET NULL');
    expect(migration).toContain('idx_ai_decisions_source_job');
  });

  it('guards knowledge chunk replacement with an immutable content revision', () => {
    expect(migration).toContain('content_revision uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(migration).toContain('replace_knowledge_chunks_if_revision');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('IF current_revision <> p_content_revision');
    expect(migration).toContain('RETURN false');
    expect(migration).toContain("payload ->> 'revision' IS NOT NULL");
    expect(migration).toContain('TO project_admin');
  });

  it('quarantines stale claims and serializes inbound audit repair', () => {
    expect(migration).toContain('idx_support_jobs_stale_claim');
    expect(migration).toContain("updated_at < now() - interval '15 minutes'");
    expect(migration).toContain('Claim lease expired; manual reconciliation required');
    expect(migration).toContain('ensure_message_received_audit');
    expect(migration).toContain('pg_advisory_xact_lock');
  });
});
