/**
 * Unit tests for migration 008_credentials_column_grant.sql (CRITICAL-2 fix).
 *
 * Background
 * ----------
 * The audit at docs/RLS_AUDIT.md (parent card t_qa_rls_audit, child
 * card t_07898437) found that the column-level REVOKEs in
 * insforge/migrations/003_rls_policies.sql:418-423 are silently undone
 * by the typical InsForge bootstrap grant:
 *
 *     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
 *
 * A table-level GRANT re-grants SELECT on every column, including
 * `credentials_secret_id`. A `SELECT credentials_secret_id FROM
 * sms_provider_accounts` as the `authenticated` role then returns the
 * secret, contradicting the migration's design intent.
 *
 * The fix in 008_credentials_column_grant.sql is to:
 *   1. REVOKE the table-level client privileges on the two credential
 *      tables (undoing the bootstrap's grant for these tables only).
 *   2. Re-grant SELECT / INSERT / UPDATE at column level, on the safe
 *      columns. `credentials_secret_id` is NEVER granted to a client
 *      role.
 *
 * Why a static test
 * -----------------
 * These tests are unit-level because the project has no live DB in
 * the test runner (the integration test stub in
 * __tests__/integration/rls-policies.test.ts is all `it.todo`).
 * Instead, we parse the migration as a string and assert the SQL
 * statements have the expected shape. The same migration can be
 * re-validated end-to-end by replaying the `apply + bootstrap + probe`
 * procedure in a real DB; the static test below is the cheapest proof
 * we can run in CI.
 *
 * The test name and id follow the convention used by other P0 fix
 * tests in this repo (e.g. t_07898437 → CRITICAL-2).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the migration file relative to the test file. The migration
// lives at insforge/migrations/008_credentials_column_grant.sql; the
// test lives at packages/support-core/__tests__/unit/. So the path is
// ../../../../insforge/migrations/008_credentials_column_grant.sql.
const MIGRATION_008 = resolve(
  __dirname,
  '../../../../insforge/migrations/008_credentials_column_grant.sql',
);

const MIGRATION_003 = resolve(
  __dirname,
  '../../../../insforge/migrations/003_rls_policies.sql',
);

/**
 * Strip SQL comments so a regex looking for GRANT/REVOKE statements
 * does not get fooled by text inside a comment. We intentionally do
 * NOT strip DO bodies — migration 008 wraps most of its statements
 * in `DO $$ ... $$` blocks (for role-exists guards), and the GRANT /
 * REVOKE statements we want to assert on live inside those bodies.
 *
 * We are not trying to be a full SQL parser — we are trying to assert
 * the *outer* shape of the migration. GRANT / REVOKE keywords are
 * unambiguous in the migration's SQL.
 */
function stripComments(sql: string): string {
  let out = sql.replace(/--[^\n]*/g, '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  return out;
}

/**
 * Extract all top-level `GRANT <privileges> [(<col-list>)] ON <tbl> TO <roles>`
 * statements from the (comment-stripped) SQL. Returns one entry per
 * statement with the column list (if any) split into individual columns.
 */
function extractGrants(sql: string): Array<{
  privileges: string;
  columns: string[] | null;
  table: string;
  toRoles: string[];
}> {
  const out: Array<{
    privileges: string;
    columns: string[] | null;
    table: string;
    toRoles: string[];
  }> = [];
  // Match: GRANT <priv>[,<priv>...] [(<col>[,<col>...])] ON <tbl> TO <role>[,<role>...]
  // Tolerant of whitespace, case-insensitive on the keywords, and the
  // optional `[,] WITH GRANT OPTION` tail we don't expect in our
  // migration.
  const re =
    /\bGRANT\s+([A-Z][A-Z,\s]+?)\s*(?:\(([^\)]+)\))?\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+([A-Za-z_,\s]+?);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const privileges = m[1].trim();
    const columns = m[2]
      ? m[2].split(',').map((c) => c.trim()).filter(Boolean)
      : null;
    const table = m[3].trim();
    const toRoles = m[4]
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    out.push({ privileges, columns, table, toRoles });
  }
  return out;
}

/**
 * Same shape as extractGrants but for REVOKE statements.
 */
function extractRevokes(sql: string): Array<{
  privileges: string;
  columns: string[] | null;
  table: string;
  fromRoles: string[];
}> {
  const out: Array<{
    privileges: string;
    columns: string[] | null;
    table: string;
    fromRoles: string[];
  }> = [];
  const re =
    /\bREVOKE\s+([A-Z][A-Z,\s]+?)\s*(?:\(([^\)]+)\))?\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s+FROM\s+([A-Za-z_,\s]+?);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const privileges = m[1].trim();
    const columns = m[2]
      ? m[2].split(',').map((c) => c.trim()).filter(Boolean)
      : null;
    const table = m[3].trim();
    const fromRoles = m[4]
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    out.push({ privileges, columns, table, fromRoles });
  }
  return out;
}

describe('Migration 008 — CRITICAL-2 credential column privilege fix', () => {
  let raw: string;
  let upStripped: string;
  let upGrants: ReturnType<typeof extractGrants>;
  let upRevokes: ReturnType<typeof extractRevokes>;

  beforeAll(() => {
    raw = readFileSync(MIGRATION_008, 'utf8');
    // We assert on the *up* block only — the @down block intentionally
    // restores the bootstrap state (including the broad table-level
    // grants), so it is expected to contain the patterns we forbid in
    // the up block. Splitting the two keeps the assertions honest.
    const upMatch = raw.match(/^([\s\S]*?)--\s*@down/m);
    if (!upMatch) {
      throw new Error('migration 008 is missing the -- @down marker');
    }
    upStripped = stripComments(upMatch[1]);
    upGrants = extractGrants(upStripped);
    upRevokes = extractRevokes(upStripped);
  });

  it('migration file exists at insforge/migrations/008_credentials_column_grant.sql', () => {
    // Sanity: the path resolves and the file is non-empty.
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).toMatch(/-- 008_credentials_column_grant\.sql/);
  });

  it('REVOKEs the table-level client privileges on sms_provider_accounts and email_provider_accounts', () => {
    // The bootstrap typically grants SELECT, INSERT, UPDATE, DELETE
    // on ALL TABLES. Migration 008 must REVOKE those table-level
    // privileges on the two credential tables, otherwise the
    // column-level GRANTs below are shadowed and the bug persists.
    //
    // The REVOKEs are split across two DO blocks (one per role) so
    // each REVOKE statement targets a single role. We aggregate the
    // (table, role) pairs we found, then assert each (table, role)
    // pair is present with all four verbs.
    const tableRevokePairs = new Map<string, { revoke: typeof upRevokes[number]; roles: string[] }>();
    for (const r of upRevokes) {
      if (r.columns !== null) continue;
      if (r.table !== 'sms_provider_accounts' && r.table !== 'email_provider_accounts') continue;
      const key = r.table;
      const entry = tableRevokePairs.get(key) ?? { revoke: r, roles: [] };
      entry.roles.push(...r.fromRoles);
      tableRevokePairs.set(key, entry);
    }
    expect(
      tableRevokePairs.get('sms_provider_accounts'),
      'expected table-level REVOKE on sms_provider_accounts',
    ).toBeDefined();
    expect(
      tableRevokePairs.get('email_provider_accounts'),
      'expected table-level REVOKE on email_provider_accounts',
    ).toBeDefined();
    // All four verbs must be revoked.
    for (const [table, entry] of tableRevokePairs) {
      const privs = entry.revoke.privileges.replace(/\s+/g, '').toUpperCase();
      expect(privs, `expected SELECT revoked on ${table}`).toContain('SELECT');
      expect(privs, `expected INSERT revoked on ${table}`).toContain('INSERT');
      expect(privs, `expected UPDATE revoked on ${table}`).toContain('UPDATE');
      expect(privs, `expected DELETE revoked on ${table}`).toContain('DELETE');
      // Targets must include both client roles (possibly across multiple REVOKE statements).
      expect(
        entry.roles,
        `expected both client roles revoked on ${table}, got ${JSON.stringify(entry.roles)}`,
      ).toEqual(expect.arrayContaining(['anon', 'authenticated']));
    }
  });

  it('GRANTs column-level SELECT to anon/authenticated, with credentials_secret_id absent', () => {
    const SAFE_COLUMNS = [
      'id',
      'organization_id',
      'provider',
      'label',
      'is_active',
      'metadata',
      'created_at',
      'updated_at',
    ];

    for (const table of ['sms_provider_accounts', 'email_provider_accounts']) {
      for (const role of ['anon', 'authenticated']) {
        const columnGrants = upGrants.filter(
          (g) => g.table === table && g.toRoles.includes(role) && g.columns !== null,
        );
        // We expect at least one column-level SELECT grant for each
        // (table, role) pair. There may be multiple (one for each
        // column list, plus INSERT / UPDATE column lists).
        const selectGrants = columnGrants.filter((g) =>
          g.privileges.replace(/\s+/g, '').toUpperCase().includes('SELECT'),
        );
        expect(
          selectGrants.length,
          `expected at least one column-level SELECT grant on ${table} TO ${role}`,
        ).toBeGreaterThan(0);

        // Every column-level SELECT grant must include the safe
        // columns and MUST NOT include credentials_secret_id.
        for (const grant of selectGrants) {
          const granted = new Set(grant.columns!);
          expect(
            granted.has('credentials_secret_id'),
            `credential column must NOT be in the grant on ${table} TO ${role} (got: ${[...granted].join(', ')})`,
          ).toBe(false);
          for (const safeCol of SAFE_COLUMNS) {
            expect(
              granted.has(safeCol),
              `safe column ${safeCol} missing from SELECT grant on ${table} TO ${role}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('has NO table-level (column-less) GRANT on sms/email_provider_accounts TO anon or authenticated', () => {
    // A table-level GRANT on these tables would re-grant every column
    // including credentials_secret_id. There must be none.
    const offenders = upGrants.filter(
      (g) =>
        (g.table === 'sms_provider_accounts' ||
          g.table === 'email_provider_accounts') &&
        g.columns === null &&
        g.toRoles.some((r) => r === 'anon' || r === 'authenticated'),
    );
    expect(
      offenders,
      `unexpected table-level GRANT on credential tables: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });

  it('has NO column-level GRANT that includes credentials_secret_id TO anon or authenticated', () => {
    // Defence in depth: even if a future hand-edit accidentally
    // grants a column to a client role, the credential column must
    // never be in that list.
    const offenders = upGrants.filter(
      (g) =>
        g.columns !== null &&
        g.columns.includes('credentials_secret_id') &&
        g.toRoles.some((r) => r === 'anon' || r === 'authenticated'),
    );
    expect(
      offenders,
      `credentials_secret_id must not appear in any column-level GRANT to a client role: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });

  it('REVOKEs SELECT (credentials_secret_id) from anon and authenticated (defence in depth)', () => {
    for (const table of ['sms_provider_accounts', 'email_provider_accounts']) {
      for (const role of ['anon', 'authenticated']) {
        const matches = upRevokes.filter(
          (r) =>
            r.table === table &&
            r.fromRoles.includes(role) &&
            r.columns !== null &&
            r.columns.includes('credentials_secret_id') &&
            r.privileges.replace(/\s+/g, '').toUpperCase().includes('SELECT'),
        );
        expect(
          matches.length,
          `expected column-level REVOKE SELECT (credentials_secret_id) on ${table} FROM ${role}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('includes an @down block that restores the bootstrap state', () => {
    // The down block must re-grant the table-level privileges and the
    // credentials_secret_id column to client roles (reversing the up
    // block) so a rollback returns the DB to the pre-fix state.
    const downMatch = raw.match(/--\s*@down([\s\S]*?)--\s*@end/);
    expect(downMatch, 'expected -- @down ... -- @end block in the migration').not.toBeNull();
    const downStripped = stripComments(downMatch![1]);
    const downGrants = extractGrants(downStripped);

    // The down block should re-grant table-level SELECT, INSERT,
    // UPDATE, DELETE on each credential table to anon and authenticated.
    // Same split-across-statements pattern as the up block, so we
    // aggregate roles per table.
    const tableGrants = new Map<string, { roles: string[] }>();
    for (const g of downGrants) {
      if (g.columns !== null) continue;
      if (g.table !== 'sms_provider_accounts' && g.table !== 'email_provider_accounts') continue;
      const entry = tableGrants.get(g.table) ?? { roles: [] };
      entry.roles.push(...g.toRoles);
      tableGrants.set(g.table, entry);
    }
    for (const table of ['sms_provider_accounts', 'email_provider_accounts']) {
      const entry = tableGrants.get(table);
      expect(
        entry,
        `down block should re-grant table-level privileges on ${table}`,
      ).toBeDefined();
      expect(
        entry!.roles,
        `down block should re-grant table-level privileges on ${table} to both client roles`,
      ).toEqual(expect.arrayContaining(['anon', 'authenticated']));
    }
  });
});

describe('Migration 003 — CRITICAL-2 column-level REVOKEs are still in place', () => {
  let raw: string;
  let stripped: string;
  let revokes: ReturnType<typeof extractRevokes>;

  beforeAll(() => {
    raw = readFileSync(MIGRATION_003, 'utf8');
    stripped = stripComments(raw);
    revokes = extractRevokes(stripped);
  });

  it('still REVOKEs SELECT (credentials_secret_id) from anon and authenticated on both credential tables', () => {
    // The original migration 003 REVOKEs are kept as a documentation
    // marker (and as the fallback if migration 008 is not yet
    // applied). They are a no-op once 008 has revoked the table-level
    // grant, but they must remain in the source for grep-ability.
    for (const table of ['sms_provider_accounts', 'email_provider_accounts']) {
      for (const role of ['anon', 'authenticated']) {
        const matches = revokes.filter(
          (r) =>
            r.table === table &&
            r.fromRoles.includes(role) &&
            r.columns !== null &&
            r.columns.includes('credentials_secret_id') &&
            r.privileges.replace(/\s+/g, '').toUpperCase().includes('SELECT'),
        );
        expect(
          matches.length,
          `migration 003 should still REVOKE SELECT (credentials_secret_id) on ${table} FROM ${role}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
