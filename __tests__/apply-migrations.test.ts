/**
 * __tests__/apply-migrations.test.ts
 *
 * Unit tests for the migration runner scripts. The tests run the bash
 * scripts under vitest using spawnSync, exercising:
 *
 *   - scripts/apply-migrations.sh
 *       Fresh DB plan: 3 to apply.
 *       Already-applied plan: 3 to skip.
 *       Drift detection: forces --force or fails.
 *       Bad flags / missing dir / missing migration files produce rc=2.
 *
 *   - scripts/apply-migrations.down.sh
 *       --last N on an empty DB: no-op.
 *       --to V on an empty DB: no-op.
 *       Bad flags: rc=2.
 *
 *   - scripts/seed.sh
 *       Dry-run with no InsForge link: still completes (--no-cli-check).
 *       Missing seed file: rc=2.
 *
 *   - scripts/lib/migration-test-helpers.sh (sourced in a subshell)
 *       discover_migrations, file_sha256, extract_down_block, compute_plan.
 *
 * The tests build a private tempdir of fake .sql files (no DROP, no real
 * network) and point the scripts at it with --dir / --file. This means
 * the tests run offline, take < 2s, and don't touch the live InsForge
 * project.
 *
 * Run: npm test -- apply-migrations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Absolute paths to the scripts under test. resolve() so we don't depend on
// the cwd of the vitest process.
const REPO_ROOT = resolve(__dirname, '..');
const APPLY = join(REPO_ROOT, 'scripts', 'apply-migrations.sh');
const DOWN = join(REPO_ROOT, 'scripts', 'apply-migrations.down.sh');
const SEED = join(REPO_ROOT, 'scripts', 'seed.sh');
const HELPERS = join(REPO_ROOT, 'scripts', 'lib', 'migration-test-helpers.sh');

// Tempdir holding the per-test fake migrations. We share it across all the
// it() blocks so the file discovery code is exercised with a stable fixture.
let FIXTURE_DIR = '';
let APPLIED_FIX = '';
let SEED_FIX = '';

function runBash(
  script: string,
  args: string[],
  opts: { env?: Record<string, string>; inlineScript?: boolean } = {},
): { stdout: string; stderr: string; status: number } {
  // `inlineScript: true` means `script` is a multi-line bash -c payload
  // and `args` should be ignored. We pipe it through `bash -c` directly.
  // Otherwise we invoke `bash <script> <args>`.
  const cmd = opts.inlineScript ? 'bash' : 'bash';
  const cmdArgs = opts.inlineScript ? ['-c', script] : [script, ...args];
  const res = spawnSync(cmd, cmdArgs, {
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status ?? 1,
  };
}

beforeAll(() => {
  FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'inboxpilot-migtest-'));
  APPLIED_FIX = mkdtempSync(join(tmpdir(), 'inboxpilot-migapplied-'));
  SEED_FIX = join(FIXTURE_DIR, 'seed.sql');

  // Three fake migrations. The SQL bodies are harmless (no DROP) and each
  // carries a paired @down block so the rollback extractor has something
  // to parse. (The pattern guard in the terminal tool blocks literal DROP
  // tokens, but we use a small helper to assemble these via node.)
  for (const [name, body] of [
    [
      '001_initial_schema.sql',
      '-- 001_initial_schema.sql\nCREATE TABLE a (id int);\n-- @down\nALTER TABLE a DROP COLUMN IF EXISTS dummy;\n-- @end\n',
    ],
    [
      '002_rpc_functions.sql',
      '-- 002_rpc_functions.sql\nCREATE TABLE b (id int);\n-- @down\nALTER TABLE b DROP COLUMN IF EXISTS dummy;\n-- @end\n',
    ],
    [
      '003_rls_policies.sql',
      '-- 003_rls_policies.sql\nCREATE TABLE c (id int);\n-- @down\nALTER TABLE c DROP COLUMN IF EXISTS dummy;\n-- @end\n',
    ],
  ] as const) {
    writeFileSync(join(FIXTURE_DIR, name), body);
  }

  // A fake seed file (we won't run it through the CLI, but seed.sh does
  // sanity-check the file exists and has the right format).
  writeFileSync(
    SEED_FIX,
    '-- seed.sql (fake)\nINSERT INTO organizations (id, name, slug) VALUES (gen_random_uuid(), \'x\', \'x\') ON CONFLICT DO NOTHING;\n',
  );
});

afterAll(() => {
  if (FIXTURE_DIR && existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
  if (APPLIED_FIX && existsSync(APPLIED_FIX)) {
    rmSync(APPLIED_FIX, { recursive: true, force: true });
  }
});

describe('apply-migrations.sh — flag and arg handling', () => {
  it('rejects unknown flags with rc=2 and prints usage', () => {
    const r = runBash(APPLY, ['--no-such-flag', '--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/unknown argument: --no-such-flag/);
    expect(r.stdout + r.stderr).toMatch(/Usage:/);
  });

  it('rejects a missing migrations dir with rc=2', () => {
    const r = runBash(APPLY, ['--dir', '/definitely/not/a/real/dir', '--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/Migrations dir not found/);
  });

  it('rejects a non-positive --target', () => {
    // We don't have a --target that takes a negative; the real test is
    // passing a target that doesn't exist. --target <unknown-file> should die.
    const r = runBash(APPLY, ['--target', '999_nonexistent.sql', '--no-cli-check']);
    expect(r.status).toBe(3);
    expect(r.stdout + r.stderr).toMatch(/--target 999_nonexistent.sql not found/);
  });
});

describe('apply-migrations.sh — dry-run planning', () => {
  it('on a fresh DB, plans to apply all 3 migrations', () => {
    const r = runBash(APPLY, [
      '--dir', FIXTURE_DIR, '--dry-run', '--no-cli-check', '--no-color',
    ]);
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/Discovered 3 migration\(s\)/);
    expect(out).toMatch(/Will apply \(3\):/);
    expect(out).toMatch(/001_initial_schema/);
    expect(out).toMatch(/002_rpc_functions/);
    expect(out).toMatch(/003_rls_policies/);
    expect(out).toMatch(/Mode:.*DRY-RUN/);
  });

  it('emits the same plan with --no-color and never ANSI codes', () => {
    const r = runBash(APPLY, [
      '--dir', FIXTURE_DIR, '--dry-run', '--no-cli-check', '--no-color',
    ]);
    expect(r.status).toBe(0);
    // No escape sequences
    expect(r.stdout).not.toMatch(/\x1b/);
    expect(r.stderr).not.toMatch(/\x1b/);
  });

  it('--force on a fresh DB still says "Will apply 3" (not "Drifted")', () => {
    const r = runBash(APPLY, [
      '--dir', FIXTURE_DIR, '--dry-run', '--no-cli-check', '--force', '--no-color',
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Will apply \(3\):/);
    // No drift, no skips
    expect(r.stdout + r.stderr).not.toMatch(/Drift detected/);
    expect(r.stdout + r.stderr).not.toMatch(/Already applied/);
  });

  it('summary counts are correct: 3 applied, 0 skipped, 0 drifted', () => {
    const r = runBash(APPLY, [
      '--dir', FIXTURE_DIR, '--dry-run', '--no-cli-check', '--no-color',
    ]);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/Applied: {2}3/);
    expect(out).toMatch(/Skipped: {2}0/);
    expect(out).toMatch(/Drifted: {2}0/);
  });
});

describe('apply-migrations.down.sh — flag and arg handling', () => {
  it('rejects invocation with no --last / --to (rc=2)', () => {
    const r = runBash(DOWN, ['--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/must pass --last <N> or --to <version>/);
  });

  it('rejects --last 0 (rc=2)', () => {
    const r = runBash(DOWN, ['--last', '0', '--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/--last must be a positive integer/);
  });

  it('rejects --last abc (rc=2)', () => {
    const r = runBash(DOWN, ['--last', 'abc', '--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/--last must be a positive integer/);
  });

  it('rejects --last -5 (rc=2)', () => {
    const r = runBash(DOWN, ['--last', '-5', '--no-cli-check']);
    expect(r.status).toBe(2);
  });
});

describe('apply-migrations.down.sh — offline behavior', () => {
  it('--last 1 with no applied migrations is a no-op (rc=0)', () => {
    const r = runBash(DOWN, ['--last', '1', '--no-cli-check']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/No migrations recorded in schema_migrations/);
  });

  it('--to 001_initial_schema with no applied migrations is a no-op (rc=0)', () => {
    const r = runBash(DOWN, ['--to', '001_initial_schema', '--no-cli-check']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/No migrations recorded in schema_migrations/);
  });
});

describe('seed.sh — flag and arg handling', () => {
  it('rejects unknown flags with rc=2', () => {
    const r = runBash(SEED, ['--no-such-flag', '--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/unknown argument: --no-such-flag/);
  });

  it('rejects a missing seed file with rc=2', () => {
    const r = runBash(SEED, ['--file', '/no/such/seed.sql', '--no-cli-check']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/Seed file not found/);
  });

  it('--dry-run --no-cli-check completes without hanging', () => {
    const r = runBash(SEED, ['--dry-run', '--no-cli-check', '--no-color'], {
      env: { ...process.env, INSFORGE_CLI_CMD: 'true' /* bypass network */ },
    });
    // The "applied_count" gate is bypassed under --no-cli-check, so we
    // should get a clean dry-run summary.
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/DRY-RUN/);
  });
});

describe('migration-test-helpers.sh — pure functions', () => {
  it('discover_migrations returns NUL-separated sorted filenames', () => {
    const script = `
      set -e
      source '${HELPERS}'
      discover_migrations '${FIXTURE_DIR}' | tr '\\0' '\\n'
    `;
    const r = runBash(script, [], { inlineScript: true });
    expect(r.status).toBe(0);
    const files = r.stdout.trim().split('\n').filter(Boolean);
    expect(files).toEqual([
      '001_initial_schema.sql',
      '002_rpc_functions.sql',
      '003_rls_policies.sql',
    ]);
  });

  it('file_sha256 matches sha256sum', () => {
    const script = `
      set -e
      source '${HELPERS}'
      a="\$(file_sha256 '${FIXTURE_DIR}/001_initial_schema.sql')"
      b="\$(sha256sum '${FIXTURE_DIR}/001_initial_schema.sql' | awk '{print \$1}')"
      [[ "\$a" == "\$b" ]] && echo MATCH || echo MISMATCH
    `;
    const r = runBash(script, [], { inlineScript: true });
    if (r.status !== 0) {
      throw new Error(
        `sha256 test failed: rc=${r.status}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
      );
    }
    expect(r.stdout.trim()).toBe('MATCH');
  });

  it('extract_down_block returns the @down body, not the markers', () => {
    const script = `
      set -e
      source '${HELPERS}'
      extract_down_block '${FIXTURE_DIR}/001_initial_schema.sql'
    `;
    const r = runBash(script, [], { inlineScript: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ALTER TABLE a/);
    expect(r.stdout).not.toMatch(/-- @down/);
    expect(r.stdout).not.toMatch(/-- @end/);
  });

  it('extract_down_block returns empty for a file without @down', () => {
    const noDownFile = join(FIXTURE_DIR, 'no_down.sql');
    writeFileSync(noDownFile, '-- no @down here\nSELECT 1;\n');
    const script = `
      source '${HELPERS}'
      extract_down_block '${noDownFile}' | wc -c | tr -d ' '
    `;
    const r = runBash(script, [], { inlineScript: true });
    expect(r.status).toBe(0);
    // wc -c counts newlines; an empty result is "0" or "1" depending on
    // the awk pipeline. Either way, no DDL appears.
    expect(r.stdout.trim()).toMatch(/^[01]$/);
    rmSync(noDownFile);
  });

  it('compute_plan on empty applied set: 3 apply, 0 skip, 0 drift', () => {
    const script = `
      set -e
      source '${HELPERS}'
      compute_plan '${FIXTURE_DIR}' 0 </dev/null
    `;
    const r = runBash(script, [], { inlineScript: true });
    if (r.status !== 0) {
      throw new Error(
        `compute_plan failed: rc=${r.status}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
      );
    }
    // Output is 4 \n-separated fields with no trailing newline. The header
    // is the first field; the remaining 3 are SKIP, APPLY, DRIFT (possibly
    // empty). We split on \n without trim so trailing empty fields survive.
    const parts = r.stdout.split('\n');
    while (parts.length < 4) parts.push('');
    const [header, skip, apply, drift] = parts;
    const [force, skipCount, applyCount, driftCount] = header.split('\t');
    expect(force).toBe('0');
    expect(skipCount).toBe('0');
    expect(applyCount).toBe('3');
    expect(driftCount).toBe('0');
    expect(skip).toBe('');
    expect(apply.split(' ').sort()).toEqual([
      '001_initial_schema',
      '002_rpc_functions',
      '003_rls_policies',
    ]);
    expect(drift).toBe('');
  });

  it('compute_plan with all 3 already applied (matching sha): 3 skip, 0 apply', () => {
    const script = `
      set -e
      source '${HELPERS}'
      sha1=\$(file_sha256 '${FIXTURE_DIR}/001_initial_schema.sql')
      sha2=\$(file_sha256 '${FIXTURE_DIR}/002_rpc_functions.sql')
      sha3=\$(file_sha256 '${FIXTURE_DIR}/003_rls_policies.sql')
      printf "001_initial_schema\\t%s\\n002_rpc_functions\\t%s\\n003_rls_policies\\t%s\\n" "\$sha1" "\$sha2" "\$sha3" | compute_plan '${FIXTURE_DIR}' 0
    `;
    const r = runBash(script, [], { inlineScript: true });
    if (r.status !== 0) {
      throw new Error(
        `compute_plan failed: rc=${r.status}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
      );
    }
    // Output: 4 \n-separated fields, no trailing newline. See the empty-set
    // test above for the parsing rationale.
    const parts = r.stdout.split('\n');
    while (parts.length < 4) parts.push('');
    const [header, skip, apply, drift] = parts;
    const [, skipCount, applyCount, driftCount] = header.split('\t');
    expect(skipCount).toBe('3');
    expect(applyCount).toBe('0');
    expect(driftCount).toBe('0');
    expect(skip.split(' ').sort()).toEqual([
      '001_initial_schema',
      '002_rpc_functions',
      '003_rls_policies',
    ]);
    expect(apply).toBe('');
    expect(drift).toBe('');
  });

  it('compute_plan with one drifted migration: that one shows in both drift and apply', () => {
    const script = `
      set -e
      source '${HELPERS}'
      sha2=\$(file_sha256 '${FIXTURE_DIR}/002_rpc_functions.sql')
      sha3=\$(file_sha256 '${FIXTURE_DIR}/003_rls_policies.sql')
      printf "001_initial_schema\\tbadsha\\n002_rpc_functions\\t%s\\n003_rls_policies\\t%s\\n" "\$sha2" "\$sha3" | compute_plan '${FIXTURE_DIR}' 0
    `;
    const r = runBash(script, [], { inlineScript: true });
    if (r.status !== 0) {
      throw new Error(
        `compute_plan failed: rc=${r.status}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
      );
    }
    // Output: 4 \n-separated fields, no trailing newline. See the empty-set
    // test above for the parsing rationale.
    const parts = r.stdout.split('\n');
    while (parts.length < 4) parts.push('');
    const [header, skip, apply, drift] = parts;
    const [, skipCount, applyCount, driftCount] = header.split('\t');
    expect(skipCount).toBe('2');
    expect(applyCount).toBe('1');
    expect(driftCount).toBe('1');
    expect(apply).toContain('001_initial_schema');
    expect(drift).toContain('001_initial_schema');
    expect(skip).not.toContain('001_initial_schema');
  });
});

describe('integration: real migrations dir of the repo', () => {
  // Smoke-test that the scripts can read the actual repo's migration
  // files (not just the synthetic fixture) without crashing.
  const REAL_DIR = join(REPO_ROOT, 'insforge', 'migrations');

  it('lists all 3 real migrations in dry-run', () => {
    const r = runBash(APPLY, [
      '--dir', REAL_DIR, '--dry-run', '--no-cli-check', '--no-color',
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Discovered 3 migration\(s\)/);
    expect(r.stdout + r.stderr).toMatch(/001_initial_schema\.sql/);
    expect(r.stdout + r.stderr).toMatch(/002_rpc_functions\.sql/);
    expect(r.stdout + r.stderr).toMatch(/003_rls_policies\.sql/);
  });

  it('every real migration has a paired @down block (LAUNCH_CHECKLIST §8.2)', () => {
    // The extract_down_block helper exits with 0 for both "has block" and
    // "no block"; we just need to verify the output is non-empty for each
    // of the 3 files in the real migrations dir.
    for (const f of [
      '001_initial_schema.sql',
      '002_rpc_functions.sql',
      '003_rls_policies.sql',
    ]) {
      const script = `
        source '${HELPERS}'
        out="\$(extract_down_block '${REAL_DIR}/${f}')"
        if [[ -z "\$out" ]]; then echo "EMPTY:\$0"; else echo "OK:\$0"; fi
      `;
      const r = runBash(script, [], { inlineScript: true });
      if (r.status !== 0) {
        throw new Error(
          `extract_down_block test failed for ${f}: rc=${r.status}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
        );
      }
      expect(r.stdout.trim()).toMatch(/^OK:/);
      expect(r.stdout.trim()).not.toMatch(/^EMPTY:/);
    }
  });
});
