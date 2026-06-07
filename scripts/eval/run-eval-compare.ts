/**
 * Side-by-side comparison harness — runs the eval against two AI recordings
 * (or two live models if --live is passed) and emits a comparison report.
 *
 * Usage:
 *   # default: mock gpt-4o-mini vs mock claude-haiku (deterministic, no API key)
 *   npm run eval:compare
 *
 *   # custom recordings:
 *   tsx scripts/eval/run-eval-compare.ts \
 *     --left scripts/eval/recordings-left.json --left-label left \
 *     --right scripts/eval/recordings-right.json --right-label right
 *
 *   # live (requires OPENROUTER_API_KEY + network):
 *   OPENROUTER_API_KEY=sk-or-... tsx scripts/eval/run-eval-compare.ts --live
 *
 * Output:
 *   eval-output/compare-<left>-vs-<right>-<timestamp>.md
 *   eval-output/compare-<left>-vs-<right>-<timestamp>.json
 *   eval-output/compare-<left>-vs-<right>-<timestamp>.csv  (per-row side-by-side)
 *
 * Reproducibility:
 *   The mock recordings are checked into git. To rerun a recorded live
 *   comparison, pass --left-recording eval-output/recording-left.json
 *   --right-recording eval-output/recording-right.json.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { runHarness, type RunResult } from './run-eval.js';
import { DEFAULT_RECORDING, type Recording } from './mock-ai-client.js';
import { CLAUDE_HAIKU_RECORDING } from './recordings-claude-haiku.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'eval-output');

interface CliArgs {
  leftLabel: string;
  rightLabel: string;
  leftRecording?: Recording;
  rightRecording?: Recording;
  live: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    leftLabel: 'mock-gpt-4o-mini',
    rightLabel: 'mock-claude-haiku',
    live: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--left-label' && argv[i + 1]) args.leftLabel = argv[++i];
    else if (a === '--right-label' && argv[i + 1]) args.rightLabel = argv[++i];
    else if (a === '--left-recording' && argv[i + 1]) {
      args.leftRecording = JSON.parse(fs.readFileSync(argv[++i], 'utf8')) as Recording;
    } else if (a === '--right-recording' && argv[i + 1]) {
      args.rightRecording = JSON.parse(fs.readFileSync(argv[++i], 'utf8')) as Recording;
    } else if (a === '--live') {
      args.live = true;
    }
  }
  return args;
}

function loadRecordingOrDefault(
  explicit: Recording | undefined,
  defaultRec: Recording,
  liveLabel: string,
): Recording {
  if (explicit) return explicit;
  if (liveLabel.includes('claude') || liveLabel.includes('haiku')) return CLAUDE_HAIKU_RECORDING;
  return defaultRec;
}

interface ComparisonRow {
  fixtureId: string;
  label: string;
  expectedDecision: string;
  leftDecision: string;
  rightDecision: string;
  leftDecisionMatch: boolean;
  rightDecisionMatch: boolean;
  leftRubricPass: boolean;
  rightRubricPass: boolean;
  leftRubricMean: number;
  rightRubricMean: number;
  winner: 'left' | 'right' | 'tie' | 'both-fail';
}

function compareResults(left: RunResult, right: RunResult): ComparisonRow[] {
  const leftById = new Map(left.scores.map((s) => [s.fixtureId, s]));
  const rightById = new Map(right.scores.map((s) => [s.fixtureId, s]));
  const allIds = new Set([...leftById.keys(), ...rightById.keys()]);
  const rows: ComparisonRow[] = [];
  for (const id of [...allIds].sort()) {
    const l = leftById.get(id);
    const r = rightById.get(id);
    if (!l || !r) continue;
    const lPass = l.decisionMatch && l.confidencePass && l.rubricPass;
    const rPass = r.decisionMatch && r.confidencePass && r.rubricPass;
    let winner: ComparisonRow['winner'];
    if (lPass && rPass) winner = 'tie';
    else if (lPass && !rPass) winner = 'left';
    else if (!lPass && rPass) winner = 'right';
    else {
      // Both fail at the all-pass level — fall back to rubric mean.
      if (l.rubricMean > r.rubricMean) winner = 'left';
      else if (r.rubricMean > l.rubricMean) winner = 'right';
      else winner = 'both-fail';
    }
    rows.push({
      fixtureId: l.fixtureId,
      label: l.label,
      expectedDecision: l.expectedDecision,
      leftDecision: l.actualDecision,
      rightDecision: r.actualDecision,
      leftDecisionMatch: l.decisionMatch,
      rightDecisionMatch: r.decisionMatch,
      leftRubricPass: l.rubricPass,
      rightRubricPass: r.rubricPass,
      leftRubricMean: l.rubricMean,
      rightRubricMean: r.rubricMean,
      winner,
    });
  }
  return rows;
}

function writeComparisonCsv(rows: ComparisonRow[], outPath: string): void {
  const header = [
    'fixture_id',
    'label',
    'expected_decision',
    'left_decision',
    'right_decision',
    'left_decision_match',
    'right_decision_match',
    'left_rubric_pass',
    'right_rubric_pass',
    'left_rubric_mean',
    'right_rubric_mean',
    'winner',
  ];
  const lines = [header, ...rows.map((r) => [
    r.fixtureId,
    r.label,
    r.expectedDecision,
    r.leftDecision,
    r.rightDecision,
    r.leftDecisionMatch ? '1' : '0',
    r.rightDecisionMatch ? '1' : '0',
    r.leftRubricPass ? '1' : '0',
    r.rightRubricPass ? '1' : '0',
    r.leftRubricMean.toFixed(3),
    r.rightRubricMean.toFixed(3),
    r.winner,
  ])].map((row) => row.map((c) => {
    const s = String(c);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
}

function writeComparisonMd(
  rows: ComparisonRow[],
  left: RunResult,
  right: RunResult,
  outPath: string,
): void {
  const leftPasses = rows.filter((r) => r.leftRubricPass).length;
  const rightPasses = rows.filter((r) => r.rightRubricPass).length;
  const leftDecisionCorrect = rows.filter((r) => r.leftDecisionMatch).length;
  const rightDecisionCorrect = rows.filter((r) => r.rightDecisionMatch).length;
  const leftWins = rows.filter((r) => r.winner === 'left').length;
  const rightWins = rows.filter((r) => r.winner === 'right').length;
  const ties = rows.filter((r) => r.winner === 'tie').length;
  const bothFail = rows.filter((r) => r.winner === 'both-fail').length;
  const total = rows.length;

  const lines: string[] = [];
  lines.push(`# Model Comparison: ${left.label} vs ${right.label}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Fixtures: ${total}`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(`| Metric | ${left.label} | ${right.label} | Δ |`);
  lines.push('|---|---|---|---|');
  lines.push(`| Decision match | ${leftDecisionCorrect}/${total} (${pct(leftDecisionCorrect, total)}) | ${rightDecisionCorrect}/${total} (${pct(rightDecisionCorrect, total)}) | ${signed(rightDecisionCorrect - leftDecisionCorrect)} |`);
  lines.push(`| Rubric pass    | ${leftPasses}/${total} (${pct(leftPasses, total)}) | ${rightPasses}/${total} (${pct(rightPasses, total)}) | ${signed(rightPasses - leftPasses)} |`);
  lines.push(`| Shape pass     | ${left.shapePasses}/${left.shapeTotal} | ${right.shapePasses}/${right.shapeTotal} | ${signed(right.shapePasses - left.shapePasses)} |`);
  lines.push('');
  lines.push(`Head-to-head (decision+confidence+rubric all pass):`);
  lines.push(`- ${left.label} wins: ${leftWins}`);
  lines.push(`- ${right.label} wins: ${rightWins}`);
  lines.push(`- ties: ${ties}`);
  lines.push(`- both fail: ${bothFail}`);
  lines.push('');

  // Per-fixture detail
  lines.push('## Per-fixture detail');
  lines.push('');
  lines.push(`| ID | Expected | ${left.label} | ${right.label} | Winner |`);
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    const leftMark = r.leftDecisionMatch && r.leftRubricPass ? '✅' : '❌';
    const rightMark = r.rightDecisionMatch && r.rightRubricPass ? '✅' : '❌';
    const winner =
      r.winner === 'left' ? `← ${left.label}` :
      r.winner === 'right' ? `${right.label} →` :
      r.winner === 'tie' ? 'tie' : 'both fail';
    lines.push(`| \`${r.fixtureId}\` | ${r.expectedDecision} | ${leftMark} ${r.leftDecision} (R ${r.leftRubricMean.toFixed(2)}) | ${rightMark} ${r.rightDecision} (R ${r.rightRubricMean.toFixed(2)}) | ${winner} |`);
  }
  lines.push('');

  // Divergences: only true disagreements (one wins, the other doesn't)
  const divergences = rows.filter((r) => r.winner === 'left' || r.winner === 'right');
  if (divergences.length > 0) {
    lines.push('## Divergences (where models disagree)');
    lines.push('');
    for (const r of divergences) {
      lines.push(`- \`${r.fixtureId}\` (${r.label}): ${left.label} ${r.leftDecision}/R${r.leftRubricMean.toFixed(2)} vs ${right.label} ${r.rightDecision}/R${r.rightRubricMean.toFixed(2)} — ${r.winner === 'both-fail' ? 'both fail' : `winner=${r.winner}`}`);
    }
    lines.push('');
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

function signed(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

function pct(n: number, d: number): string {
  if (d === 0) return '0%';
  return `${Math.round((1000 * n) / d) / 10}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.live && !process.env.OPENROUTER_API_KEY) {
    console.error('eval:compare --live requires OPENROUTER_API_KEY in the environment.');
    process.exit(2);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const leftRecording = loadRecordingOrDefault(args.leftRecording, DEFAULT_RECORDING, args.leftLabel);
  const rightRecording = loadRecordingOrDefault(args.rightRecording, CLAUDE_HAIKU_RECORDING, args.rightLabel);

  // If --live is set, swap the OpenRouterAiClient in. For now, the mock is
  // the only path used by this script — the live comparison is run via
  // `scripts/eval/run-eval-live.ts --record ...` and the resulting recording
  // is fed into this script with --left-recording / --right-recording.
  if (args.live) {
    console.error('eval:compare --live is not implemented in this script. Run scripts/eval/run-eval-live.ts to capture a recording, then re-run eval:compare with --left-recording / --right-recording.');
    process.exit(2);
  }

  console.log(`Running left:  ${args.leftLabel} (${Object.keys(leftRecording).length} recorded responses)`);
  const left = await runHarness({ label: args.leftLabel, recording: leftRecording, outDir: OUTPUT_DIR });
  console.log(`  decision: ${left.decisionCorrect}/${left.total}  rubric: ${left.rubricPass}/${left.total}`);

  console.log(`Running right: ${args.rightLabel} (${Object.keys(rightRecording).length} recorded responses)`);
  const right = await runHarness({ label: args.rightLabel, recording: rightRecording, outDir: OUTPUT_DIR });
  console.log(`  decision: ${right.decisionCorrect}/${right.total}  rubric: ${right.rubricPass}/${right.total}`);

  const rows = compareResults(left, right);
  const baseName = `compare-${left.label}-vs-${right.label}-${stamp}`;
  const csvPath = path.join(OUTPUT_DIR, `${baseName}.csv`);
  const mdPath = path.join(OUTPUT_DIR, `${baseName}.md`);
  const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);

  writeComparisonCsv(rows, csvPath);
  writeComparisonMd(rows, left, right, mdPath);
  fs.writeFileSync(jsonPath, JSON.stringify({
    left: { label: left.label, total: left.total, decisionAccuracy: left.decisionAccuracy, rubricPassRate: left.rubricPassRate, shapePasses: left.shapePasses, shapeTotal: left.shapeTotal, csvPath: left.csvPath, mdPath: left.mdPath, jsonPath: left.jsonPath },
    right: { label: right.label, total: right.total, decisionAccuracy: right.decisionAccuracy, rubricPassRate: right.rubricPassRate, shapePasses: right.shapePasses, shapeTotal: right.shapeTotal, csvPath: right.csvPath, mdPath: right.mdPath, jsonPath: right.jsonPath },
    rows,
  }, null, 2), 'utf8');

  console.log('');
  console.log('──────────────────────────────────────────────');
  console.log(`Comparison: ${left.label} vs ${right.label}`);
  console.log(`Decision:   L ${left.decisionCorrect}/${left.total}  R ${right.decisionCorrect}/${right.total}`);
  console.log(`Rubric:     L ${left.rubricPass}/${left.total}    R ${right.rubricPass}/${right.total}`);
  console.log(`CSV:        ${csvPath}`);
  console.log(`Report:     ${mdPath}`);
  console.log(`JSON:       ${jsonPath}`);
  console.log('──────────────────────────────────────────────');
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
    console.error(err);
    process.exit(1);
  });
}
