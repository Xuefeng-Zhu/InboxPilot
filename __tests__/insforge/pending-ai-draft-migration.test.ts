import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../insforge/migrations/020_bind_pending_ai_drafts.sql', import.meta.url),
  'utf8',
);

function functionDefinition(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing SQL function ${name}`);
  const end = migration.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated SQL function ${name}`);
  return migration.slice(start, end + 4);
}

describe('pending AI draft binding migration', () => {
  it('binds draft state to one decision and clears it on unrelated transitions', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS pending_ai_decision_id uuid');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS sending_ai_decision_id uuid');
    expect(migration).toContain('conversations_ai_draft_owner_state_check');
    expect(migration).toContain("ai_state = 'thinking' AND pending_ai_decision_id IS NULL");
    expect(migration).toContain('AFTER INSERT ON public.ai_decisions');
    expect(migration).toContain('THEN NEW.id');
    expect(migration).toContain('NEW.pending_ai_decision_id := NULL');
    expect(migration).toContain('NEW.sending_ai_decision_id := NULL');
  });

  it('publishes only the latest overall decision and serializes concurrent inserts', () => {
    const publish = functionDefinition('publish_inserted_ai_draft');

    expect(publish).toContain('FOR UPDATE');
    expect(publish).toContain('AI decision organization mismatch');
    expect(publish).toContain('AI decision message conversation mismatch');
    expect(publish).toContain('NEW.message_id = conversation.latest_message_id');
    expect(publish).toContain('NEW.response_text IS NOT NULL');
    expect(publish).toContain('NEW.requires_human = false');
    expect(publish).toContain("ELSE 'idle'");
    expect(publish).toContain('ELSE NULL');
    expect(publish).toContain("source_message.direction = 'inbound'");
    expect(publish).toContain("source_message.sender_type = 'contact'");
    expect(publish).toContain('FROM public.ai_decisions AS newer_decision');
    expect(publish).toContain('newer_decision.created_at > NEW.created_at');
    expect(publish).toContain('newer_decision.id > NEW.id');
  });

  it('backfills from the latest decision overall and normalizes invalid draft state', () => {
    const backfillStart = migration.indexOf('WITH latest_decisions AS (');
    const backfillEnd = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.claim_pending_ai_draft',
      backfillStart,
    );
    const backfill = migration.slice(backfillStart, backfillEnd);

    expect(backfill).toContain('SELECT DISTINCT ON (decision.conversation_id)');
    expect(backfill).toContain(
      'ORDER BY decision.conversation_id, decision.created_at DESC, decision.id DESC',
    );
    expect(backfill).toContain('latest.response_text IS NOT NULL');
    expect(backfill).toContain('latest.requires_human = false');
    expect(backfill).toContain("SET\n  ai_state = 'idle'");
    expect(backfill).toContain("WHERE ai_state = 'drafted'");
    expect(backfill).toContain('AND pending_ai_decision_id IS NULL');
  });

  it('claims exactly the pending decision under a server-only RPC', () => {
    const claim = functionDefinition('claim_pending_ai_draft');
    expect(claim).toContain('conversation.pending_ai_decision_id = p_ai_decision_id');
    expect(claim).toContain('sending_ai_decision_id = p_ai_decision_id');
    expect(claim).toContain('decision.message_id = conversation.latest_message_id');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO project_admin');
  });

  it('restores a failed dispatch only while the decision remains latest', () => {
    const restore = functionDefinition('restore_pending_ai_draft');
    expect(restore).toContain('conversation.pending_ai_decision_id IS NULL');
    expect(restore).toContain('conversation.sending_ai_decision_id = p_ai_decision_id');
    expect(restore).toContain('FROM public.ai_decisions AS newer_decision');
    expect(restore).toContain('newer_decision.created_at > decision.created_at');
  });

  it('finishes only the same dispatch owner so a newer thinking turn is untouched', () => {
    const finish = functionDefinition('finish_pending_ai_draft');
    expect(finish).toContain('conversation.sending_ai_decision_id = p_ai_decision_id');
    expect(finish).toContain('decision.message_id = conversation.latest_message_id');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.finish_pending_ai_draft');
  });

  it('claims regeneration and enqueues its job in one transaction', () => {
    const enqueue = functionDefinition('enqueue_regenerate_ai_draft');
    expect(enqueue).toContain('conversation.pending_ai_decision_id = p_pending_ai_decision_id');
    expect(enqueue).toContain('conversation.latest_message_id = p_source_message_id');
    expect(enqueue).toContain("'process_ai_message'");
    expect(enqueue).toContain('["operation","regenerate_ai_draft"]');
    expect(enqueue).toContain('["pendingAiDecisionId",%s]');
    expect(enqueue).toContain("'pendingAiDecisionId', p_pending_ai_decision_id::text");
    expect(enqueue).toContain('ON CONFLICT (organization_id, job_type, idempotency_key)');
  });
});
