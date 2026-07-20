import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../insforge/migrations/018_atomic_ai_source_turns.sql', import.meta.url),
  'utf8',
);

describe('atomic AI source-turn migration', () => {
  it('keeps the turn boundary server-maintained', () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.conversations\s+FROM anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.messages\s+FROM anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.conversations\s+TO project_admin/,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.messages\s+TO project_admin/,
    );
  });

  it('backfills and maintains the deterministic latest-message marker', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS latest_message_id uuid');
    expect(migration).toContain('ORDER BY message.created_at DESC, message.id DESC');
    expect(migration).toContain('AFTER INSERT ON public.messages');
    expect(migration).toContain('(current_message.created_at, current_message.id)');
    expect(migration).toContain('<= (NEW.created_at, NEW.id)');
  });

  it('cancels in-flight AI state in the same transaction as a newer message', () => {
    expect(migration).toMatch(/latest_message_id = NEW\.id,[\s\S]*conversation\.ai_state = 'thinking'/);
    expect(migration).toContain("NEW.direction = 'inbound' AND NEW.sender_type = 'contact'");
    expect(migration).toContain("NEW.direction = 'outbound' AND NEW.sender_type = 'user'");
    expect(migration).toContain('ELSE conversation.ai_state');
  });

  it('reconciles messages inserted during trigger installation', () => {
    const triggerOffset = migration.indexOf('CREATE TRIGGER trg_messages_sync_conversation_latest');
    const reconciliationOffset = migration.lastIndexOf(
      'UPDATE public.conversations AS conversation',
    );
    expect(triggerOffset).toBeGreaterThan(-1);
    expect(reconciliationOffset).toBeGreaterThan(triggerOffset);
    expect(migration).toContain('IS DISTINCT FROM');
  });

  it('guards source transitions by tenant, latest turn, and inbound identity', () => {
    expect(migration).toContain('conversation.organization_id = p_organization_id');
    expect(migration).toContain('conversation.latest_message_id = p_source_message_id');
    expect(migration).toContain("source_message.direction = 'inbound'");
    expect(migration).toContain("source_message.sender_type = 'contact'");
    expect(migration).toContain(
      'p_expected_ai_state IS NULL OR conversation.ai_state = p_expected_ai_state',
    );
    expect(migration).toContain(
      'p_expected_status IS NULL OR conversation.status = p_expected_status',
    );
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO project_admin');
  });

  it('atomically maintains activity timestamp and direction with the turn marker', () => {
    expect(migration).toMatch(
      /latest_message_id = NEW\.id,[\s\S]*last_message_at = NEW\.created_at,[\s\S]*last_message_direction = NEW\.direction/,
    );
  });

  it('upgrades active legacy jobs and dead-letters only unsafe rows', () => {
    expect(migration).toContain("job.job_type = 'process_ai_message'");
    expect(migration).toContain("job.status IN ('pending', 'claimed', 'failed')");
    expect(migration).toContain("job.payload ->> 'conversationId'");
    expect(migration).toContain("job.payload ->> 'messageId'");
    expect(migration).toContain("'messageId', legacy.source_message_id::text");
    expect(migration).toContain('idempotency_key = legacy.canonical_key');
    expect(migration).toContain('"operation","regenerate_ai_draft"');
    expect(migration).toContain('legacy job duplicates an existing source-bound AI job');
    expect(migration).toContain('legacy process_ai_message job has no valid inbound contact source');
    expect(migration).toContain("job.job_type = 'send_outbound_message'");
    expect(migration).toContain("'sourceMessageId', fallback.source_message_id::text");
    expect(migration).toContain('queued auto-reply has no valid inbound source');
  });

  it('treats completed equivalent regeneration work as a lifetime duplicate', () => {
    const duplicateCheck = migration.match(
      /FROM public\.support_jobs AS existing[\s\S]*?existing\.idempotency_key = legacy\.canonical_key[\s\S]*?\n    \)/,
    )?.[0];
    expect(duplicateCheck).toBeDefined();
    expect(duplicateCheck).not.toContain("existing.status IN ('pending', 'claimed', 'failed')");
  });
});
