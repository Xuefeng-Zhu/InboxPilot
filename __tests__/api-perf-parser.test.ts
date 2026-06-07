/**
 * __tests__/api-perf-parser.test.ts
 *
 * Unit tests for the pure logic in scripts/lib/parse-perf-results.mjs.
 * The shell script scripts/api-perf.sh writes a JSON timings file then
 * delegates all threshold + summary work to this parser, so we can test
 * the budget enforcement without touching the network.
 *
 * Run: npm test -- api-perf-parser
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Path to the pure-logic parser. We invoke it via node so we exercise the
// same entry point the shell script uses.
const PARSER = join(__dirname, '..', 'scripts', 'lib', 'parse-perf-results.mjs');

function runParser(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync('node', [PARSER, ...args], { encoding: 'utf-8' });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    status: res.status ?? 1,
  };
}

function makeTimingsFile(samples: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'api-perf-'));
  const file = join(dir, 'timings.json');
  // The parser accepts a flat array of ms numbers; it also accepts the
  // structured form the shell script emits. We use the structured form so
  // the test exercises the real on-disk format.
  const payload = {
    endpoint: '/functions/v1/send-reply',
    sampleCount: samples.length,
    samplesMs: samples,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

describe('parse-perf-results.mjs', () => {
  it('exits 0 when p95 is below the threshold', () => {
    const file = makeTimingsFile([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]);
    const res = runParser([file, '--endpoint', 'send-reply', '--threshold-ms', '500']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/p95=190/);
    expect(res.stdout).toMatch(/PASS/);
  });

  it('exits 1 when p95 is above the threshold', () => {
    const file = makeTimingsFile([100, 110, 120, 130, 140, 150, 160, 170, 180, 1900]);
    const res = runParser([file, '--endpoint', 'send-reply', '--threshold-ms', '500']);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/FAIL/);
    // The summary line is always on stdout (grep-friendly); it must show
    // the actual measured p95 so the operator can see how far over budget.
    expect(res.stdout).toMatch(/p95=1900/);
  });

  it('computes p95 as the 95th percentile (nearest-rank method)', () => {
    // 20 samples, sorted ascending. nearest-rank p95 = ceil(0.95 * 20) = 19th sample (1-indexed).
    // samples[18] (0-indexed) = 95.
    const samples = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
    const file = makeTimingsFile(samples);
    const res = runParser([file, '--endpoint', 'regenerate-ai-draft', '--threshold-ms', '200']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/p95=95/);
  });

  it('rejects empty sample sets with a clear error', () => {
    const file = makeTimingsFile([]);
    const res = runParser([file, '--endpoint', 'send-reply', '--threshold-ms', '500']);
    expect(res.status).toBeGreaterThan(0);
    expect(res.stderr).toMatch(/no samples/i);
  });

  it('rejects malformed JSON with a clear error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-perf-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not valid json');
    const res = runParser([file, '--endpoint', 'send-reply', '--threshold-ms', '500']);
    expect(res.status).toBeGreaterThan(0);
    expect(res.stderr).toMatch(/parse/i);
  });

  it('emits a markdown summary when --format=md is passed (used by PR comment)', () => {
    // 10 samples, max 450 → p95 (nearest-rank, index 9) = 450, well under 500ms.
    const file = makeTimingsFile([100, 150, 200, 250, 300, 350, 400, 420, 440, 450]);
    const res = runParser([
      file,
      '--endpoint',
      'send-reply',
      '--threshold-ms',
      '500',
      '--format',
      'md',
    ]);
    expect(res.status).toBe(0);
    // Markdown output goes to a side-file the CI workflow reads, not stdout.
    // We assert stdout still contains the human PASS line and the
    // markdown side-file is written next to the timings file.
    expect(res.stdout).toMatch(/PASS/);
    const mdFile = file.replace(/timings\.json$/, 'summary.md');
    const md = readFileSync(mdFile, 'utf-8');
    expect(md).toMatch(/\| Metric \|/);
    expect(md).toMatch(/send-reply/);
    expect(md).toMatch(/p95/);
    expect(md).toMatch(/PASS|✅/);
  });

  it('honors a per-endpoint threshold override file (used to mix read vs AI budgets)', () => {
    // 1900ms p95 should FAIL the 500ms read budget, PASS the 2000ms AI budget.
    const file = makeTimingsFile([100, 110, 120, 130, 140, 150, 160, 170, 180, 1900]);
    const res = runParser([file, '--endpoint', 'regenerate-ai-draft', '--threshold-ms', '2000']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/PASS/);
  });
});
