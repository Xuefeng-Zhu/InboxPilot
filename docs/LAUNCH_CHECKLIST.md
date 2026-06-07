# InboxPilot v1 — Launch Checklist (go / no-go)

> Last updated: 2026-06-07 · source of truth: this document
> Pair with: `../.kiro/specs/ai-customer-support/requirements.md` (PRD) · `ARCHITECTURE.md` · `DATABASE.md` · `TESTING.md` · `API.md` · `SUPPORT_PLAYBOOK.md` · **`COMPETITIVE.md`** (the "why not X" positioning map; the §7 pitch and the per-tier design-partner profiles are explicitly "vs Front / Intercom Fin / Ada / Forethought / DIY")
> Kanban parent: `t_pm_launch_checklist`

## How to read this

This is the **single source of truth** for "do we ship v1 today?". If a box is unchecked, the answer is no. If a verifier signs the row, the box is true *and* the evidence path resolves. Slack memory and standup chatter are not evidence.

**Decision rule.** v1 ships when **every** section's "All criteria met" row is checked **and** a verifier (named below) has countersigned. Any single unchecked criterion is a launch blocker; the only way to unblock is to fix the criterion or escalate to a `kanban_block` from the owner.

**Roles used in owner columns.** PM (product), ENG-LEAD (engineering), ENG-SEC (security), QA, DEVOPS, DESIGN. Each section names the **role** responsible; the current human filling that role lives in the sign-off block at the bottom and is captured per-task in Kanban.

---

## Section 1 — Functional readiness

**Goal.** Every P0 user story is implemented, demoed end-to-end on a real InsForge instance, and the demo data is realistic.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 1.1 | Every P0 story in `requirements.md` has a passing implementation | ☐ | `git grep` shows code in `insforge/functions/` for the 14 entrypoints; `packages/support-core/src/services/` covers all 10 services (InboundMessage, OutboundMessage, AiAgent, EscalationEngine, KnowledgeIngestion, Organization, Rbac, AiDecisionParser, JobQueue). Cross-checked against `requirements.md` acceptance bullets. | ENG-LEAD |
| 1.2 | End-to-end demo recording exists and shows: (a) inbound SMS → AI draft → agent approval → outbound SMS, (b) inbound email → AI auto-reply with KB retrieval, (c) escalation to human on profanity trigger | ☐ | File: `docs/demo/v1-e2e-recording.mp4` (or Loom URL) — must show real curl/HTTP calls against a staging InsForge instance, not mocks. | PM |
| 1.3 | At least 3 test tenants are seeded with realistic data (1 SaaS, 1 e-commerce, 1 services) | ☐ | `insforge/seed.sql` currently seeds only 1 tenant (Acme Support). Extend to a `seed_demo.sql` with 3 tenants, each with ≥5 conversations, ≥2 KB docs, varied message history. Run `psql $DATABASE_URL -f insforge/seed_demo.sql` against staging and capture row counts. | PM + ENG-LEAD |
| 1.4 | P1 user stories have an explicit "deferred to v1.1" callout in the release notes | ☐ | `RELEASE_NOTES_v1.md` lists every P1 with reason + target version. | PM |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 2 — Multi-tenant safety

**Goal.** No code path, RLS gap, or webhook misconfig can let org A read or write org B's data. Proven by automated test *and* a manual cross-tenant probe, not just by the test passing.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 2.1 | `packages/support-core/__tests__/integration/rls-policies.test.ts` passes on a freshly migrated database | ☐ | `npm test -- rls-policies` exits 0 against a DB created from `001_initial_schema.sql` + `002_rpc_functions.sql` + `003_rls_policies.sql` with **no** seed data. Use `scripts/apply-migrations.sh` (do not apply via `psql -f` — raw psql executes the `-- @down` block and leaves the schema in a half-state; see RLS_AUDIT Finding 5). Capture CI run URL. | QA + ENG-SEC |
| 2.2 | Manual cross-tenant probe: as a JWT for org A, attempting `SELECT * FROM conversations WHERE organization_id = '<org B id>'` returns 0 rows for each of `conversations`, `messages`, `contacts`, `knowledge_documents` | ☐ | `docs/evidence/tenant-isolation-probe.txt` — full psql session output showing the four `SELECT` attempts and the empty result sets. The session must use a real org-B-issued JWT, not a service-role key. | ENG-SEC |
| 2.3 | `audit_logs` RLS is append-only — `UPDATE` and `DELETE` on `audit_logs` raise a permission error even for org admins | ☐ | `docs/evidence/audit-append-only.txt` — `UPDATE audit_logs SET ...` and `DELETE FROM audit_logs` both return `ERROR: permission denied for table audit_logs`. | ENG-SEC |
| 2.4 | Credential columns (`sms_provider_accounts.credentials_secret_id`, `email_provider_accounts.credentials_secret_id`) are not readable by the `anon` role | ☐ | `docs/evidence/credential-column-rls.txt` — `SELECT credentials_secret_id FROM sms_provider_accounts` as anon returns 0 rows; the secret_id itself is a UUID pointer, not the raw key. | ENG-SEC |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 3 — AI safety

**Goal.** The escalation engine deterministically catches the 8 known trigger patterns *before* the LLM is called, and there is a written, rehearsed playbook for the day the AI sends a wrong reply.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 3.1 | All 8 escalation rules are present in `packages/support-core/src/services/escalation-rules.ts` and tested with positive + negative fixtures | ☐ | Rules: `HumanRequestRule`, `ProfanityAngerRule`, `SensitiveTopicRule`, `SafetyConcernRule`, `MissingKnowledgeRule`, `LowConfidenceRule`, `RepeatedFailureRule`, `KeywordRule`. Tests: `packages/support-core/__tests__/unit/escalation-engine.test.ts` and `__tests__/properties/escalation.prop.test.ts` cover each rule with ≥ 1 positive + 1 negative case. | ENG-LEAD |
| 3.2 | Integration test proves the `process-ai-job` function calls the LLM **only when** the escalation engine returns `triggered: false` | ☐ | `packages/support-core/__tests__/integration/ai-safety.test.ts` — assert `mockOpenRouter.chatCompletion` is not called when an escalation rule fires. | ENG-LEAD |
| 3.3 | Incident-response runbook exists for "AI sent a wrong reply" with: detection signal, stop-the-bleed command, customer-comms template, postmortem template | ☐ | `docs/INCIDENT_RESPONSE.md` (produced by child card `t_sec_incident_response`). Must include a 5-minute, 1-hour, and 24-hour checklist. | ENG-SEC + PM |
| 3.4 | At least one tabletop rehearsal of the runbook has been performed | ☐ | Date of rehearsal + participants recorded in `docs/INCIDENT_RESPONSE.md` footer. At minimum: PM, ENG-LEAD, one on-call engineer. | PM |
| 3.5 | LLM cost-per-conversation ceiling is set and the system refuses to send a reply that would exceed it | ☐ | `ai_settings.per_reply_token_cap` enforced in `AiAgentService`. Unit test asserts a high-cap call is rejected. | ENG-LEAD |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 4 — Observability

**Goal.** When something goes wrong at 2am, we can answer "what happened, to which org, at what cost" in <5 minutes from logs alone.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 4.1 | Every function entrypoint under `insforge/functions/` logs a structured JSON line on entry (request_id, org_id, function_name, ts) and on exit (status, duration_ms) | ☐ | `grep -L "console.log(JSON.stringify" insforge/functions/**/index.ts` returns no results. A sample line in `docs/evidence/structured-log-sample.json`. | ENG-LEAD |
| 4.2 | `audit_logs` is queryable per org via a documented SQL query that returns under 1s for 30 days of data | ☐ | `docs/METRICS.md` §"Audit log query". Query plan: `EXPLAIN ANALYZE` output pasted. **Cross-link:** `docs/OPERATOR_RUNBOOK.md` §2 (rollback drill record) and §6 (on-call) reference the same log. | DEVOPS |
| 4.3 | Cost-per-conversation metric is computable: a SQL query joins `ai_decisions` (tokens) × OpenRouter price table and divides by `conversations` count, per org per day | ☐ | Same `docs/METRICS.md` §"Cost per conversation". Query + a 1-week run against staging showing per-org cost. | DEVOPS + ENG-LEAD |
| 4.4 | The 5xx alert fires within 5 minutes of a synthetic failure | ☐ | Test: kill `process-jobs` cron for 1 cycle. Pager (or PagerDuty webhook) receives alert. **Cross-link:** `docs/OPERATOR_RUNBOOK.md` §6 (on-call rotation, alert routing) — for v0.1 the alert is a Twilio-SMS to the operator's phone, not PagerDuty. | DEVOPS |
| 4.5 | Web-vitals and API p95 budgets are documented, instrumented, and gated in CI (>10% regression fails the PR) | ☐ | `docs/PERFORMANCE.md` exists with the budget rationale. `lighthouserc.cjs` + `scripts/api-perf.sh` + `.github/workflows/perf.yml` are wired (child card `t_devops_perf_budget`). Last 3 main-branch runs all green. | DEVOPS |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 5 — Documentation

**Goal.** A new engineer can clone the repo, follow the README, and have a working local stack in <30 minutes. A new beta customer can read the public docs and understand what they're signing up for.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 5.1 | README quickstart works on a fresh clone (Linux + macOS) | ☐ | Cold-clone test: `git clone … && cp .env.example .env.local && npm install && npm run dev` succeeds with documented values; smoke test (`curl localhost:3000`) returns 200. | PM |
| 5.2 | PRD exists at a stable, repo-relative path and is the source of truth for requirements | ☐ | `.kiro/specs/ai-customer-support/requirements.md` is current (last touched within 30 days). Cross-linked from README and from this checklist. | PM |
| 5.3 | `docs/USER_STORIES.md` exists with priority tags (P0/P1/P2) and acceptance bullets | ☐ | File exists. Each story links back to a PRD requirement ID. | PM |
| 5.4 | `docs/METRICS.md` exists with: activation, retention, AI-quality, and unit-economics queries | ☐ | File exists. At least 6 SQL queries with sample output. **Cross-link:** `docs/OPERATOR_RUNBOOK.md` §5 (quota reset) reuses the usage_counters queries for the 1st-of-month cron. | DEVOPS |
| 5.5 | `docs/ARCHITECTURE.md` is updated to reflect the 14-function, 8-rule, 17-table reality (no "TBD" sections) | ☐ | File exists at 23k+ lines. No `TODO` or `TBD` markers in body. | ENG-LEAD |
| 5.6 | `docs/README_INDEX.md` table of contents exists, lists every doc in `docs/` with a one-line purpose, and cross-links to PRD, METRICS, USER_STORIES, INCIDENT_RESPONSE, SECURITY_MODEL, LAUNCH_CHECKLIST | ☐ | File exists. All 6 cross-links resolve. | PM |
| 5.7 | All public API endpoints in `insforge/functions/` are documented in `docs/API.md` with request, response, auth, and rate-limit columns | ☐ | Endpoint count in `API.md` matches `ls insforge/functions/ \| wc -l` (14). | ENG-LEAD |
| 5.8 | A secret-rotation runbook exists covering Twilio, Postmark, and OpenRouter with pre-rotation, per-provider, and post-rotation phases | ☐ | `docs/SECRET_ROTATION.md` exists (shipped by `t_devops_secret_rotation`). The runbook is referenced from §6.1 above. | DEVOPS + ENG-SEC |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 6 — Compliance

**Goal.** No secret is in code. No production data leaks via env files. A one-pager explains the security posture well enough to share with a beta customer's CISO.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 6.1 | Credentials are stored in the `credentials_secret_id` column on provider-account tables, never as plaintext in code or env | ☐ | `git grep -i "sk_live\|api_key=\|secret=" -- '*.ts' ':!.env.example'` returns no hits. `insforge/migrations/001_initial_schema.sql` shows `credentials_secret_id text NOT NULL` for both `sms_provider_accounts` and `email_provider_accounts`. A rotation runbook exists at `docs/SECRET_ROTATION.md` and is exercised by `npm run test:rotation` (2 tests). | ENG-SEC |
| 6.2 | `.env.example` contains no real keys — every value is a placeholder (`your-…-key` pattern) | ☐ | `cat .env.example` — visual inspection; an automated `grep -E "sk_live\|pk_live\|[A-Za-z0-9]{32,}" .env.example` returns 0 matches. | ENG-SEC |
| 6.3 | `.env.local`, `.env.production`, and any other populated env files are in `.gitignore` and not committed | ☐ | `cat .gitignore` includes `.env*.local`, `.env.production`. `git log --all --full-history -- .env.local` returns no commits. | ENG-SEC |
| 6.4 | A one-page security model exists: data classification, encryption at rest / in transit, RLS posture, secret lifecycle, vuln-reporting address | ☐ | `docs/SECURITY_MODEL.md` exists (child card `t_sec_security_model`). 10 sections (data classification table + 7 narrative sections + vuln-reporting + compliance). Word count under §6.4 budget. Every claim is anchored to a file:line reference (verified). **Awaiting ENG-LEAD review before tick.** | ENG-LEAD |
| 6.5 | DPA + AUP templates are in `legal/` and cover the data classes actually stored (PII, message content, embeddings, KB, account, metadata, sessions) | ☐ | `legal/DPA.md`, `legal/AUP.md`, `legal/README.md` exist (shipped by `t_sec_dpa_aup`). Coverage table in `legal/README.md` lists every data class. | ENG-SEC + PM |
| 6.6 | No high or critical CVE in `npm audit --production` | ☐ | `npm audit --production --audit-level=high` exits 0. Output saved to `docs/evidence/npm-audit.txt` with the commit SHA it was run against. | DEVOPS |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 7 — Go-to-market

**Goal.** The buyer can find the price, ask to join, and see real names attached to the beta cohort. No "coming soon" pages.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 7.1 | Pricing page is live, lists 2–3 tiers, and the CTA reaches a real endpoint (not a `mailto:` placeholder) | ☐ | Live URL. The CTA button posts to a beta-signup endpoint that writes to a `beta_signups` table or third-party form. | PM |
| 7.2 | Beta signup form exists, persists submissions, and triggers a confirmation email | ☐ | URL + a screenshot of the post-submit state + a sample confirmation email in `docs/evidence/beta-confirmation-email.eml`. | PM |
| 7.3 | The first 5 design-partner tenants are named (real companies, real contacts) with a target onboarding date for each | ☐ | Table in `docs/BETA_COHORT.md` (or inline here): company · contact · vertical · target onboarding date · signed-letter-of-intent Y/N. | PM |
| 7.4 | Onboarding checklist for a design-partner tenant exists: data import, KB upload, channel connect, go-live | ☐ | `docs/design/spec.md` (knowledge-base UX) + a new `docs/ONBOARDING_CHECKLIST.md`. The two together cover the customer-facing flow. | DESIGN + PM |
| 7.5 | A one-pager / pitch deck explaining "what is InboxPilot" exists for sales use | ☐ | `docs/gtm/ONE_PAGER.md` or PDF. Includes the pricing tiers, the 3-tenant demo screenshots, and a clear "next step" CTA. | PM |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Section 8 — Rollback plan

**Goal.** When the worst happens, we can roll back to the last known-good state in <15 minutes with one command, with the data intact.

| # | Criterion | State | Verifiable evidence | Owner |
|---|---|---|---|---|
| 8.1 | Every function in `insforge/functions/` is independently redeployable | ☐ | `insforge functions list` shows 14 deployable units. The deploy script (`scripts/deploy.sh` or equivalent) takes a function name arg and updates only that one. **Cross-link:** `docs/OPERATOR_RUNBOOK.md` §1 (deploy procedure) documents the manual sequence until the script lands. | DEVOPS |
| 8.2 | All SQL migrations are reversible: either a paired `-- @down` block, or a documented `DROP TABLE … CASCADE` chain | ☐ | `grep -L "@down" insforge/migrations/*.sql` returns no results. Down blocks are tested in staging (see 8.4). **Status as of 2026-06-07:** all 3 existing migrations (001, 002, 003) have `-- @down` blocks (added by `t_ops_runbook`). | DEVOPS + ENG-LEAD |
| 8.3 | A one-command rollback script exists that: (a) reverts the most recent migration, (b) re-deploys the previous function versions, (c) verifies the app responds 200 | ☐ | `scripts/rollback.sh` — exists, executable, idempotent. Takes an optional `--to <migration_id>` arg. **Status as of 2026-06-07:** shipped by `t_ops_runbook`. Full procedure in `docs/OPERATOR_RUNBOOK.md` §2. | DEVOPS |
| 8.4 | `scripts/rollback.sh` has been run clean against a staging DB and the resulting app passes a smoke test | ☐ | Date + operator + smoke-test output recorded in `docs/evidence/rollback-drill.txt`. **Status as of 2026-06-07:** script verified via `--dry-run` against all 3 migrations; the live staging drill is owed to a follow-up. | DEVOPS |
| 8.5 | A pre-launch backup of the staging DB exists and can be restored in <30 minutes | ☐ | `pg_dump` output in `s3://inboxpilot-backups/launch-pre/`. Restore time captured in the drill log. | DEVOPS |

**All criteria met?** ☐ · **Sign-off (verifier):** ______________ · **Date:** ______________

---

## Sign-off

| Role | Name | Section(s) owned | Signed off on (date) |
|---|---|---|---|
| PM | _to assign_ | 1, 5, 7 | |
| ENG-LEAD | _to assign_ | 1, 3, 5 | |
| ENG-SEC | _to assign_ | 2, 3, 6 | |
| QA | _to assign_ | 2, 3 | |
| DEVOPS | _to assign_ | 4, 5, 6, 8 | |
| DESIGN | _to assign_ | 7 | |

**Final go / no-go decision.** ☐ GO · ☐ NO-GO

**Decided by:** ______________ · **Date:** ______________

**Reason if NO-GO:** (one sentence; the unchecked criterion is the answer)

---

## Cross-references

- **PRD (requirements source of truth):** `.kiro/specs/ai-customer-support/requirements.md` (`docs/design/spec.md` for the KB UX subset)
- **Architecture:** `docs/ARCHITECTURE.md`
- **Database / RLS:** `docs/DATABASE.md` + `insforge/migrations/003_rls_policies.sql`
- **API reference:** `docs/API.md`
- **Testing strategy:** `docs/TESTING.md`
- **Escalation rules (the 8):** `packages/support-core/src/services/escalation-rules.ts`
- **Support playbook:** `docs/SUPPORT_PLAYBOOK.md`
- **DPA / AUP / legal:** `legal/README.md`, `legal/DPA.md`, `legal/AUP.md`
- **Design spec (KB UX):** `docs/design/spec.md`
- **Performance budget (web vitals + API p95):** `docs/PERFORMANCE.md` — enforced by `lighthouserc.cjs` + `scripts/api-perf.sh` + `.github/workflows/perf.yml`

### Child Kanban cards (this doc is their parent)

- `t_qa_bug_hunt` — QA bug hunt (feeds §1, §2)
- `t_qa_rls_audit` — RLS audit (feeds §2)
- `t_sec_incident_response` — AI incident-response runbook (feeds §3)
- `t_sec_security_model` — one-page security model (feeds §6)
- `t_devops_perf_budget` — performance budget (feeds §4, §8)
- `t_ops_runbook` — `docs/METRICS.md` (feeds §4, §5) AND `docs/OPERATOR_RUNBOOK.md` (feeds §8)
- `t_devops_deploy_script` — `scripts/deploy.sh` (feeds §8.1) — referenced from OPERATOR_RUNBOOK.md §1
- `t_devops_purge_cron` — `purge-offboarded-tenants` cron (feeds §4.3 Phase C, OPERATOR_RUNBOOK.md §4)
- `t_devops_quota_table` — `usage_counters` table + `quota-reset` cron (feeds §5.2, OPERATOR_RUNBOOK.md §5)
- `t_devops_pager_integration` — PagerDuty / proper alert routing (feeds §4.4, §6, OPERATOR_RUNBOOK.md §6.3)
- `t_pm_beta_program` — design-partner cohort (feeds §7)
- `t_pm_pricing_packaging` — pricing page + tiers (feeds §7) — see `docs/PRICING.md` for the 3-tier hypothesis, gating schema, and design-partner profiles
- `t_pm_competitive` — competitive landscape (feeds §7 pitch). See `docs/COMPETITIVE.md` for the 5 one-pagers (Front, Intercom Fin, Ada, Forethought, DIY), the 2-axis positioning map (AI autonomy × channel breadth), and the "We will NOT compete on" anti-PRD (8 items, each with a v2 milestone).

### Open gaps surfaced by this audit (so the next worker doesn't redo it)

These are real, not "feels good". Each gap blocks a section above.

1. `docs/METRICS.md` does not exist → blocks §4.2, §4.3, §5.4
2. `docs/INCIDENT_RESPONSE.md` does not exist → blocks §3.3
3. ~~`docs/SECURITY_MODEL.md` does not exist → blocks §6.4~~ **RESOLVED 2026-06-07** by `t_sec_security_model` — file written, linked from §6.4 evidence column. **Pending ENG-LEAD review** (acceptance criteria 4th bullet) before §6.4 can be ticked.
4. `docs/README_INDEX.md` does not exist → blocks §5.6
5. `docs/USER_STORIES.md` does not exist as a standalone doc (lives inside requirements.md) → blocks §5.3
6. ~~`scripts/rollback.sh` does not exist → blocks §8.3~~ **RESOLVED 2026-06-07** by `t_ops_runbook` (see §8.3 status note)
7. ~~No down-migration blocks in `insforge/migrations/` → blocks §8.2~~ **RESOLVED 2026-06-07** by `t_ops_runbook` (all 3 migrations have `-- @down` blocks; see §8.2 status note)
8. `insforge/seed.sql` creates 1 tenant only; 3-tenant demo seed does not exist → blocks §1.3
9. `packages/support-core/__tests__/integration/ai-safety.test.ts` does not exist → blocks §3.2
10. Escalation test files exist (`unit/escalation-engine.test.ts`, `properties/escalation.prop.test.ts`) but coverage of all 8 rules with positive + negative cases must be verified before §3.1 can be ticked.
11. **NEW 2026-06-07** — `docs/OPERATOR_RUNBOOK.md` §4 Phase C (hard-delete cron) references `purge-offboarded-tenants` cron which does not exist → blocks the offboarding drill verification (the soft-delete + export phases are verified; the hard-delete cron is `t_devops_purge_cron`).
12. **NEW 2026-06-07** — `docs/OPERATOR_RUNBOOK.md` §5 references `usage_counters` table which does not exist in `001_initial_schema.sql` → blocks the v1.1 quota-reset schema change (`t_devops_quota_table`). For v1, the quota cap is enforced per-reply via `ai_settings.per_reply_token_cap` and the runbook's Phase C is a no-op.

Each gap has an owning child card above. The child cards unblock the parent.
