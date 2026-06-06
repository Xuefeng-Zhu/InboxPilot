import { describe, it } from 'vitest';

/**
 * Integration tests: RLS policy — two-org isolation verification.
 *
 * These tests require a real database connection with RLS enabled and are
 * skipped in unit test runs. They verify that Row Level Security policies
 * correctly isolate data between organizations.
 */

describe('Integration: RLS Policy — Two-Org Isolation', () => {
  it.todo('user in org A cannot SELECT conversations belonging to org B');

  it.todo('user in org A cannot SELECT messages belonging to org B');

  it.todo('user in org A cannot SELECT contacts belonging to org B');

  it.todo('user in org A cannot INSERT a conversation with org B organization_id');

  it.todo('user in org A cannot UPDATE a conversation belonging to org B');

  it.todo('user in org A cannot DELETE a contact belonging to org B');

  it.todo('audit_logs table rejects UPDATE operations (append-only)');

  it.todo('audit_logs table rejects DELETE operations (append-only)');

  it.todo('credential columns in provider accounts are excluded from client queries');
});
