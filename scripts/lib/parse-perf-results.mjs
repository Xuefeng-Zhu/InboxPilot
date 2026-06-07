#!/usr/bin/env node
/**
 * scripts/lib/parse-perf-results.mjs
 *
 * Pure (no-network, no-IO-other-than-the-input-file) parser used by
 * scripts/api-perf.sh. Reads a JSON timings file produced by the shell
 * script, computes p50/p95/p99/max for a single endpoint, and asserts
 * the result against a threshold. Exits 0 on PASS, 1 on FAIL. Emits
 * a human-readable line to stdout and a markdown summary to a side
 * file for the CI workflow to attach as a PR comment.
 *
 * Usage:
 *   node parse-perf-results.mjs <timings.json> \
 *     --endpoint <name> --threshold-ms <ms> [--format text|md]
 *
 * The timings file format (written by api-perf.sh):
 *   {
 *     "endpoint": "/functions/v1/send-reply",
 *     "sampleCount": 20,
 *     "samplesMs": [100, 110, ...],
 *     "capturedAt": "2026-06-07T00:00:00.000Z"
 *   }
 *
 * The parser tolerates either `samplesMs` (preferred) or a top-level
 * `samples` array for backwards compatibility.
 */

'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function fail(msg, code = 2) {
  process.stderr.write(`parse-perf-results: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  let endpoint = '';
  let thresholdMs = NaN;
  let format = 'text';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--endpoint') endpoint = args[++i] ?? '';
    else if (a === '--threshold-ms') thresholdMs = Number(args[++i]);
    else if (a === '--format') format = args[++i] ?? 'text';
    else if (a.startsWith('--')) fail(`unknown flag: ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) fail('expected exactly one positional arg: <timings.json>');
  if (!endpoint) fail('--endpoint is required');
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) fail('--threshold-ms must be a positive number');
  if (format !== 'text' && format !== 'md') fail(`--format must be 'text' or 'md', got '${format}'`);
  return { file: positional[0], endpoint, thresholdMs, format };
}

/**
 * Nearest-rank percentile. For N samples sorted ascending and percentile p in [0,1]:
 *   rank = ceil(p * N)           // 1-indexed
 *   value = sorted[rank - 1]
 *
 * This is the same method Lighthouse-CI and most APM tools use, so our
 * budget numbers line up with what the team sees in the field.
 */
function percentile(sortedSamples, p) {
  if (sortedSamples.length === 0) return NaN;
  const rank = Math.max(1, Math.ceil(p * sortedSamples.length));
  return sortedSamples[rank - 1];
}

function main() {
  const { file, endpoint, thresholdMs, format } = parseArgs(process.argv);

  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail(`could not parse JSON in ${file}: ${err.message}`);
  }

  const samples = Array.isArray(data.samplesMs)
    ? data.samplesMs
    : Array.isArray(data.samples)
      ? data.samples
      : null;
  if (!samples) fail('timings file is missing both "samplesMs" and "samples" arrays');
  if (samples.length === 0) fail('no samples in timings file — was the perf run empty?');
  if (!samples.every((n) => Number.isFinite(n) && n >= 0)) {
    fail('samples must be non-negative finite numbers (milliseconds)');
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const max = sorted[sorted.length - 1];
  const min = sorted[0];
  const mean = sorted.reduce((s, n) => s + n, 0) / sorted.length;

  const passed = p95 <= thresholdMs;
  const verdict = passed ? 'PASS' : 'FAIL';
  const summary = {
    endpoint,
    sampleCount: samples.length,
    minMs: Math.round(min),
    p50Ms: Math.round(p50),
    p95Ms: Math.round(p95),
    p99Ms: Math.round(p99),
    maxMs: Math.round(max),
    meanMs: Math.round(mean),
    thresholdMs,
    verdict,
  };

  // Human line on stdout — grep-friendly, used by the shell script.
  process.stdout.write(
    `${verdict} endpoint=${endpoint} samples=${samples.length} ` +
      `p50=${Math.round(p50)} p95=${Math.round(p95)} p99=${Math.round(p99)} ` +
      `max=${Math.round(max)} threshold=${thresholdMs}ms\n`,
  );

  if (format === 'md') {
    const mdFile = join(dirname(file), 'summary.md');
    const statusEmoji = passed ? '✅' : '❌';
    const md = [
      `### API perf · \`${endpoint}\` ${statusEmoji} ${verdict}`,
      '',
      '| Metric | Value | Budget |',
      '|---|---|---|',
      `| Samples | ${samples.length} | — |`,
      `| Min | ${summary.minMs} ms | — |`,
      `| Mean | ${summary.meanMs} ms | — |`,
      `| p50 | ${summary.p50Ms} ms | — |`,
      `| **p95** | **${summary.p95Ms} ms** | **${thresholdMs} ms** |`,
      `| p99 | ${summary.p99Ms} ms | — |`,
      `| Max | ${summary.maxMs} ms | — |`,
      '',
      passed
        ? `p95 (${summary.p95Ms} ms) is within the ${thresholdMs} ms budget.`
        : `**Regression**: p95 ${summary.p95Ms} ms exceeds the ${thresholdMs} ms budget by ${summary.p95Ms - thresholdMs} ms.`,
      '',
    ].join('\n');
    try {
      writeFileSync(mdFile, md);
    } catch (err) {
      fail(`cannot write ${mdFile}: ${err.message}`);
    }
  }

  process.exit(passed ? 0 : 1);
}

main();
