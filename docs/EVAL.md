# AI Evaluation Harness

End-to-end regression testing for `ai-agent-service.ts`. Runs 24 golden
conversations through the agent, scores the resulting `ai_decisions` row
(decision, confidence, requires_human) and the response text against a
per-fixture rubric.

## What's in the box

```
packages/support-core/__tests__/golden/
  types.ts              — fixture schema (GoldenConversation, Rubric, ExpectedDecision)
  index.ts              — 24 golden conversations + GOLDEN_CONVERSATIONS export
scripts/eval/
  run-eval.ts           — main harness; produces CSV + JSON + Markdown report
  run-eval-compare.ts   — side-by-side comparison of two recordings
  run-eval-live.ts      — drives a real OpenRouter model, writes a recording
  eval-gate.ts          — regression gate (current vs baseline)
  mock-ai-client.ts     — deterministic offline AiClient (CI default)
  openrouter-ai-client.ts — real-model AiClient (live runs only)
  rubric-judge.ts       — HeuristicRubricJudge (CI) + LiveRubricJudge (LLM-as-judge)
  recordings-claude-haiku.ts — canned second-model recording for the comparison
.github/workflows/
  eval-gate.yml         — CI gate + live comparison job
```

## Quick start

```bash
# Run the full suite against the mock gpt-4o-mini (default — no API key)
npm run eval
# → eval-output/results-mock-gpt-4o-mini-<stamp>.{csv,md,json}

# Side-by-side comparison of two models
npm run eval:compare
# → eval-output/compare-mock-gpt-4o-mini-vs-mock-claude-haiku-<stamp>.{csv,md,json}

# Regression gate (PRs)
npm run eval:gate
# exits 0 on pass, 1 on >5pp regression
```

## Outputs

### Per-run: `results-<label>-<timestamp>.{csv,md,json}`

CSV columns (one row per fixture):

| column | meaning |
|---|---|
| `conversation_id` | stable id (`gc-NNN-slug`) |
| `expected_decision` | `respond` / `escalate` / `clarify` |
| `actual_decision` | what the agent decided |
| `decision_match` | 1 if equal, 0 if not |
| `expected_escalation_rule` | the rule we expected (e.g. `HumanRequestRule`), or empty |
| `actual_escalation_rule` | the rule the engine actually fired |
| `expected_requires_human` | 1 if we expected a human handoff |
| `actual_requires_human` | 1 if the decision was marked `requires_human` |
| `expected_outbound_enqueued` | 1 if we expected a `send_outbound_message` job |
| `actual_outbound_enqueued` | 1 if a job was enqueued |
| `confidence` | LLM-reported confidence (0..1) |
| `min_confidence` | the floor the fixture requires |
| `confidence_pass` | 1 if `confidence >= min_confidence` |
| `rubric_pass` | 1 if all rubric criteria pass |
| `rubric_mean` | mean of all rubric criterion scores (0..1) |
| `rubric_score_ids` | per-criterion scores, `r-id=0.50\|r-id2=1.00\|...` |
| `response_text` | first 200 chars of the agent's response |
| `tags` | agent tags (comma-joined) |
| `shape_checks_pass` / `shape_checks_total` | count of decision-shape assertions passing |

The JSON summary (`results-<label>-<timestamp>.json`) is the canonical
input to the regression gate:

```json
{
  "label": "mock-gpt-4o-mini",
  "total": 24,
  "decisionCorrect": 23,
  "decisionAccuracy": 0.958,
  "rubricPass": 17,
  "rubricPassRate": 0.708,
  "shapePasses": 54,
  "shapeTotal": 56
}
```

### Comparison: `compare-<L>-vs-<R>-<timestamp>.{csv,md,json}`

Headline table:

```
| Metric | mock-gpt-4o-mini | mock-claude-haiku | Δ |
|---|---|---|---|
| Decision match | 23/24 (95.8%) | 24/24 (100%) | +1 |
| Rubric pass    | 17/24 (70.8%) | 17/24 (70.8%) | 0 |
| Shape pass     | 54/56         | 55/56         | +1 |
```

Per-fixture side-by-side, plus a `## Divergences` section listing only
the rows where the two models actually disagree on the all-pass check
(decision+confidence+rubric).

## The 24 golden conversations

Roughly:

- **5 pre-LLM escalation rule triggers** — `HumanRequestRule`,
  `ProfanityAngerRule`, `SensitiveTopicRule`, `MissingKnowledgeRule`,
  `KeywordRule`. The LLM is never called.
- **8 LLM-driven "respond"** — returns, hours, shipping, password reset,
  multi-turn follow-up, greeting, etc.
- **4 LLM-driven "clarify"** — vague order, vague broken, two questions,
  off-topic.
- **4 LLM-driven "escalate"** — repeat complaint, account closure, billing
  error, complex integration.
- **2 ai-mode=off** — AI is disabled; `RespondRule` fires anyway because
  `processMessage` is still invoked.
- **2 edge cases** — LLM returns invalid JSON, LLM call throws.

Each fixture includes a rubric (1–4 criteria) covering length, tone,
key-fact inclusion, and any "must mention X / must not Y" assertions
the team cares about.

## Mock vs live

By default the harness uses `MockAiClient` — a deterministic offline
client that plays back canned responses keyed by the golden-conversation
id. CI uses this; no API key, no network.

To run against a real model:

```bash
OPENROUTER_API_KEY=*** npx tsx scripts/eval/run-eval-live.ts \
  --model openai/gpt-4o-mini --label live-gpt-4o-mini
# writes eval-output/live/recording-live-gpt-4o-mini.json

# Replay the recording through the standard harness (no API key needed):
npx tsx scripts/eval/run-eval-compare.ts \
  --left-label live-gpt-4o-mini --left-recording eval-output/live/recording-live-gpt-4o-mini.json \
  --right-label mock-claude-haiku --right-recording scripts/eval/recordings-claude-haiku.ts
```

A live recording is deterministic in the sense that you only need to
hit the API once; subsequent comparisons can be replayed offline.

## The LLM-as-judge

The `RubricJudge` interface has two implementations:

- **`HeuristicRubricJudge`** (CI default) — regex/keyword-based; covers
  "mentions X", "no emoji", "concise under N chars", "professional tone",
  and a few others. Reproducible. The harness also handles
  harness-side criteria like "tags include X" and "reasoning mentions
  Y" that the judge can't see from response text alone.
- **`LiveRubricJudge`** — calls a separate LLM (default
  `anthropic/claude-3-5-sonnet`) and parses structured JSON scores.
  Optional; not used in CI.

To swap the judge:

```ts
import { LiveRubricJudge } from './scripts/eval/rubric-judge.js';
const judge = new LiveRubricJudge(openRouterCallLlm, 'anthropic/claude-3-5-sonnet');
await runHarness({ label: 'gpt-4o-mini-judged-by-sonnet', judge, ... });
```

## Regression gate

The gate is a separate script that compares a current run's summary
JSON against a stored baseline:

```bash
# First time: seed the baseline after a known-good run
npm run eval
cp "$(ls -t eval-output/results-mock-gpt-4o-mini-*.json | head -1)" \
   eval-output/baseline.json

# PRs / local: check the current run
npm run eval:gate -- --current-label mock-gpt-4o-mini

# On main: refresh the baseline
npm run eval:gate:write-baseline

# Self-test: confirm the gate fires on a 10pp drop
npm run eval:gate:self-test
```

Behaviour:

- Strictly-greater drop > `5pp` on `rubricPassRate` or `decisionAccuracy`
  → exit 1
- Otherwise → exit 0
- A 0.01pp epsilon absorbs floating-point noise at the boundary
  (5.000000000000001pp ≡ 5pp ≡ pass)

The CI workflow (`.github/workflows/eval-gate.yml`) runs on every PR
that touches `packages/support-core/`, `scripts/eval/`, or the workflow
file itself. It also runs a synthetic 10pp drop on every PR — if the
gate does NOT fire, the workflow fails (the gate is broken, it would
not catch a real regression).

On push to main, the workflow refreshes `eval-output/baseline.json` so
the next PR compares against the latest green commit.

## Acceptance criteria (from t_qa_ai_eval)

| criterion | status |
|---|---|
| 20+ golden conversations in `packages/support-core/__tests__/golden/` | ✅ 24 |
| `npm run eval` runs the harness and writes a CSV to `eval-output/` | ✅ |
| CI gate fires on a synthetic 10% drop | ✅ (verified locally: rc=1) |
| Comparison report between two models is reproducible | ✅ (deterministic from checked-in recordings) |

## Pitfalls

- **Run-eval uses a fixture's system-prompt marker to find the right
  canned response.** The mock injects `[EVAL_GC:<id>]` into the system
  prompt; the client looks that up. Don't strip the marker in your
  service code, or the mock will throw `could not find [EVAL_GC:<id>]
  marker in messages`.
- **The "current" run for the gate is `--current-label mock-gpt-4o-mini`-
  filtered** because `eval-output/` accumulates every run; otherwise
  the comparison would pick the most-recent file, which is whatever
  model you happened to run last. Always pass `--current-label` in CI.
- **Confidence 0.00 for pre-escalation fixtures is correct.** When a
  pre-LLM rule fires, the agent returns `confidence: 0` and
  `requires_human: true`; the fixture's `minConfidence: 0` accepts it.
  Don't bump the threshold to "0.5" thinking it's a bug.
- **The recordings are JSON, not TS.** A common footgun: editing
  `mock-ai-client.ts` to point at a new fixture id without also adding
  the recording. The mock throws `no recording for golden conversation
  "gc-XXX"`.
- **Floating-point boundary.** At exactly 5pp drop, the gate is on the
  edge (`5.000000000000004pp`). The 0.01pp epsilon handles it; if you
  tighten the threshold below 0.01pp you may need a different
  comparison strategy.
