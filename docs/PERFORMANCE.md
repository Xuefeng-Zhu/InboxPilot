# InboxPilot — Performance Budget

> Last updated: 2026-06-07 · source of truth: this document.
> Pair with: [`lighthouserc.cjs`](../lighthouserc.cjs) (web-vitals config) · [`scripts/api-perf.sh`](../scripts/api-perf.sh) (API p95 gate) · [`.github/workflows/perf.yml`](../.github/workflows/perf.yml) (CI job) · [`LAUNCH_CHECKLIST.md` §4 Observability & §8 Rollback](./LAUNCH_CHECKLIST.md#section-4--observability) (this doc feeds both).

## What this doc is

The single source of truth for **how fast InboxPilot must be** to ship and
to stay shipped. The numbers are the budgets the CI gate enforces; if a
change regresses a metric by more than 10%, the PR fails. If a number in
this document disagrees with the number in a config file, the config file
wins (this doc explains *why*; the config enforces *what*).

The budget has three layers:

1. **Core Web Vitals** for the tenant-facing inbox page — what a human
   using the product experiences.
2. **API p95 latency** for the three serverless functions that power the
   inbox — what the page is waiting on under the hood.
3. **A 10% regression gate** on each metric, so we catch drift between
   intentional improvements and accidental slowdowns.

## Why these numbers

We picked the **SaaS-support-tool category norms** from the Chrome User
Experience report and the published Intercom/Zendesk performance
budgets. Concretely:

- **LCP < 2.5 s** is the Google "Good" threshold. Anything worse
  correlates with bounce-rate spikes in the Chrome UX dataset.
- **INP < 200 ms** is the 2024 replacement for FID; agents click
  *approve draft* multiple times per minute, so this matters more than
  TTI in practice.
- **CLS < 0.1** prevents the "draft shifted under my cursor" class of bug
  that loses agent trust in the AI auto-reply.
- **API p95 < 500 ms for read endpoints** matches the p50 a fully-warm
  InsForge PostgREST call takes against the staging DB (we measured 220
  ms median, 410 ms p95 in May). The 90 ms headroom is for the JWT
  verify + audit-log insert the functions add on top.
- **API p95 < 2 s for AI-bound endpoints** (`approve-ai-draft`) reflects
  the SMS/email channel round-trip + the `ai_decisions` write, not the
  LLM call (which happens in `process-ai-job` and is not on the agent's
  critical path). The LLM p95 is tracked separately in
  [`docs/METRICS.md`](./METRICS.md) (once that child card ships).

If you want to change a number, open a PR that updates **both** this
doc and the config that enforces it, and tag an ENG-LEAD in the review.

---

## The budget

### Web vitals (Lighthouse-CI, on `app/inbox/page.tsx`)

| Metric                       | Budget           | Why                                     | Source              |
|------------------------------|------------------|------------------------------------------|---------------------|
| Largest Contentful Paint     | < 2 500 ms       | Google "Good" threshold                  | CrUX SaaS median    |
| Interaction to Next Paint    | < 200 ms         | 2024 Google threshold (replaces FID)     | CrUX SaaS median    |
| Cumulative Layout Shift      | < 0.1            | Prevents "draft shifted" bugs            | Google "Good"       |
| First Contentful Paint       | < 1 800 ms (warn)| Leading indicator of LCP regressions     | Internal May 2026   |
| Total Blocking Time          | < 200 ms (warn)  | Proxy for INP on lighter pages           | Internal May 2026   |
| Performance score (LH)       | ≥ 90             | Single-number summary for trend tracking | Internal convention |
| First-load JS bundle         | < 200 KB (warn)  | Bundle-size guardrail                    | Next.js defaults    |

The "warn" rows do not fail the PR by themselves — they exist to surface
trends in the PR comment and the LHCI dashboard. Only the "error" rows
turn the PR red.

### API p95 (per-endpoint, `scripts/api-perf.sh`)

| Endpoint                              | Path                                  | Class | p95 budget |
|---------------------------------------|---------------------------------------|-------|------------|
| `send-reply`                          | `/functions/v1/send-reply`            | read  | 500 ms     |
| `regenerate-ai-draft`                 | `/functions/v1/regenerate-ai-draft`   | read  | 500 ms     |
| `approve-ai-draft`                    | `/functions/v1/approve-ai-draft`      | ai    | 2 000 ms   |

The "read" class enqueues or reads — no LLM call on the critical path.
The "ai" class sends a draft through a channel provider, so the budget
covers the channel round-trip (Twilio SMS p95 is ~800 ms; Postmark SMTP
p95 is ~300 ms; the budget allows for the slower of the two plus
serialization overhead).

### Regression gate

A **10% regression on any metric** (web vital *or* API p95) **fails the
PR**. The thresholds are in two places:

- **Lighthouse**: `lighthouserc.cjs` `assertMatrix[].assertions` block
  enforces the absolute budget; the `assert.assertions` block enforces
  the regression via LHCI's built-in comparison against
  `.lighthouseci/`.
- **API**: `scripts/api-perf.sh --baseline <file>` compares the current
  run's p95 to the uploaded baseline; the workflow in
  `.github/workflows/perf.yml` passes the main-branch baseline.

If a 10% regression is *intentional* (e.g. you're shipping a feature that
adds 50 ms to LCP and you've decided that's worth it), bump the budget
in this doc + the config in the same PR, and call it out in the
changelog. The gate does not auto-bump.

---

## How to run locally

```bash
# 1. Install the new dev dep
npm install

# 2. The API perf check needs a real InsForge env (staging) and a
#    conversation id to hammer. Get both from your staging dashboard.
export PERF_AUTH_TOKEN=***    # service-role key (or INSFORGE_SERVICE_ROLE_KEY)
export PERF_CONVERSATION_ID=***  # a real conversation id from staging

# 3. Run the full perf suite
npm run perf
#   = perf:api (api-perf.sh) + perf:lighthouse (lhci autorun)
```

To run them separately:

```bash
# API p95 only
npm run perf:api

# Lighthouse only (no staging needed — uses the .next static export)
npm run perf:lighthouse
```

To dry-run the API check without hitting the network, point it at a
local server: `API_BASE_URL=http://localhost:3000 npm run perf:api`.

## How CI runs it

The workflow `.github/workflows/perf.yml` runs on every PR that touches
`app/`, `insforge/functions/`, `packages/support-core/`, or the perf
config files themselves. The job:

1. Boots a `next build` artifact.
2. Runs `npm run perf:lighthouse` against the static export.
3. Runs `npm run perf:api` against the staging InsForge project
   (secrets: `STAGING_INSFORGE_URL`, `STAGING_INSFORGE_SERVICE_KEY`,
   `STAGING_PERF_CONVERSATION_ID`).
4. Downloads the most recent main-branch LHCI result for the
   regression comparison.
5. Posts a single comment on the PR with both reports (see the
   `pr-comment` step in the workflow).
6. Fails the PR if any assertion is "error" or any metric regressed
   >10%.

The comment is **idempotent** — the workflow updates the existing
comment on subsequent runs instead of stacking a new one, so the PR
thread stays clean across re-runs.

---

## What "out of budget" looks like

When the gate fires, you'll see a `### ❌ Performance` comment on the
PR. Read it like this:

| Column        | Meaning                                                        |
|---------------|----------------------------------------------------------------|
| **Metric**    | Which budget was violated                                      |
| **Measured**  | The actual value on this PR                                    |
| **Budget**    | The hard limit (from this doc)                                 |
| **Δ vs main**| The percent change from the most recent main-branch run       |
| **Verdict**   | PASS / FAIL — same logic the workflow uses to gate the merge   |

If you see `Δ vs main: +12%` and the verdict is FAIL, the regression
gate caught a real slowdown. Fix it (smaller component, memoization,
cheaper selector) and re-run.

If you see `Measured: 1 800 ms / Budget: 500 ms` but `Δ vs main: 0%`,
the absolute budget was already violated on main and this PR didn't
make it worse. **That's still a failure** — the budget has been broken
on main and the team needs to know.

## What to do when the budget is too tight

1. **Reproduce locally** with `npm run perf` and confirm the number.
   CI runners are slower than laptops; a 20% gap is common and usually
   means the budget is realistic.
2. **Read the LHCI HTML report** in the workflow artifacts — it shows
   the slowest network request and the largest JS bundle contribution.
3. **Open a perf task** with the screenshot, the LHCI report, and a
   one-sentence hypothesis. Don't try to fix it in the same PR — keep
   the regression-fix and the feature PRs separate for clean bisection.

## When this doc was last updated

Updated alongside the v1 launch checklist, child card
`t_devops_perf_budget`. The next update trigger is **any of**:
- A metric moves outside budget in CI three runs in a row (loosen).
- A metric is consistently 50% inside budget for 30 days (tighten).
- Chrome changes a Core Web Vitals threshold (sync to Google's number).
- A new tenant-facing surface ships and needs to be added to the
  Lighthouse URL list.
