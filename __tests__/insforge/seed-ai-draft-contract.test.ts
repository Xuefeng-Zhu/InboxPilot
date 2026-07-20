import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const seed = readFileSync(resolve(process.cwd(), 'insforge/seed.sql'), 'utf8');

describe('seed AI draft contract', () => {
  it('does not persist an unapproved AI draft as an outbound message', () => {
    expect(seed).not.toContain("'e0000000-0000-4000-8000-000000000002'");
    expect(seed).toContain('-- 5. Messages (9)');
  });

  it('publishes a newly inserted decision through the exact pending owner pointer', () => {
    expect(seed).toContain('WITH inserted_draft AS');
    expect(seed).toContain("'a2000000-0000-4000-8000-000000000001'");
    expect(seed).toContain('ON CONFLICT (id) DO NOTHING');
    expect(seed).toContain('RETURNING id');
    expect(seed).toMatch(
      /SET\s+ai_state = 'drafted',\s+pending_ai_decision_id = inserted_draft\.id/,
    );
    expect(seed).toContain('FROM inserted_draft');
  });

  it('creates the conversation in a constraint-safe state before publishing its draft', () => {
    const conversationInsert = seed.slice(
      seed.indexOf('-- 4. Conversations'),
      seed.indexOf('-- 5. Messages'),
    );

    expect(conversationInsert).toContain("'idle'");
    expect(conversationInsert).not.toContain("'drafted'");
  });
});
