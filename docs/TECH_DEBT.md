# InboxPilot — Tech-Debt Backlog (LOW / INFO findings)

> Last updated: 2026-06-07 · source of truth: this document
> Pair with: `QA_BUG_HUNT.md` (the source of every entry below) · `LAUNCH_CHECKLIST.md` · `ARCHITECTURE.md` · `TESTING.md`
> Kanban parent: `t_pm_tech_debt_backlog` · initial source: `t_qa_bug_hunt` (run 11, commit 965092e)

## How to read this

This is the **picking list** for engineering work that is real but does **not** block v1 launch. Every entry here came out of the QA bug-hunt at LOW or INFO severity. CRITICAL / HIGH / MEDIUM findings live in `QA_BUG_HUNT.md` and were spawned as individual cards (see `t_qa_bug_hunt`'s created_cards list).

**Engineering is expected to pick from this doc between releases**, not to clear the whole list in one sprint. The doc exists so a LOW finding does not get lost for six months and re-surface as a HIGH.

**PM owns:** populating entries, applying the picking-order heuristic, reviewing quarterly, and promoting an entry to a card when promote criteria fire.
**Engineering owns:** picking from the top of the order, leaving a one-line PR link when an entry is closed, and flagging new tech debt they encounter so PM can add it here.

---

## Picking-order heuristic

When a reviewer opens this doc and asks "what do I work on next?", the answer is determined by theme, not by age. Earlier themes always beat later ones.

| Priority | Theme | Definition | Examples |
|---|---|---|---|
| 1 | **Correctness** | Anything that could silently drop a message, mis-route an escalation, lose an audit log, or break a state machine. Even "just a test failure" if it indicates the implementation is wrong. | Stuck job claims, real test failures in core flow, missing actor-role checks on exposed mutators |
| 2 | **Tenant isolation** | Anything that smells like a missing RLS check, a caller-supplied org id, or a dead RBAC permission. **An INFO finding here is a P0 until reviewed** because it is the kind of issue that becomes CRITICAL the moment the next feature ships on top of it. | Unused RBAC permissions (false sense of safety), skipped RLS integration suites, environment files that bake in a real org id |
| 3 | **Provider fragility** | Anything that locks to one SMS/email provider without going through the adapter, or that could become a 500 the moment a stub is registered. | Unregistered stub adapters throwing "not implemented" |
| 4 | **Cost / performance** | O(n²) work, N+1 queries, serial calls to a batch endpoint, client-side filters over server data. | Serial embeddings, client-side date filters |
| 5 | **DX / cleanliness** | Style nits, lint config, type-assertion cleanup, test-fidelity improvements. Never blocks a release. | Missing `npm run lint` config, `as unknown as` test casts |

Theme wins, even across entries. A Theme 4 entry is picked before a Theme 5 entry, regardless of which was added to the doc first.

### Heuristic applied to the current entries (worked examples)

These three worked examples show the heuristic in action. They are the entries most likely to be picked first.

1. **LOW-2 → Theme 1, pick first.** A real test failure in the SMS provider credential-rotation flow means *either* the implementation is wrong (a credential gets attributed to the wrong send) *or* the test is wrong (the implementation is fine but the regression net is broken). Either outcome is a correctness issue. This is the top pick regardless of age.
2. **LOW-6 → Theme 1 and Theme 2, pick second.** The skipped integration suites include `rls-policies` (Theme 2) plus the four end-to-end inbound/outbound flow suites (Theme 1). Unskipping `rls-policies` is non-negotiable before beta opens to external tenants; unskipping the flow suites catches whole-class correctness regressions in CI. Pick as a single PR.
3. **INFO-3 → Theme 2, pick before any Theme 3 / 4 / 5.** An unused `view_analytics` permission in `rbac.ts` is a dead-RBAC entry — a future dev will see it in the role matrix, assume the analytics page is permission-gated, and skip the guard. This is the textbook "smells like a missing RLS check" case and bumps to P0-until-reviewed.

Entries 4-6 (LOW-8, INFO-4, LOW-3) are Theme 1 but lower urgency than the top three. Entries 7-9 (LOW-1, LOW-7, LOW-11) are Theme 5 and can wait for a tidy-up sprint.

---

## Backlog entries

Entries are grouped by theme, with the picking order going top-to-bottom within each theme. Effort: S = < 1 day, M = 1-3 days, L = > 3 days. Risk of leaving it: low / med / high.

### Theme 1 — Correctness

#### LOW-2 — Real test failure in SMS provider credential-rotation
- **File:line:** `packages/support-core/__tests__/unit/sms-provider-credential-rotation.test.ts:411`
- **Issue:** Test asserts that the third send after credential rotation has external id `SM3` but the implementation returns `SM4`. Either the test is stale or the rotation logic is off-by-one — both indicate a real correctness gap in the credential-rotation path.
- **Suggested pick-up:** Fix in the next PR that touches the SMS adapter. Investigate which is right (test vs. implementation) and add a regression test if one is missing.
- **Effort:** S · **Risk of leaving it:** **high** (a misattributed credential could mean a customer message is billed to the wrong provider account, or sent through an expired credential).

#### LOW-6 — Six integration test suites are file-level skipped (45 todo tests)
- **File:line:** `packages/support-core/__tests__/integration/{rls-policies,realtime-events,inbound-email-flow,inbound-sms-flow,outbound-message-flow,seed-idempotency}.test.ts`
- **Issue:** 45 integration tests covering the highest-risk paths (RLS, end-to-end message flow, realtime, seed idempotency) are all file-level skipped. They were deferred pre-launch; leaving them skipped means the QA coverage matrix shows green while the most important paths are unverified.
- **Suggested pick-up:** Unskip `rls-policies` and the four flow suites as a single PR (Theme 1 + Theme 2 value in one merge). `realtime-events` and `seed-idempotency` can wait for the next sprint if a real-time InsForge instance is not available in CI.
- **Effort:** L · **Risk of leaving it:** **high** (a regression in any of these paths will not be caught by CI; the team will only learn about it from a customer or a manual probe).

#### LOW-8 — `OrganizationService.changeMemberRole` does not check the actor's role
- **File:line:** `packages/support-core/src/services/organization-service.ts:112-161`
- **Issue:** The function does not verify that the caller has permission to change roles. It is not currently exposed as an entrypoint, so the risk is latent — but the moment any UI or function-call wires it up, a viewer-tier member could promote themselves to admin.
- **Suggested pick-up:** Add a `callerRole` parameter and call `checkPermission(actor, 'manage_members')` at the top of the function. Fix now while the entrypoint surface is small; do not wait for the UI to land and retrofit.
- **Effort:** S · **Risk of leaving it:** **med** (latent, but high-impact when triggered — privilege escalation).

#### INFO-4 — `claim_support_jobs` does not journal failed claims
- **File:line:** `insforge/functions/claim_support_jobs` (no `claimed_at` column on the jobs table)
- **Issue:** If a worker calls `claim_support_jobs` and crashes before `complete()` or `fail()`, the job stays in `'claimed'` status forever. A real-world example: a worker OOMs mid-handle, the next poll sees the job as already claimed, the message is silently dropped from the customer's perspective.
- **Suggested pick-up:** Add a `claimed_at` timestamp to the `support_jobs` row, and a sweeper function that re-claims any job whose `claimed_at < now() - 5min`. Pair with a test that simulates a worker crash mid-handle.
- **Effort:** M · **Risk of leaving it:** **med** (rare-but-silent failures; customer sees a stuck conversation with no error).

#### LOW-3 — Unhandled rejection in `retry.test.ts:188`
- **File:line:** `packages/support-core/__tests__/unit/retry.test.ts:188`
- **Issue:** `makeTransient` creates a `retryable` Error and the test does not `await` the rejecting promise. The test is intended to verify the retry logic, but the unhandled rejection silences the actual signal — meaning a regression in the retry path would not produce a test failure.
- **Suggested pick-up:** Wrap in `expect(...).rejects.toThrow(...)` or add the missing `await`. Trivial; bundle with LOW-2.
- **Effort:** XS · **Risk of leaving it:** **med** (the retry test is one of the few things standing between v1 and a silent outage; it should actually work).

### Theme 2 — Tenant isolation

#### INFO-3 — `view_analytics` permission is defined but never read
- **File:line:** `packages/support-core/src/services/rbac.ts` (enum), `app/analytics/page.tsx` (no guard)
- **Issue:** The permission appears in the role matrix; the analytics page does not check it. A future developer reading the role matrix will assume the page is permission-gated and skip the guard. This is the classic "dead RBAC" smell — a tenant-isolation regression waiting for the next refactor.
- **Suggested pick-up:** Either (a) add a page-level guard on `app/analytics/page.tsx` that calls `checkPermission(user, 'view_analytics')`, or (b) remove the permission from the enum. **Treat as P0-until-reviewed** per the heuristic: any Theme 2 INFO is a P0 until a human looks at it.
- **Effort:** S · **Risk of leaving it:** **high** (a customer in the wrong tier gets the analytics page; the RBAC matrix is now lying).

#### LOW-6 (Theme 2 portion) — `rls-policies` integration suite is skipped
- **See Theme 1 entry above.** Listed again here because the RLS portion alone (Theme 2) is a launch prerequisite for external beta tenants.
- **Suggested pick-up:** Unskip just the `rls-policies` suite if the flow suites are blocked on infra. Theme 2 work should not wait for Theme 1 work.
- **Effort:** M (subset of L above) · **Risk of leaving it:** **high**.

#### INFO-1 — `.env.example` ships a concrete dev InsForge URL
- **File:line:** `.env.example:11`
- **Issue:** `NEXT_PUBLIC_INSFORGE_URL=https://y39ezar3.us-east.insforge.app` looks like a real dev instance URL. If `y39ezar3` corresponds to any real-tenant-shaped data, this is an information leak via the repo. Even if it is a clean sandbox, baking in a concrete instance id is the kind of artifact that gets copy-pasted into a customer's `.env.local` six months from now.
- **Suggested pick-up:** Replace with a clearly-fake placeholder (`https://example.insforge.app` or `https://YOUR-INSTANCE.insforge.app`) and add a comment explaining where to find the real URL.
- **Effort:** XS · **Risk of leaving it:** **low** (likely benign; flagged because the heuristic says any Theme 2 INFO is reviewed).

### Theme 3 — Provider fragility

#### INFO-2 — Eight stub adapters throw "not implemented" but are not registered
- **File:line:** `packages/support-core/src/adapters/{email-stubs,sms-stubs}.ts` (8 stub classes)
- **Issue:** The stub adapters exist in the codebase and throw `"not implemented"` from every method. They are not currently registered in any entrypoint, so they are not a runtime risk today. The moment someone adds a registration (e.g. for a new provider without a real adapter yet), every call will produce a 500. The build gives no warning.
- **Suggested pick-up:** Either (a) convert the stubs to `abstract` classes that TypeScript will refuse to instantiate, or (b) add a build-time check (`tsc --noEmit` over the adapter registry) that fails if a stub is registered.
- **Effort:** S · **Risk of leaving it:** **low** (not registered; but a one-line registration away from a 500).

### Theme 4 — Cost / performance

#### LOW-9 — `KnowledgeIngestionService` does serial embeddings
- **File:line:** `packages/support-core/src/services/knowledge-ingestion-service.ts:52-66`
- **Issue:** The serial `for` loop calls `createEmbedding` once per chunk. The OpenAI batch endpoint accepts up to 2048 inputs per call. The difference is 10-100x for a typical KB doc, and it is the difference between "ingest in 30 seconds" and "ingest in 30 minutes" — the latter makes the in-app "Add knowledge" button feel broken.
- **Suggested pick-up:** Switch to the batch endpoint behind a feature flag. Measure wall-clock before/after; commit the numbers. Pick after Theme 1/2/3 are clear.
- **Effort:** M · **Risk of leaving it:** **med** (UX only, no data risk; but a real-feeling breakage for power users).

#### LOW-10 — `app/analytics/page.tsx` end-date filter is client-side
- **File:line:** `app/analytics/page.tsx:101`
- **Issue:** The `lte` end-date filter is applied in JavaScript after the SQL `select`. As conversations scale, the page loads all rows and filters in-memory — both a memory and a wire-cost problem at the scale we expect at v1.1+.
- **Suggested pick-up:** Move the `lte` to the `select` query. Trivial change, real cost win. Pair with a quick perf check on a seeded 10k-conversation org.
- **Effort:** S · **Risk of leaving it:** **low** at v1 launch, **med** at v1.1+ scale.

### Theme 5 — DX / cleanliness

#### LOW-1 — `npm run lint` is unrunnable in CI
- **File:line:** `package.json:9` (script), root (missing `.eslintrc.json`)
- **Issue:** `npm run lint` triggers an interactive ESLint wizard because no config exists and `eslint` is not a dev dependency. The team has no static-analysis gate.
- **Suggested pick-up:** Add `eslint@^8.57.1` + `eslint-config-next@^14.2.0` to devDependencies, write `.eslintrc.json` extending `next/core-web-vitals`, and add a CI step. Pick this up the next time the DX / tidy-up sprint comes around.
- **Effort:** S · **Risk of leaving it:** **low** (no functional risk; quality-of-life).

#### LOW-7 — 20 `as unknown as` type assertions in test files
- **File:line:** (scattered across `packages/support-core/__tests__/`)
- **Issue:** The assertions make tests brittle to interface changes — a renamed field in a service interface can leave 20 tests compiling but actually exercising the wrong shape. Contained to tests, so risk is low.
- **Suggested pick-up:** Introduce typed mock builders (e.g. `vi.mocked`) and migrate the assertions incrementally. Pick this up when a service interface next changes (a single PR is the natural unit of work).
- **Effort:** M · **Risk of leaving it:** **low**.

#### LOW-4 — `OrganizationService.createOrganization` has no slug validation
- **File:line:** `packages/support-core/src/services/organization-service.ts:34-60`
- **Issue:** The slug accepts any string. A user could create a slug of `"../etc/passwd"` or `"  spaces  "` and break URL routing, deep links, or downstream consumers that assume a slug shape.
- **Suggested pick-up:** Add a zod regex (`^[a-z0-9-]{3,32}$`) at the top of `createOrganization`. Small, mechanical.
- **Effort:** S · **Risk of leaving it:** **low** (defense in depth, not an active bug).

#### LOW-5 — `OrganizationService.createOrganization` has no slug-uniqueness retry
- **File:line:** `packages/support-core/src/services/organization-service.ts:34-60`
- **Issue:** If two users create the same slug simultaneously, one will fail with a unique-violation error and the user sees a confusing 500-style message.
- **Suggested pick-up:** Catch the unique-violation and retry with a numeric suffix (`acme-2`, `acme-3`, ...). Pair with LOW-4.
- **Effort:** S · **Risk of leaving it:** **low** (UX, not data).

#### LOW-11 — `lib/use-realtime.ts` re-creates interval on callback change
- **File:line:** `lib/use-realtime.ts:50-61`
- **Issue:** Already mitigated by `callbacksRef`. No action required.
- **Suggested pick-up:** None. Listed here so the next QA pass does not re-flag the same finding. Move it to the "closed" section below once the QA pass after v1.0 is complete.
- **Effort:** — · **Risk of leaving it:** none.

---

## Promote criteria — when a LOW/INFO becomes a card

A backlog entry graduates to an individual kanban card when **any one** of the following fires:

1. **Theme escalation.** A reviewer (PM, eng-lead, or QA) determines the entry is actually a Theme 1 or Theme 2 issue. Re-tag it; do not let it sit here as "just LOW" when the heuristic says P0-until-reviewed.
2. **Surfaces 3+ times.** The same root cause appears in three separate findings (current or future QA passes). One finding is LOW; three findings is a pattern. Spawn a card that fixes the pattern, not each instance.
3. **Reaches its risk threshold.** A LOW entry with `Risk of leaving it: high` that has not been picked in 90 days graduates to a card. The 90-day clock starts when the entry lands in this doc.
4. **Blocks a planned feature.** A new feature cannot ship without the entry being fixed. PM or eng-lead escalates it during release planning.
5. **Customer-visible.** A LOW entry becomes customer-visible (e.g. a UX papercut with multiple support tickets). PM promotes it to a card on the next support sync.

**Default decision rule for the quarterly review:** if any reviewer is uncomfortable with an entry still being in this doc, promote it. The cost of an extra card is low; the cost of a LOW becoming a CRITICAL in production is high.

---

## Quarterly review cadence

**Frequency:** every 90 days, with the engineering lead.
**Owner:** PM (drives the meeting) + ENG-LEAD (brings engineering's pick list).
**Format:** 30-minute walkthrough. PM presents the doc top-to-bottom in theme order. ENG-LEAD flags any entry that has become a blocker since the last review. Outcomes per entry are: **pick next** (move to a card), **defer** (leave here, document why), or **close** (move to closed section below with a one-line reason).

**Scheduling.** Schedule the first review in the calendar as a recurring event for the calendar quarter following v1 launch, then re-evaluate cadence after the first two reviews. The PM who owns this doc keeps a `next-review-date:` line in this header (currently: TBD — schedule with ENG-LEAD before v1 launch).

**What this review is not.** It is not a sprint planning session and not a place to add new features. New work comes from `t_pm_*` planning cards, not from this doc. The review exists only to triage what is already in the backlog.

---

## Closed entries (move here when an entry is done)

This section is intentionally empty at first publication. Entries should be moved here with a one-line summary of how they were resolved (PR link, "wait for v2 refactor", "no longer relevant", etc.). This gives the next reviewer a quick "did we already do this?" check.

---

## Provenance

- All 15 entries (LOW-1 through LOW-11, INFO-1 through INFO-4) come from `t_qa_bug_hunt` run 11, committed as `965092e` in `docs/QA_BUG_HUNT.md`.
- The theme assignments above are PM's application of the picking-order heuristic to the QA findings, not a copy of the QA author's own theme tags. Where PM and QA disagree, PM's tag wins for picking order and the original tag is preserved in the `QA_BUG_HUNT.md` reference.
- The promote criteria section borrows language from the existing `LAUNCH_CHECKLIST.md` and `SUPPORT_PLAYBOOK.md` to keep the docs family consistent.
