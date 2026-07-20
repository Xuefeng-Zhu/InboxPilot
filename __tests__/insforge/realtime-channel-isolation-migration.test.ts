import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'insforge/migrations/023_secure_realtime_channels.sql'),
  'utf8',
);

describe('realtime channel isolation migration', () => {
  it('enables channel RLS and scopes organization subscriptions to memberships', () => {
    expect(migration).toContain(
      'ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('CREATE POLICY inboxpilot_org_channel_subscribe');
    expect(migration).toContain("pattern = 'org:%'");
    expect(migration).toContain('realtime.channel_name()');
    expect(migration).toContain('FROM public.user_org_ids() AS organization_id');
  });

  it('preserves only valid visitor-token widget channels', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_valid_widget_realtime_channel',
    );
    expect(migration).toMatch(
      /is_valid_widget_realtime_channel[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public, pg_temp/,
    );
    expect(migration).toContain('FROM public.webchat_threads AS thread');
    expect(migration).toContain('CREATE POLICY inboxpilot_widget_channel_subscribe');
    expect(migration).toContain("pattern = 'widget:%:%'");
  });

  it('keeps browser roles subscription-only', () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON realtime\.channels\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON realtime\.messages\s+FROM PUBLIC, anon, authenticated/,
    );
  });
});
