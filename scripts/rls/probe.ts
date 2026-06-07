/**
 * scripts/rls/probe.ts — RLS probe driver (vitest-friendly).
 *
 * Generates and executes the 17-table × 4-probe matrix, the audit_logs
 * special probes (append-only), and the CRITICAL-2 credential column
 * probes. The vitest integration test in
 * `packages/support-core/__tests__/integration/rls-policies.test.ts`
 * imports `runAllProbes` and asserts on the structured result.
 *
 * Why `psql` and not `node-postgres`:
 *   - The project does not depend on `pg` (it's a Next.js app, not a
 *     Node service). Adding a dev-only `pg` dep just for RLS probes
 *     would inflate the production install.
 *   - The audit that opened this card used the same pattern
 *     (`/tmp/rls_probe_driver.py` calling `psql`); this module
 *     mirrors that design in TypeScript.
 *   - psql + `sudo -u postgres` is the same way operators run
 *     ad-hoc probes on the staging DB, so the test exercises the
 *     same surface the team will reach for in a fire.
 *
 * Each probe runs inside its own `BEGIN ... ROLLBACK` so the database
 * is unchanged after the suite (the suite is read-only + write-then-
 * rollback). The only side effect is creating rows that the audit
 * harness's `CREATE DATABASE` already accounts for (we always work
 * on a dedicated `rls_test_*` DB).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────

const OWN_ORG = 'a0000000-0000-4000-8000-000000000001';
const FOREIGN_ORG = 'a0000000-0000-4000-8000-000000000002';

/** The known seeded foreign-org row id (PK) per table. */
const FOREIGN_PK: Record<string, string> = {
  organizations: 'a0000000-0000-4000-8000-000000000002',
  organization_members: 'b0000000-0000-4000-8000-000000000002',
  contacts: 'c0000000-0000-4000-8000-000000000002',
  conversations: 'd0000000-0000-4000-8000-000000000002',
  messages: 'e0000000-0000-4000-8000-000000000002',
  sms_provider_accounts: 'fa000000-0000-4000-8000-000000000002',
  sms_phone_numbers: 'fb000000-0000-4000-8000-000000000002',
  sms_delivery_events: 'fc000000-0000-4000-8000-000000000002',
  email_provider_accounts: 'fd000000-0000-4000-8000-000000000002',
  email_addresses: 'fe000000-0000-4000-8000-000000000002',
  email_delivery_events: 'ff000000-0000-4000-8000-000000000002',
  ai_settings: 'a1000000-0000-4000-8000-000000000002',
  ai_decisions: 'e2000000-0000-4000-8000-000000000002',
  knowledge_documents: 'f0000000-0000-4000-8000-000000000002',
  knowledge_chunks: 'f1000000-0000-4000-8000-000000000002',
  support_jobs: 'aa000000-0000-4000-8000-000000000002',
  audit_logs: 'ab000000-0000-4000-8000-000000000002',
};

/** Tables whose isolation is via a parent chain (no own organization_id). */
const PARENT_TABLES: Record<string, { fk: string; parent: string; parentPk: string }> = {
  messages: { fk: 'conversation_id', parent: 'conversations', parentPk: 'd0000000-0000-4000-8000-000000000002' },
  sms_delivery_events: { fk: 'message_id', parent: 'messages', parentPk: 'e0000000-0000-4000-8000-000000000002' },
  email_delivery_events: { fk: 'message_id', parent: 'messages', parentPk: 'e0000000-0000-4000-8000-000000000002' },
  sms_phone_numbers: { fk: 'provider_account_id', parent: 'sms_provider_accounts', parentPk: 'fa000000-0000-4000-8000-000000000002' },
  email_addresses: { fk: 'provider_account_id', parent: 'email_provider_accounts', parentPk: 'fd000000-0000-4000-8000-000000000002' },
};

/** No-op UPDATE assignments to avoid CHECK constraints / triggers. */
const UPDATE_NEUTRAL: Record<string, string> = {
  organizations: 'name = name',
  organization_members: 'role = role',
  contacts: 'name = name',
  conversations: 'status = status',
  messages: 'body = body',
  sms_provider_accounts: 'label = label',
  sms_phone_numbers: 'phone_number = phone_number',
  sms_delivery_events: 'status = status',
  email_provider_accounts: 'label = label',
  email_addresses: 'email_address = email_address',
  email_delivery_events: 'status = status',
  ai_settings: 'model = model',
  ai_decisions: 'confidence = confidence',
  knowledge_documents: 'title = title',
  knowledge_chunks: 'content = content',
  support_jobs: 'status = status',
  audit_logs: 'action = action',
};

/** INSERT templates per table — the foreign org + parent references are
 *  substituted in at probe-build time. */
const INSERT_TEMPLATE: Record<string, string> = {
  organizations:
    "INSERT INTO organizations (id, name, slug) VALUES (gen_random_uuid(), 'probe', 'probe-' || md5(random()::text))",
  organization_members:
    "INSERT INTO organization_members (id, organization_id, user_id, role) VALUES (gen_random_uuid(), '{org}', 'probe-user', 'viewer')",
  contacts:
    "INSERT INTO contacts (id, organization_id, name) VALUES (gen_random_uuid(), '{org}', 'probe')",
  conversations:
    "INSERT INTO conversations (id, organization_id, contact_id, channel, status, ai_state) VALUES (gen_random_uuid(), '{org}', '{parent}', 'sms', 'open', 'idle')",
  messages:
    "INSERT INTO messages (id, conversation_id, sender_type, direction, channel, body) VALUES (gen_random_uuid(), '{parent}', 'contact', 'inbound', 'sms', 'probe')",
  sms_provider_accounts:
    "INSERT INTO sms_provider_accounts (id, organization_id, provider, label, credentials_secret_id) VALUES (gen_random_uuid(), '{org}', 'probe', 'probe', 'probe-secret')",
  sms_phone_numbers:
    "INSERT INTO sms_phone_numbers (id, provider_account_id, organization_id, phone_number) VALUES (gen_random_uuid(), '{parent}', '{org}', '+155****9999')",
  sms_delivery_events:
    "INSERT INTO sms_delivery_events (id, message_id, status) VALUES (gen_random_uuid(), '{parent}', 'queued')",
  email_provider_accounts:
    "INSERT INTO email_provider_accounts (id, organization_id, provider, label, credentials_secret_id) VALUES (gen_random_uuid(), '{org}', 'probe', 'probe', 'probe-secret')",
  email_addresses:
    "INSERT INTO email_addresses (id, provider_account_id, organization_id, email_address) VALUES (gen_random_uuid(), '{parent}', '{org}', 'probe@example.com')",
  email_delivery_events:
    "INSERT INTO email_delivery_events (id, message_id, status) VALUES (gen_random_uuid(), '{parent}', 'queued')",
  ai_settings: "INSERT INTO ai_settings (id, organization_id) VALUES (gen_random_uuid(), '{org}')",
  ai_decisions:
    "INSERT INTO ai_decisions (id, conversation_id, organization_id, decision_type, confidence) VALUES (gen_random_uuid(), '{parent}', '{org}', 'respond', 0.5)",
  knowledge_documents:
    "INSERT INTO knowledge_documents (id, organization_id, title, source_type, body, status) VALUES (gen_random_uuid(), '{org}', 'probe', 'faq', 'probe', 'ready')",
  knowledge_chunks:
    "INSERT INTO knowledge_chunks (id, document_id, organization_id, content, embedding) VALUES (gen_random_uuid(), '{parent}', '{org}', 'probe', (SELECT ('[' || array_to_string(array_agg(0), ',') || ']')::vector FROM generate_series(1, 1536)))",
  support_jobs:
    "INSERT INTO support_jobs (id, organization_id, job_type, status) VALUES (gen_random_uuid(), '{org}', 'probe_job', 'pending')",
  audit_logs:
    "INSERT INTO audit_logs (id, organization_id, actor_type, action, resource_type, resource_id) VALUES (gen_random_uuid(), '{org}', 'user', 'probe_action', 'probe', 'probe')",
};

/** Per-table parent PKs for non-parent-chained FK references. */
const EXTRA_PARENT_PK: Record<string, string> = {
  conversations: 'c0000000-0000-4000-8000-000000000002', // contact
  ai_decisions: 'd0000000-0000-4000-8000-000000000002', // conversation
  knowledge_chunks: 'f0000000-0000-4000-8000-000000000002', // document
};

// ─── SQL generation ───────────────────────────────────────────────────────

/** Build the SELECT-cross-org query. Uses a SCALAR subquery so the
 *  RLS context is preserved (a derived-table subquery returns 1 row
 *  regardless of RLS, which is a common bug — see the audit). */
function selectCrossSql(table: string): string {
  if (table === 'organizations') {
    return `SELECT count(*) FROM organizations WHERE id = '${FOREIGN_ORG}'::uuid`;
  }
  const parent = PARENT_TABLES[table];
  if (parent) {
    if (
      parent.parent === 'conversations' ||
      parent.parent === 'sms_provider_accounts' ||
      parent.parent === 'email_provider_accounts' ||
      parent.parent === 'knowledge_documents' ||
      parent.parent === 'ai_settings' ||
      parent.parent === 'ai_decisions'
    ) {
      return `SELECT count(*) FROM ${table} t JOIN ${parent.parent} p ON p.id = t.${parent.fk} WHERE p.organization_id = '${FOREIGN_ORG}'::uuid`;
    }
    if (parent.parent === 'messages') {
      return `SELECT count(*) FROM ${table} t JOIN messages m ON m.id = t.${parent.fk} JOIN conversations p ON p.id = m.conversation_id WHERE p.organization_id = '${FOREIGN_ORG}'::uuid`;
    }
    return `SELECT count(*) FROM ${table} t JOIN ${parent.parent} p ON p.id = t.${parent.fk} WHERE p.organization_id = '${FOREIGN_ORG}'::uuid`;
  }
  return `SELECT count(*) FROM ${table} WHERE organization_id = '${FOREIGN_ORG}'::uuid`;
}

function selectOwnSql(table: string): string {
  if (table === 'organizations') {
    return `SELECT count(*) FROM organizations WHERE id = '${OWN_ORG}'::uuid`;
  }
  const parent = PARENT_TABLES[table];
  if (parent) {
    if (
      parent.parent === 'conversations' ||
      parent.parent === 'sms_provider_accounts' ||
      parent.parent === 'email_provider_accounts' ||
      parent.parent === 'knowledge_documents' ||
      parent.parent === 'ai_settings' ||
      parent.parent === 'ai_decisions'
    ) {
      return `SELECT count(*) FROM ${table} t JOIN ${parent.parent} p ON p.id = t.${parent.fk} WHERE p.organization_id = '${OWN_ORG}'::uuid`;
    }
    if (parent.parent === 'messages') {
      return `SELECT count(*) FROM ${table} t JOIN messages m ON m.id = t.${parent.fk} JOIN conversations p ON p.id = m.conversation_id WHERE p.organization_id = '${OWN_ORG}'::uuid`;
    }
    return `SELECT count(*) FROM ${table} t JOIN ${parent.parent} p ON p.id = t.${parent.fk} WHERE p.organization_id = '${OWN_ORG}'::uuid`;
  }
  return `SELECT count(*) FROM ${table} WHERE organization_id = '${OWN_ORG}'::uuid`;
}

/** Build the full probe SQL for one table — runs as alice in org A.
 *
 * The output is a series of `PROBE_<KEY>|<value>` lines we can parse
 * deterministically. For numeric probes, the value is the count
 * (rows seen / rows affected). For the cross-org INSERT probe, the
 * value is either `SUCCEEDED` (RLS did NOT block — the probe is
 * alerting on a regression) or `BLOCKED:<sqlstate>:<errmsg>` (the
 * good outcome). We use a TEMP TABLE inside the transaction so the
 * RAISE NOTICE pattern isn't needed (RAISE NOTICE goes to stderr
 * where it's hard to capture deterministically with -A -t).
 */
function buildTableProbeSql(table: string): string {
  const fk = FOREIGN_PK[table];
  const updateSet = UPDATE_NEUTRAL[table];
  const insertTmpl = INSERT_TEMPLATE[table];
  const parentPk = PARENT_TABLES[table]?.parentPk ?? EXTRA_PARENT_PK[table] ?? '';
  const insertSql = insertTmpl
    .replace('{org}', FOREIGN_ORG)
    .replace('{parent}', parentPk)
    .replace(/'/g, "''"); // escape for DO/EXECUTE
  const selCross = selectCrossSql(table);
  const selOwn = selectOwnSql(table);
  return `
\\set ON_ERROR_STOP off
\\set VERBOSITY terse
BEGIN;
SET LOCAL ROLE rls_user_a;
SET LOCAL request.jwt.claims = '{"sub":"usr_alice"}';
CREATE TEMP TABLE _probe_out (k text, v text) ON COMMIT DROP;

-- PROBE_SELECT_CROSS (must be 0)
INSERT INTO _probe_out SELECT 'PROBE_SELECT_CROSS', (${selCross})::text;
-- PROBE_SELECT_OWN (must be >= 1)
INSERT INTO _probe_out SELECT 'PROBE_SELECT_OWN', (${selOwn})::text;
-- PROBE_INSERT_CROSS — expect EXCEPTION
DO $probe$ BEGIN BEGIN
  EXECUTE '${insertSql}';
  INSERT INTO _probe_out VALUES ('PROBE_INSERT_CROSS', 'SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _probe_out VALUES ('PROBE_INSERT_CROSS', 'BLOCKED:' || SQLSTATE || ':' || SQLERRM);
END; END $probe$;
-- PROBE_UPDATE_CROSS (must be 0)
WITH upd AS (
  UPDATE ${table} SET ${updateSet} WHERE id = '${fk}'::uuid RETURNING id
)
INSERT INTO _probe_out SELECT 'PROBE_UPDATE_CROSS', count(*)::text FROM upd;
-- PROBE_DELETE_CROSS (must be 0)
WITH del AS (
  DELETE FROM ${table} WHERE id = '${fk}'::uuid RETURNING id
)
INSERT INTO _probe_out SELECT 'PROBE_DELETE_CROSS', count(*)::text FROM del;
SELECT k, v FROM _probe_out ORDER BY k;
ROLLBACK;
`;
}

/** Build audit_logs append-only probes. The audit_logs table has no
 *  UPDATE/DELETE policy, so any client write affects 0 rows. */
function buildAuditLogsAppendOnlySql(): string {
  return `
\\set ON_ERROR_STOP off
\\set VERBOSITY terse
BEGIN;
SET LOCAL ROLE rls_user_a;
SET LOCAL request.jwt.claims = '{"sub":"usr_alice"}';
CREATE TEMP TABLE _probe_out (k text, v text) ON COMMIT DROP;

-- AUDIT_UPDATE_OWN (must be 0 — no UPDATE policy)
WITH upd AS (
  UPDATE audit_logs SET action = action WHERE id = 'ab000000-0000-4000-8000-000000000001'::uuid RETURNING id
)
INSERT INTO _probe_out SELECT 'AUDIT_UPDATE_OWN', count(*)::text FROM upd;
-- AUDIT_UPDATE_CROSS (must be 0)
WITH upd AS (
  UPDATE audit_logs SET action = action WHERE id = '${FOREIGN_PK['audit_logs']}'::uuid RETURNING id
)
INSERT INTO _probe_out SELECT 'AUDIT_UPDATE_CROSS', count(*)::text FROM upd;
-- AUDIT_DELETE_OWN (must be 0)
WITH del AS (
  DELETE FROM audit_logs WHERE id = 'ab000000-0000-4000-8000-000000000001'::uuid RETURNING id
)
INSERT INTO _probe_out SELECT 'AUDIT_DELETE_OWN', count(*)::text FROM del;
-- AUDIT_DELETE_CROSS (must be 0)
WITH del AS (
  DELETE FROM audit_logs WHERE id = '${FOREIGN_PK['audit_logs']}'::uuid RETURNING id
)
INSERT INTO _probe_out SELECT 'AUDIT_DELETE_CROSS', count(*)::text FROM del;
SELECT k, v FROM _probe_out ORDER BY k;
ROLLBACK;
`;
}

/** Build the credentials_secret_id column-privilege probes
 *  (CRITICAL-2 verification). The fix in migration 008 is the
 *  column-level grant matrix: anon and authenticated should not
 *  be able to SELECT the credential column on either
 *  sms_provider_accounts or email_provider_accounts. */
function buildCredentialsProbeSql(role: 'anon' | 'authenticated'): string {
  return `
\\set ON_ERROR_STOP off
\\set VERBOSITY terse
BEGIN;
SET LOCAL ROLE ${role};
SET LOCAL request.jwt.claims = '{"sub":"usr_alice"}';
CREATE TEMP TABLE _probe_out (k text, v text) ON COMMIT DROP;

-- Should error: permission denied for column credentials_secret_id
DO $sms$ BEGIN BEGIN
  PERFORM credentials_secret_id FROM sms_provider_accounts LIMIT 1;
  INSERT INTO _probe_out VALUES ('CREDS_SMS_SELECT', 'LEAKED');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _probe_out VALUES ('CREDS_SMS_SELECT', 'BLOCKED:' || SQLSTATE);
WHEN OTHERS THEN
  INSERT INTO _probe_out VALUES ('CREDS_SMS_SELECT', 'BLOCKED:' || SQLSTATE || ':' || SQLERRM);
END; END $sms$;

DO $email$ BEGIN BEGIN
  PERFORM credentials_secret_id FROM email_provider_accounts LIMIT 1;
  INSERT INTO _probe_out VALUES ('CREDS_EMAIL_SELECT', 'LEAKED');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _probe_out VALUES ('CREDS_EMAIL_SELECT', 'BLOCKED:' || SQLSTATE);
WHEN OTHERS THEN
  INSERT INTO _probe_out VALUES ('CREDS_EMAIL_SELECT', 'BLOCKED:' || SQLSTATE || ':' || SQLERRM);
END; END $email$;

-- Sanity: for anon, the safe column read is also blocked (table-level
-- grant was revoked for anon on the credential tables). For
-- authenticated, it should succeed.
DO $safe$ BEGIN BEGIN
  PERFORM id FROM sms_provider_accounts LIMIT 1;
  INSERT INTO _probe_out VALUES ('SAFE_COLS_SMS', 'SUCCEEDED');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _probe_out VALUES ('SAFE_COLS_SMS', 'BLOCKED:' || SQLSTATE || ':' || SQLERRM);
END; END $safe$;

SELECT k, v FROM _probe_out ORDER BY k;
ROLLBACK;
`;
}

/** Build the organizations_insert probe — verifies the WITH CHECK
 *  (false) policy from migration 007 is in place. As alice, an
 *  INSERT to organizations with arbitrary id/name/slug should be
 *  blocked (the only sanctioned path is the create_organization RPC). */
function buildOrganizationsInsertProbeSql(): string {
  return `
\\set ON_ERROR_STOP off
\\set VERBOSITY terse
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"usr_alice"}';
CREATE TEMP TABLE _probe_out (k text, v text) ON COMMIT DROP;

DO $probe$ BEGIN BEGIN
  INSERT INTO organizations (id, name, slug) VALUES (gen_random_uuid(), 'probe', 'probe-' || md5(random()::text));
  INSERT INTO _probe_out VALUES ('ORGS_INSERT', 'LEAKED');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _probe_out VALUES ('ORGS_INSERT', 'BLOCKED:' || SQLSTATE || ':' || SQLERRM);
END; END $probe$;

SELECT k, v FROM _probe_out ORDER BY k;
ROLLBACK;
`;
}

// ─── psql execution ───────────────────────────────────────────────────────

export interface ProbeResult {
  /** The probe key (e.g. PROBE_SELECT_CROSS). */
  key: string;
  /** Parsed value: number for PROBE_*, "blocked"|"succeeded"|"leaked" for others. */
  value: number | string;
}

export interface TableProbeReport {
  table: string;
  selectCross: number;
  selectOwn: number;
  insertCross: 'blocked' | 'leaked' | 'succeeded' | 'unknown';
  updateCross: number;
  deleteCross: number;
  raw: string;
}

export interface CredentialsReport {
  role: 'anon' | 'authenticated';
  smsColumnSelect: 'blocked' | 'leaked' | 'unknown';
  emailColumnSelect: 'blocked' | 'leaked' | 'unknown';
  safeColumnsSmsAnon: 'blocked' | 'succeeded' | 'unknown';
  raw: string;
}

export interface AuditLogsAppendOnlyReport {
  updateOwn: number;
  updateCross: number;
  deleteOwn: number;
  deleteCross: number;
  raw: string;
}

export interface OrganizationsInsertReport {
  result: 'blocked' | 'leaked' | 'unknown';
  raw: string;
}

export interface AllProbesReport {
  tables: TableProbeReport[];
  auditLogs: AuditLogsAppendOnlyReport;
  credentials: { anon: CredentialsReport; authenticated: CredentialsReport };
  organizationsInsert: OrganizationsInsertReport;
}

function runPsql(dbname: string, sql: string): { stdout: string; stderr: string; rc: number } {
  const dir = mkdtempSync(join(tmpdir(), 'rls-probe-'));
  // Open the directory up so the `postgres` user can read the file
  // we drop into it. mkdtempSync creates with 0700 by default.
  try {
    require('node:fs').chmodSync(dir, 0o755);
  } catch {
    // best-effort
  }
  const sqlPath = join(dir, 'probe.sql');
  try {
    require('node:fs').writeFileSync(sqlPath, sql);
    try {
      require('node:fs').chmodSync(sqlPath, 0o644);
    } catch {
      // best-effort
    }
    const out = execFileSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-d', dbname, '-A', '-t', '-f', sqlPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    return { stdout: out, stderr: '', rc: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      rc: e.status ?? 1,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/** Parse the key|value rows emitted by the probe SQL.
 *
 * Output format (one row per line, from `SELECT k, v FROM _probe_out`):
 *   - Numeric probes:   PROBE_SELECT_CROSS|0
 *   - Status probes:    PROBE_INSERT_CROSS|SUCCEEDED
 *                       PROBE_INSERT_CROSS|BLOCKED:42501:...
 *                       CREDS_SMS_SELECT|LEAKED
 *                       SAFE_COLS_SMS|SUCCEEDED
 *
 * The numeric probes always have an integer value; the status probes
 * always have a non-integer value. We preserve the original string so
 * the test can assert on the exact sqlstate (e.g. `42501` is the
 * `insufficient_privilege` class for RLS denials).
 */
function parseProbeLines(out: string, err: string): Map<string, string> {
  const results = new Map<string, string>();
  const re = /^([A-Z][A-Z_0-9]*)\|(.+)$/;
  for (const stream of [out, err]) {
    for (const rawLine of stream.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = re.exec(line);
      if (m) {
        // First match wins; subsequent ones (e.g. on retry) are ignored.
        if (!results.has(m[1])) results.set(m[1], m[2]);
      }
    }
  }
  return results;
}

function findNotice(out: string, err: string, needle: string): string | undefined {
  for (const stream of [out, err]) {
    for (const rawLine of stream.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.includes(needle)) return line;
    }
  }
  return undefined;
}

/** Coerce a `key|value` string into a number. Returns NaN if not numeric. */
function asNumber(v: string | undefined): number {
  if (v === undefined) return NaN;
  return Number(v);
}

/** Classify a status-probe value into a high-level outcome. */
function classifyStatus(
  v: string | undefined,
): 'blocked' | 'leaked' | 'succeeded' | 'unknown' {
  if (v === undefined) return 'unknown';
  if (v.startsWith('BLOCKED')) return 'blocked';
  if (v === 'LEAKED') return 'leaked';
  if (v === 'SUCCEEDED') return 'succeeded';
  return 'unknown';
}

// ─── Public API ───────────────────────────────────────────────────────────

export function runTableProbes(dbname: string, table: string): TableProbeReport {
  const sql = buildTableProbeSql(table);
  const { stdout, stderr, rc } = runPsql(dbname, sql);
  const byKey = parseProbeLines(stdout, stderr);
  return {
    table,
    selectCross: asNumber(byKey.get('PROBE_SELECT_CROSS')),
    selectOwn: asNumber(byKey.get('PROBE_SELECT_OWN')),
    insertCross: classifyStatus(byKey.get('PROBE_INSERT_CROSS')),
    updateCross: asNumber(byKey.get('PROBE_UPDATE_CROSS')),
    deleteCross: asNumber(byKey.get('PROBE_DELETE_CROSS')),
    raw: [stdout, stderr].filter(Boolean).join('\n').slice(0, 2000),
  };
}

export function runAuditLogsAppendOnlyProbes(dbname: string): AuditLogsAppendOnlyReport {
  const { stdout, stderr } = runPsql(dbname, buildAuditLogsAppendOnlySql());
  const byKey = parseProbeLines(stdout, stderr);
  return {
    updateOwn: asNumber(byKey.get('AUDIT_UPDATE_OWN')),
    updateCross: asNumber(byKey.get('AUDIT_UPDATE_CROSS')),
    deleteOwn: asNumber(byKey.get('AUDIT_DELETE_OWN')),
    deleteCross: asNumber(byKey.get('AUDIT_DELETE_CROSS')),
    raw: [stdout, stderr].filter(Boolean).join('\n').slice(0, 2000),
  };
}

export function runCredentialsProbes(dbname: string, role: 'anon' | 'authenticated'): CredentialsReport {
  const { stdout, stderr } = runPsql(dbname, buildCredentialsProbeSql(role));
  const byKey = parseProbeLines(stdout, stderr);
  return {
    role,
    smsColumnSelect: classifyStatus(byKey.get('CREDS_SMS_SELECT')),
    emailColumnSelect: classifyStatus(byKey.get('CREDS_EMAIL_SELECT')),
    safeColumnsSmsAnon: classifyStatus(byKey.get('SAFE_COLS_SMS')),
    raw: [stdout, stderr].filter(Boolean).join('\n').slice(0, 2000),
  };
}

export function runOrganizationsInsertProbe(dbname: string): OrganizationsInsertReport {
  const { stdout, stderr } = runPsql(dbname, buildOrganizationsInsertProbeSql());
  const byKey = parseProbeLines(stdout, stderr);
  return {
    result: classifyStatus(byKey.get('ORGS_INSERT')),
    raw: [stdout, stderr].filter(Boolean).join('\n').slice(0, 2000),
  };
}

export const ALL_TABLES = Object.keys(FOREIGN_PK);

export function runAllProbes(dbname: string): AllProbesReport {
  const tables = ALL_TABLES.map((t) => runTableProbes(dbname, t));
  const auditLogs = runAuditLogsAppendOnlyProbes(dbname);
  const anon = runCredentialsProbes(dbname, 'anon');
  const authenticated = runCredentialsProbes(dbname, 'authenticated');
  const organizationsInsert = runOrganizationsInsertProbe(dbname);
  return { tables, auditLogs, credentials: { anon, authenticated }, organizationsInsert };
}

// ─── CLI entry (for ad-hoc execution) ──────────────────────────────────────

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const dbname = process.argv[2] ?? process.env.RLS_TEST_DB ?? '';
  if (!dbname) {
    console.error('usage: probe.ts <dbname>   (or set RLS_TEST_DB)');
    process.exit(2);
  }
  const report = runAllProbes(dbname);
  // Compact text report
  for (const t of report.tables) {
    console.log(
      `[${t.table}] sel_cross=${t.selectCross} sel_own=${t.selectOwn} ins_cross=${t.insertCross} upd_cross=${t.updateCross} del_cross=${t.deleteCross}`,
    );
  }
  console.log(
    `[audit_logs] upd_own=${report.auditLogs.updateOwn} upd_cross=${report.auditLogs.updateCross} del_own=${report.auditLogs.deleteOwn} del_cross=${report.auditLogs.deleteCross}`,
  );
  console.log(
    `[creds anon] sms=${report.credentials.anon.smsColumnSelect} email=${report.credentials.anon.emailColumnSelect}`,
  );
  console.log(
    `[creds auth] sms=${report.credentials.authenticated.smsColumnSelect} email=${report.credentials.authenticated.emailColumnSelect}`,
  );
  console.log(`[orgs_insert] ${report.organizationsInsert.result}`);
}
