/**
 * Integration tests: RLS Policy — Two-Org Isolation.
 *
 * These tests exercise the InboxPilot Row Level Security policies
 * against a real PostgreSQL database. They are the **only** automated
 * proof of multi-tenant isolation in the project, and they are the
 * go/no-go criterion named in `docs/LAUNCH_CHECKLIST.md` §2.1
 * ("passes on a freshly migrated database").
 *
 * History
 * -------
 * This file was a stub for months — 9 lines of `it.todo` that
 * silently passed on every CI run. The audit that opened card
 * `t_qa_rls_audit` flagged it as HIGH-1; the follow-up card
 * `t_bdab73ac` opened here is the implementation.
 *
 * What the tests assert
 * ---------------------
 * For each of the 17 tenant-scoped tables, a probe as `rls_user_a`
 * (alice, org A) targets the foreign org B's data and checks that:
 *
 *   - PROBE_SELECT_CROSS    = 0     (no cross-org rows visible)
 *   - PROBE_SELECT_OWN      = 1     (sanity: own org's data accessible)
 *   - PROBE_INSERT_CROSS    = blocked (RLS denies cross-org INSERT)
 *   - PROBE_UPDATE_CROSS    = 0     (no cross-org rows updated)
 *   - PROBE_DELETE_CROSS    = 0     (no cross-org rows deleted)
 *
 * Plus two special-case probes:
 *
 *   - audit_logs append-only: UPDATE and DELETE on own + foreign rows
 *     must affect 0 rows (RLS denies writes — no UPDATE/DELETE policy).
 *   - organizations_insert: a direct INSERT as the `authenticated` role
 *     must be blocked (the WITH CHECK (false) policy from migration 007;
 *     the only sanctioned path is the create_organization RPC).
 *   - credentials_secret_id: a SELECT on the credential column as
 *     `anon` or `authenticated` must be blocked (the column-level
 *     grant matrix from migration 008; without 008, the column is
 *     silently readable after the bootstrap's table-level grant).
 *
 * How the tests run
 * -----------------
 * The tests shell out to `psql` against a Postgres database, with
 * `SET LOCAL ROLE` and `SET LOCAL request.jwt.claims` to simulate
 * the production client. The SQL generator + driver live in
 * `scripts/rls/probe.ts` (imported here).
 *
 * Required environment:
 *
 *   RLS_TEST_DB          — name of the database to probe against
 *                          (e.g. `rls_test_dev`). If unset, the suite
 *                          skips with a clear message — vitest still
 *                          exits 0.
 *   RLS_TEST_AUTO_SETUP  — if `1`, the suite runs
 *                          `scripts/rls/setup-test-db.sh` to create
 *                          and seed a fresh DB. Useful in CI.
 *
 * In CI: the `.github/workflows/rls.yml` workflow spins up a
 * `postgres:14` service container, sets the two env vars, and runs
 * `npm run test:rls`. The script invokes the same setup + probe
 * path the local developer would use.
 */

import { execFileSync, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  ALL_TABLES,
  runAllProbes,
  type AllProbesReport,
} from '../../../../scripts/rls/probe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../');
const SETUP_SCRIPT = resolve(REPO_ROOT, 'scripts/rls/setup-test-db.sh');

const DB_NAME = process.env.RLS_TEST_DB ?? '';
const AUTO_SETUP = process.env.RLS_TEST_AUTO_SETUP === '1';

// Skip the entire suite if the test DB is not configured. The
// rationale is documented at the top of the file: in dev, the
// developer opts in by setting RLS_TEST_DB; in CI, the workflow
// sets it. We still want the file to compile and the rest of
// vitest to run, so we use `it.skip` rather than throwing at
// module load.
const skipReason = (() => {
  if (DB_NAME) return null;
  return [
    'RLS_TEST_DB not set — skipping real-DB RLS probes.',
    'Local dev:   RLS_TEST_DB=rls_test_xxx npm run test:rls',
    'Fresh DB:    RLS_TEST_AUTO_SETUP=1 RLS_TEST_DB=rls_test_xxx npm run test:rls',
    'CI:          see .github/workflows/rls.yml',
  ].join('  ');
})();
const itDb = skipReason ? it.skip : it;

/**
 * One-time setup: if RLS_TEST_AUTO_SETUP=1, invoke the setup script
 * to provision a fresh DB. Otherwise, the developer is expected to
 * have set RLS_TEST_DB to a DB the setup script already provisioned
 * (or a DB they migrated by hand).
 */
beforeAll(async () => {
  if (skipReason) return;
  if (!AUTO_SETUP) return;
  // eslint-disable-next-line no-console
  console.log(`[rls-policies] auto-setup: provisioning ${DB_NAME}`);
  execSync(`bash ${SETUP_SCRIPT} ${DB_NAME}`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}, 120_000);

let report: AllProbesReport | null = null;

/**
 * Run the full probe matrix once. The result is shared across all
 * `it` blocks (the suite-level cost is ~20s of psql roundtrips).
 * Each `it` then asserts one cell of the matrix.
 */
describe('Integration: RLS Policy — Two-Org Isolation', () => {
  beforeAll(async () => {
    if (skipReason) return;
    report = runAllProbes(DB_NAME);
  }, 180_000);

  afterAll(() => {
    writeReportSidecar(report);
  });

  // ── 9 original it.todo stubs (replaced with real assertions) ────────

  itDb('user in org A cannot SELECT conversations belonging to org B', () => {
    const row = report!.tables.find((t) => t.table === 'conversations')!;
    expect(row.selectCross).toBe(0);
    expect(row.selectOwn).toBeGreaterThanOrEqual(1);
  });

  itDb('user in org A cannot SELECT messages belonging to org B', () => {
    const row = report!.tables.find((t) => t.table === 'messages')!;
    expect(row.selectCross).toBe(0);
    expect(row.selectOwn).toBeGreaterThanOrEqual(1);
  });

  itDb('user in org A cannot SELECT contacts belonging to org B', () => {
    const row = report!.tables.find((t) => t.table === 'contacts')!;
    expect(row.selectCross).toBe(0);
    expect(row.selectOwn).toBeGreaterThanOrEqual(1);
  });

  itDb('user in org A cannot INSERT a conversation with org B organization_id', () => {
    const row = report!.tables.find((t) => t.table === 'conversations')!;
    expect(row.insertCross).toBe('blocked');
  });

  itDb('user in org A cannot UPDATE a conversation belonging to org B', () => {
    const row = report!.tables.find((t) => t.table === 'conversations')!;
    expect(row.updateCross).toBe(0);
  });

  itDb('user in org A cannot DELETE a contact belonging to org B', () => {
    const row = report!.tables.find((t) => t.table === 'contacts')!;
    expect(row.deleteCross).toBe(0);
  });

  itDb('audit_logs table rejects UPDATE operations (append-only)', () => {
    expect(report!.auditLogs.updateOwn).toBe(0);
    expect(report!.auditLogs.updateCross).toBe(0);
  });

  itDb('audit_logs table rejects DELETE operations (append-only)', () => {
    expect(report!.auditLogs.deleteOwn).toBe(0);
    expect(report!.auditLogs.deleteCross).toBe(0);
  });

  itDb('credential columns in provider accounts are excluded from client queries', () => {
    // The fix in migration 008 closes CRITICAL-2: the column-level
    // REVOKE on sms_provider_accounts.credentials_secret_id and
    // email_provider_accounts.credentials_secret_id. The probe
    // verifies both anon and authenticated get a permission error.
    expect(report!.credentials.anon.smsColumnSelect).toBe('blocked');
    expect(report!.credentials.anon.emailColumnSelect).toBe('blocked');
    expect(report!.credentials.authenticated.smsColumnSelect).toBe('blocked');
    expect(report!.credentials.authenticated.emailColumnSelect).toBe('blocked');
  });

  // ── Full 17-table matrix (regression breadth beyond the 9 stubs) ───

  itDb('every tenant table passes all 4 cross-tenant probes (17 tables × 4 probes)', () => {
    // This is the launch-checklist go/no-go criterion: every table
    // must be isolated. We assert per-table on the same 4 probes the
    // audit ran, so a regression in any single migration is caught
    // by exactly one test cell.
    const failures: string[] = [];
    for (const t of report!.tables) {
      const errors: string[] = [];
      if (t.selectCross !== 0) errors.push(`select_cross=${t.selectCross}`);
      if (t.selectOwn < 1) errors.push(`select_own=${t.selectOwn}`);
      if (t.insertCross !== 'blocked') errors.push(`insert_cross=${t.insertCross}`);
      if (t.updateCross !== 0) errors.push(`update_cross=${t.updateCross}`);
      if (t.deleteCross !== 0) errors.push(`delete_cross=${t.deleteCross}`);
      if (errors.length) failures.push(`${t.table}: ${errors.join(', ')}`);
    }
    if (failures.length) {
      throw new Error(
        `RLS regressions on ${failures.length} table(s):\n  ${failures.join('\n  ')}`,
      );
    }
    expect(failures).toEqual([]);
  });

  itDb('CRITICAL-1: direct INSERT to organizations is blocked for authenticated', () => {
    // The fix in migration 007 closed the open organizations_insert
    // policy. The only path to create an organization is the
    // SECURITY DEFINER RPC `public.create_organization(name, slug)`.
    // A direct INSERT must be rejected by RLS WITH CHECK (false).
    expect(report!.organizationsInsert.result).toBe('blocked');
  });

  itDb('safe columns (id, provider, label) on credential tables remain readable for authenticated', () => {
    // The 008 fix must NOT over-restrict: the table-level grant was
    // REVOKEd but the column-level GRANT for the safe columns was
    // re-issued. A read of `id` from sms_provider_accounts as
    // authenticated should still work (the RLS policy then applies,
    // so a user only sees rows in their org).
    expect(report!.credentials.authenticated.safeColumnsSmsAnon).toBe('succeeded');
  });
});

// ── Diagnostic: print the full report on failure ────────────────────────

/** Stash the report on globalThis so a CI runner (or a developer
 *  re-running locally) can dump the full probe matrix from the
 *  vitest output without re-running. Also write a JSON sidecar so a
 *  CI step can upload it as an artifact if the test fails (the probe
 *  matrix is the most useful diagnostic when an RLS migration
 *  regresses). */
function writeReportSidecar(r: AllProbesReport | null) {
  if (!r) return;
  (globalThis as Record<string, unknown>).__RLS_PROBE_REPORT__ = r;
  try {
    // Lazy-require to avoid loading fs at the top of every test file.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = resolve(__dirname, '../../../../rls-probe-report.json');
    fs.writeFileSync(path, JSON.stringify(r, null, 2));
  } catch {
    // best-effort
  }
}

// ── Local probe helper (for ad-hoc re-execution) ──────────────────────

/**
 * When run as a standalone script (`npx tsx rls-policies.test.ts`),
 * the file is a no-op because vitest's test runner is what wires
 * the `beforeAll` hooks. We still expose a small `main` here for
 * the rare case a developer wants to dump the report without
 * running the full vitest suite.
 */
if (
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module
) {
  if (!DB_NAME) {
    console.error('RLS_TEST_DB not set; nothing to do.');
    process.exit(2);
  }
  const r = runAllProbes(DB_NAME);
  console.log(JSON.stringify(r, null, 2));
  // Quick verdict
  const bad = r.tables.filter(
    (t) =>
      t.selectCross !== 0 ||
      t.selectOwn < 1 ||
      t.insertCross !== 'blocked' ||
      t.updateCross !== 0 ||
      t.deleteCross !== 0,
  );
  if (bad.length > 0) {
    console.error(`FAIL: ${bad.length} table(s) regressed.`);
    process.exit(1);
  }
  if (r.organizationsInsert.result !== 'blocked') {
    console.error('FAIL: organizations_insert is not blocked (CRITICAL-1 regressed).');
    process.exit(1);
  }
  if (
    r.credentials.anon.smsColumnSelect !== 'blocked' ||
    r.credentials.anon.emailColumnSelect !== 'blocked' ||
    r.credentials.authenticated.smsColumnSelect !== 'blocked' ||
    r.credentials.authenticated.emailColumnSelect !== 'blocked'
  ) {
    console.error('FAIL: credentials_secret_id is readable (CRITICAL-2 regressed).');
    process.exit(1);
  }
  console.log('PASS: all probes green.');
  // Reference unused import to satisfy lint
  void ALL_TABLES;
  void execFileSync;
}
