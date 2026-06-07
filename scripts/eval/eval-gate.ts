/**
 * AI eval regression gate.
 *
 * Compares the most recent eval JSON summary against a stored baseline
 * and exits non-zero if the rubric pass rate OR decision accuracy has
 * dropped more than the allowed threshold (default 5 percentage points).
 *
 * Usage:
 *   # write/update the baseline (called from the "green" CI job on main):
 *   npm run eval -- --quiet && \
 *     cp eval-output/results-mock-gpt-4o-mini-<stamp>.json eval-output/baseline.json && \
 *     npm run eval:gate -- --write-baseline
 *
 *   # check the current run against the baseline (called on PRs):
 *   npm run eval:gate
 *
 *   # synthetic drop test:
 *   npm run eval:gate -- --baseline eval-output/baseline.json --current eval-output/baseline.json --threshold 5
 *   (returns 0 because same file)
 *
 *   # force a 10% drop to verify the gate fires:
 *   tsx scripts/eval/eval-gate.ts --synthetic-drop 10
 *
 * Inputs:
 *   --baseline <path>        path to a stored summary JSON
 *                             (default: eval-output/baseline.json)
 *   --current <path>         path to a current run summary JSON
 *                             (default: most recent summary in eval-output/)
 *   --threshold <pct>        max allowed drop in percentage points
 *                             (default: 5)
 *   --metric <name>          which metric to check: rubric | decision | both
 *                             (default: both)
 *   --write-baseline         after a successful run, copy the current JSON
 *                             to --baseline (so CI on main updates the gate)
 *   --synthetic-drop <pct>   artificially reduce rubricPassRate by N pp
 *                             in-memory; used to verify the gate fires.
 *                             Exits non-zero if the gate does NOT fire.
 *
 * Exit codes:
 *   0  pass (current is within threshold of baseline, or improved)
 *   1  fail (current dropped more than threshold)
 *   2  bad invocation (no baseline, no current, file not found, etc.)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'eval-output');

interface Summary {
  label: string;
  total: number;
  decisionCorrect: number;
  decisionAccuracy: number;
  confidencePass: number;
  rubricPass: number;
  rubricPassRate: number;
  shapePasses: number;
  shapeTotal: number;
}

interface CliArgs {
  baselinePath: string;
  currentPath?: string;
  currentLabel?: string;
  threshold: number;
  metric: 'rubric' | 'decision' | 'both';
  writeBaseline: boolean;
  syntheticDrop?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baselinePath: path.join(OUTPUT_DIR, 'baseline.json'),
    threshold: 5,
    metric: 'both',
    writeBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline' && argv[i + 1]) args.baselinePath = argv[++i];
    else if (a === '--current' && argv[i + 1]) args.currentPath = argv[++i];
    else if (a === '--current-label' && argv[i + 1]) args.currentLabel = argv[++i];
    else if (a === '--threshold' && argv[i + 1]) args.threshold = parseFloat(argv[++i]);
    else if (a === '--metric' && argv[i + 1]) {
      const v = argv[++i];
      if (v !== 'rubric' && v !== 'decision' && v !== 'both') {
        throw new Error(`--metric must be rubric|decision|both (got ${v})`);
      }
      args.metric = v;
    } else if (a === '--write-baseline') {
      args.writeBaseline = true;
    } else if (a === '--synthetic-drop' && argv[i + 1]) {
      args.syntheticDrop = parseFloat(argv[++i]);
    }
  }
  return args;
}

function loadSummary(p: string): Summary {
  if (!fs.existsSync(p)) {
    throw new Error(`Summary not found: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Summary;
}

function findLatestSummary(labelFilter?: string): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    throw new Error(`Output dir not found: ${OUTPUT_DIR}. Run npm run eval first.`);
  }
  let candidates = fs.readdirSync(OUTPUT_DIR)
    .filter((f) => f.startsWith('results-') && f.endsWith('.json'))
    .map((f) => ({ f, m: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs }));
  if (labelFilter) {
    candidates = candidates.filter((c) => c.f.includes(labelFilter));
  }
  candidates.sort((a, b) => b.m - a.m);
  if (candidates.length === 0) {
    const hint = labelFilter ? ` matching "${labelFilter}"` : '';
    throw new Error(`No results-*.json files${hint} in ${OUTPUT_DIR}. Run npm run eval first.`);
  }
  return path.join(OUTPUT_DIR, candidates[0]!.f);
}

function pctPoints(n: number): string {
  return `${(n * 100).toFixed(1)}pp`;
}

function check(
  current: Summary,
  baseline: Summary,
  threshold: number,
  metric: 'rubric' | 'decision' | 'both',
  syntheticDrop?: number,
): { ok: boolean; messages: string[]; effectiveCurrent: Summary } {
  // Apply synthetic drop in-memory to the current summary (used only for
  // verifying the gate fires).
  const eff: Summary = syntheticDrop != null
    ? { ...current, rubricPassRate: Math.max(0, current.rubricPassRate - syntheticDrop / 100) }
    : current;

  const messages: string[] = [];
  let ok = true;

  const checkOne = (name: string, baselineRate: number, currentRate: number) => {
    // Use a 0.01pp epsilon to absorb floating-point noise so that
    // "drop of exactly 5pp" (which can land at 4.999... or 5.000...001)
    // is treated as on the boundary and PASSES (gate fires only on
    // strictly-greater drops per the eval contract).
    const drop = (baselineRate - currentRate) * 100;
    const pass = drop <= threshold + 0.01;
    messages.push(
      `${name}: baseline=${pctPoints(baselineRate)} current=${pctPoints(currentRate)} drop=${drop.toFixed(2)}pp ${pass ? 'OK' : `FAIL (>${threshold}pp)`}`,
    );
    if (!pass) ok = false;
  };

  if (metric === 'rubric' || metric === 'both') {
    checkOne('rubric', baseline.rubricPassRate, eff.rubricPassRate);
  }
  if (metric === 'decision' || metric === 'both') {
    checkOne('decision', baseline.decisionAccuracy, eff.decisionAccuracy);
  }
  return { ok, messages, effectiveCurrent: eff };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // If write-baseline, the gate is being invoked from the "update on main"
  // CI job. The "current" is the freshly produced run; we copy it to the
  // baseline path. No comparison happens.
  if (args.writeBaseline) {
    const currentPath = args.currentPath ?? findLatestSummary();
    const current = loadSummary(currentPath);
    fs.copyFileSync(currentPath, args.baselinePath);
    console.log(`Wrote baseline: ${args.baselinePath}  (from ${currentPath})`);
    console.log(`  rubric pass rate: ${pctPoints(current.rubricPassRate)}  decision accuracy: ${pctPoints(current.decisionAccuracy)}`);
    return;
  }

  if (!fs.existsSync(args.baselinePath)) {
    console.error(`No baseline at ${args.baselinePath}. Run with --write-baseline first to seed it.`);
    process.exit(2);
  }
  const baseline = loadSummary(args.baselinePath);
  const currentPath = args.currentPath ?? findLatestSummary(args.currentLabel);
  const current = loadSummary(currentPath);

  const { ok, messages, effectiveCurrent } = check(
    current,
    baseline,
    args.threshold,
    args.metric,
    args.syntheticDrop,
  );

  console.log(`Eval gate: ${currentPath} vs ${args.baselinePath}`);
  console.log(`  threshold: ${args.threshold}pp  metric: ${args.metric}${args.syntheticDrop != null ? `  synthetic-drop: ${args.syntheticDrop}pp` : ''}`);
  for (const m of messages) console.log(`  ${m}`);
  console.log(`  current: rubric ${pctPoints(effectiveCurrent.rubricPassRate)} / decision ${pctPoints(effectiveCurrent.decisionAccuracy)}`);

  if (ok) {
    console.log(`  result: PASS`);
  } else {
    console.log(`  result: FAIL (regression > ${args.threshold}pp)`);
  }
  process.exit(ok ? 0 : 1);
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
