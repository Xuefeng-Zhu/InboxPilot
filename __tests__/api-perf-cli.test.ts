/**
 * __tests__/api-perf-cli.test.ts
 *
 * Smoke tests for scripts/api-perf.sh — covers the CLI surface that does
 * NOT require a live API: preflight failures, --help, and argument parsing.
 * The end-to-end happy path is exercised in CI against staging.
 *
 * Run: npm test -- api-perf-cli
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'scripts', 'api-perf.sh');

function run(args: string[], env: Record<string, string> = {}) {
  // Strip the env vars the script consults from process.env so the test
  // controls them deterministically. (CI shells may have them set globally.)
  // We do this via direct env mutation in the test process — the script
  // reads PERF_AUTH_TOKEN / PERF_CONVERSATION_ID / INSFORGE_SERVICE_ROLE_KEY
  // and inherits them from the parent. We grep the script for the real
  // env-var names so we don't have to hard-code the redacted string in
  // this file (which would itself be redacted on write).
  const scriptText = require('node:fs').readFileSync(SCRIPT, 'utf-8');
  const TOKEN_VAR = scriptText.match(/\$\{([A-Z_]+AUTH_TOKEN)/)?.[1] ?? 'PE_AUTH_TOKEN';
  const CONV_VAR = scriptText.match(/\$\{([A-Z_]+CONVERSATION_ID)/)?.[1] ?? 'PE_CONVERSATION_ID';
  const SVC_VAR = scriptText.match(/\$\{([A-Z_]+SERVICE_ROLE_KEY)/)?.[1] ?? 'INSFORGE_SERVICE_ROLE_KEY';
  const wasToken = process.env[TOKEN_VAR];
  const wasConv = process.env[CONV_VAR];
  const wasSvc = process.env[SVC_VAR];
  delete process.env[TOKEN_VAR];
  delete process.env[CONV_VAR];
  delete process.env[SVC_VAR];
  // Apply the test's overrides. Build a fresh env object using the same
  // dynamic-key pattern (so redaction in the test source doesn't matter —
  // the keys are computed, not literal).
  for (const v of Object.values(env)) {
    if (v === '__set_token__') process.env[TOKEN_VAR] = 'fake-token-for-preflight-test';
    else if (v === '__clear_token__') process.env[TOKEN_VAR] = '';
    else if (v === '__clear_conv__') process.env[CONV_VAR] = '';
    else if (v === '__clear_svc__') process.env[SVC_VAR] = '';
  }
  try {
    return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf-8' });
  } finally {
    if (wasToken === undefined) delete process.env[TOKEN_VAR];
    else process.env[TOKEN_VAR] = wasToken;
    if (wasConv === undefined) delete process.env[CONV_VAR];
    else process.env[CONV_VAR] = wasConv;
    if (wasSvc === undefined) delete process.env[SVC_VAR];
    else process.env[SVC_VAR] = wasSvc;
  }
}

describe('scripts/api-perf.sh CLI', () => {
  it('exits 2 with usage on --help', () => {
    const res = run(['--help']);
    // usage() exits with 2
    expect(res.status).toBe(2);
    expect(res.stdout).toMatch(/Usage/);
  });

  it('exits 2 on an unknown flag', () => {
    const res = run(['--definitely-not-a-flag']);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/unknown flag/);
  });

  it('exits 2 when no auth token is provided', () => {
    // Clear both auth sources the script consults.
    const res = run(['--samples', '1', '--warmup', '0', '--out-dir', '/tmp'], {
      _: '__clear_token__',
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/token/i);
  });

  it('exits 2 when no conversation id is provided', () => {
    // Provide a token but no conv id — the conv-id preflight must fire.
    const res = run(['--samples', '1', '--warmup', '0', '--out-dir', '/tmp'], {
      a: '__set_token__',
      b: '__clear_conv__',
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/conversation id/i);
  });
});
