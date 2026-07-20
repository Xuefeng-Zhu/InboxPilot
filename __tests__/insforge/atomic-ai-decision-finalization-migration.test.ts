import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL(
    '../../insforge/migrations/022_atomic_ai_decision_finalization.sql',
    import.meta.url,
  ),
  'utf8',
);

function functionDefinition(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing SQL function ${name}`);
  const end = migration.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated SQL function ${name}`);
  return migration.slice(start, end + 4);
}

describe('atomic AI decision finalization migration', () => {
  it('aborts before repair while a pre-migration AI worker still owns a claim', () => {
    const lockAt = migration.indexOf(
      'LOCK TABLE public.support_jobs IN SHARE ROW EXCLUSIVE MODE',
    );
    const claimGuardAt = migration.indexOf("job.job_type = 'process_ai_message'");
    const repairAt = migration.indexOf('UPDATE public.conversations');

    expect(lockAt).toBeGreaterThan(-1);
    expect(claimGuardAt).toBeGreaterThan(lockAt);
    expect(repairAt).toBeGreaterThan(claimGuardAt);
    expect(migration).toContain("job.status = 'claimed'");
    expect(migration).toContain(
      'migration 022 requires all claimed AI jobs to finish or be recovered',
    );
    expect(migration).toContain("ERRCODE = 'object_not_in_prerequisite_state'");
  });

  it('repairs split drafts and requires every drafted state to own a decision', () => {
    expect(migration).toContain("WHERE ai_state = 'drafted'");
    expect(migration).toContain('AND pending_ai_decision_id IS NULL');
    expect(migration).toMatch(/SET\s+ai_state = 'failed'/);
    expect(migration).toContain("ai_state = 'drafted'");
    expect(migration).toContain('pending_ai_decision_id IS NOT NULL');
    expect(migration).toContain("ai_state <> 'drafted'");
  });

  it('locks and validates the source before inserting and publishing state', () => {
    const rpc = functionDefinition('finalize_ai_turn_with_decision');
    const lockAt = rpc.indexOf('FOR UPDATE;');
    const insertAt = rpc.indexOf('INSERT INTO public.ai_decisions');
    const updateAt = rpc.indexOf('UPDATE public.conversations AS conversation');

    expect(lockAt).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(lockAt);
    expect(updateAt).toBeGreaterThan(insertAt);
    expect(rpc).toContain('conversation.latest_message_id = p_source_message_id');
    expect(rpc).toContain('conversation.ai_state = p_expected_ai_state');
    expect(rpc).toContain('conversation.status = p_expected_status');
    expect(rpc).toContain('p_message_id IS DISTINCT FROM p_source_message_id');
  });

  it('publishes the exact created draft pointer and returns no row on a lost guard', () => {
    const rpc = functionDefinition('finalize_ai_turn_with_decision');

    expect(rpc).toContain('IF locked_conversation_id IS NULL THEN\n    RETURN;');
    expect(rpc).toContain("WHEN p_ai_state = 'drafted' THEN created_decision.id");
    expect(rpc).toContain('RETURN NEXT created_decision');
  });

  it('exposes finalization only to the trusted project role', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public, pg_temp');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO project_admin');
  });
});
