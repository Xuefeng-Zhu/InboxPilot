import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../insforge/migrations/021_monotonic_delivery_status.sql', import.meta.url),
  'utf8',
);

function functionDefinition(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing SQL function ${name}`);
  const end = migration.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated SQL function ${name}`);
  return migration.slice(start, end + 4);
}

describe('monotonic delivery status migration', () => {
  it('normalizes legacy nulls before making the snapshot non-null', () => {
    expect(migration).toContain("delivery_status = 'pending'");
    expect(migration).toContain('WHERE delivery_status IS NULL');
    expect(migration).toContain('ALTER COLUMN delivery_status SET NOT NULL');
  });

  it('allows every forward nonterminal and direct terminal transition', () => {
    const fn = functionDefinition('advance_message_delivery_status');
    expect(fn).toContain(
      "message.delivery_status = 'pending'\n        AND p_delivery_status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')",
    );
    expect(fn).toContain(
      "message.delivery_status = 'queued'\n        AND p_delivery_status IN ('sent', 'delivered', 'failed', 'bounced')",
    );
    expect(fn).toContain(
      "message.delivery_status = 'sent'\n        AND p_delivery_status IN ('delivered', 'failed', 'bounced')",
    );
  });

  it.each(['delivered', 'failed', 'bounced'])(
    'never updates a terminal %s snapshot',
    (terminalStatus) => {
      const fn = functionDefinition('advance_message_delivery_status');
      const updatePredicate = fn.slice(
        fn.indexOf('UPDATE public.messages AS message'),
        fn.indexOf('RETURNING message.* INTO effective_message;'),
      );
      expect(updatePredicate).not.toContain(`message.delivery_status = '${terminalStatus}'`);
    },
  );

  it('returns the effective row even when an incoming callback is ignored', () => {
    const fn = functionDefinition('advance_message_delivery_status');
    expect(fn).toContain('IF effective_message.id IS NULL THEN');
    expect(fn).toContain('WHERE message.id = p_message_id');
    expect(fn).toContain('RETURN NEXT effective_message');
  });

  it('exposes the atomic mutation only to the trusted server role', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO project_admin');
  });
});
