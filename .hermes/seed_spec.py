"""
InboxPilot kanban seed spec.
Mirrors the PageVault board pattern: PM-authored epics fan out to eng/qa/devops/design
children, with task_links expressing the dependency graph.

Body style: PRD-style (scope, acceptance criteria, file paths, suggested skills, references)
grounded in the real InboxPilot repo surface (17 tables, 14 function entrypoints, 9 services,
14 repositories, 8 inbox components, 6 app pages, 3 migration files, 11 property-based test
suites).

Run:  python3 .hermes/seed_spec.py
Writes the seed into:  ~/.hermes/kanban/boards/inboxpilot/kanban.db
"""
from __future__ import annotations
import textwrap

# Status values match the existing PageVault board:
#   todo    — not yet ready to claim (waiting on dependency)
#   ready   — ready for a worker to claim
#   running — claimed, in progress
#   blocked — explicit blocker (waiting on external signal)
#   done    — accepted and verified
#   archived— done then intentionally retired
STATUSES = ("todo", "ready", "running", "blocked", "done", "archived")

# Priority: 0 = P0 (critical), 1 = P1 (high), 2 = P2 (medium), 3 = P3 (low)
# Assignees are roles, not people: engineering / qa / devops / pm / design / research
# created_by is also a role

TASKS = [
    # ========================================================================
    # SECTION 1 — PM epics (parent tasks that fan out to children)
    # ========================================================================

    {
        "id": "t_pm_prd",
        "title": "[P0] Product requirements (PRD)",
        "assignee": "pm", "status": "todo", "priority": 0, "created_by": "pm",
        "body": textwrap.dedent("""\
            Author InboxPilot's PRD. This is the document of record for what v1 ships, who it's for, how we'll know it works, and what we explicitly are not building. Without it, every other decision in this board is a guess.

            The PRD is the parent of: Technical Architecture, User Stories, Launch Checklist, Success Metrics, Pricing & Packaging hypothesis, and the Tech-debt Backlog triage. Every other PM-authored card on this board refers back to it.

            ## Scope

            Sections (in this order):
            1. **Problem** — the actual pain for SMB support teams. Cite 3-5 customer signals (interviews, support tickets, churn reasons), not just market sizing.
            2. **Personas** — primary (Tier 1 support agent at a 5-50 person SaaS company) and secondary (support lead / owner). Be specific about their day, their tooling, and what they tolerate.
            3. **Success metrics** — at least one North Star (e.g. AI containment rate >= 60% by week 4 of a new tenant's life) plus 3-4 input metrics (deflection, FRT, CSAT, $/ticket). Tie each to a measurable event in the data model (`messages`, `conversations`, `ai_decisions`).
            4. **MVP scope** — the 7-10 features that ship in v1. Anchor each to a real module/route/function in this repo. Reference the table it owns (e.g. "Knowledge base ingestion: `process-knowledge-document` function + `knowledge_documents` table").
            5. **Out-of-scope** — explicit list. Voice, multi-language beyond English, custom AI model fine-tuning, white-label, multi-brand. Every one of these has someone asking for it — name them so we can say "v2" not "soon".
            6. **Risks** — at minimum: AI hallucination cost (mitigation: escalation engine + low-confidence gate), single-vendor provider lock-in (mitigation: `SmsProviderAdapter` + `EmailProviderAdapter` interface seam), RLS bypass risk (mitigation: tests in `packages/support-core/__tests__/integration/rls-policies.test.ts`).
            7. **Pricing & packaging hypothesis** — even a rough one. 3 tiers, per-seat or per-conversation, free trial length, what's gated where. This drives the launch checklist.

            ## Acceptance criteria
            - [ ] `InboxPilot/docs/PRD.md` exists at the repo root.
            - [ ] All 7 sections present with the contents described above.
            - [ ] MVP scope list is 7-10 items, each anchored to a real file path (e.g. `app/inbox/page.tsx`, `insforge/functions/sms-inbound/index.ts`, `packages/support-core/src/services/ai-agent-service.ts`).
            - [ ] At least one risk is grounded in a specific known limitation in the code (do not invent risks).
            - [ ] README.md links to PRD.md in the Documentation section.

            ## Suggested skills
            `brainstorming` (for the persona/problem interviews), `documentation-and-adrs` (for the format), `market-research` (for the competitive landscape section), `improve-codebase-architecture` (for cross-checking the scope against what's actually buildable).

            ## Why this exists
            The InboxPilot repo is already a working scaffold — 17 tables, 14 function entrypoints, 9 services, RLS in place, property-based tests. The gap is the *why*: who is this for, what does success look like, and what do we say no to. The PRD fills that gap. Without it the team will build features that look right but ship to nobody.
        """),
    },
    {
        "id": "t_pm_metric_tree",
        "title": "[P0] Success metrics — North Star + input metric tree",
        "assignee": "pm", "status": "todo", "priority": 0, "created_by": "pm",
        "body": textwrap.dedent("""\
            Define the North Star metric and the input metric tree that ladders up to it. This is the data-side companion to the PRD: every metric below must be calculable from the schema we already have (`conversations`, `messages`, `ai_decisions`, `audit_logs`, `sms_delivery_events`, `email_delivery_events`).

            ## Scope

            **North Star (pick ONE):** "AI-resolved conversations per active tenant per week" — a conversation is AI-resolved when it was auto-replied AND moved to `status='resolved'` within 24h without an `escalate-conversation` event AND has no `audit_logs` entry of kind `human_intervention` within 72h. This is more honest than "auto-reply count" because it tracks outcomes, not activity.

            **Input metrics (4-6, each tied to a query):**
            1. **AI containment rate** = count(conversations where auto_replied=true and status=resolved without escalate) / count(conversations). Source: `messages.sender_type='ai'` joined to `conversations.status`.
            2. **Escalation precision** = count(escalations that were 'true positive' based on audit_logs review) / count(escalations). Source: `audit_logs` joined to `conversations.status='escalated'`. Needs a labeling event — coordinate with the QA feedback task.
            3. **First response time (FRT)** = median (`messages.created_at` - `conversations.last_message_at`) for the first AI or agent reply per inbound. Source: `messages` ordered by `created_at`.
            4. **Cost per resolved conversation** = sum(`openrouter_cost`) / count(resolved conversations). Source: needs a new `openrouter_cost` column on `ai_decisions` (coordinate with eng — see the metric instrumentation card).
            5. **CSAT proxy** = count(messages where body matches positive|thank you|perfect|got it) / count(resolved). Weak proxy; flag it as such.
            6. **Time to value** = time from `organization.created_at` to first `ai_decisions` row for that org. Source: org + first AI decision.

            ## Acceptance criteria
            - [ ] A markdown table in `InboxPilot/docs/METRICS.md` (new file) listing each metric: name, definition, SQL sketch, source tables, owner, target.
            - [ ] Each SQL sketch must be runnable against the existing `insforge/migrations/001_initial_schema.sql` (do not reference columns that do not exist).
            - [ ] One metric is flagged as needing a schema change (the cost one) with a backreference to the instrumentation card.
            - [ ] At least one "watch metric" called out — something we will *not* optimize for but want to keep an eye on (e.g. raw message volume per org, which can mask poor AI quality if it grows).
            - [ ] PRD.md (`[P0] Product requirements` card) links to METRICS.md in the Success metrics section.

            ## Suggested skills
            `data-science` (for the metric definitions), `brainstorming` (for the North Star debate), `documentation-and-adrs` (for the ADR-style record-of-decision format).

            ## Out of scope
            - Building dashboards. The analytics page (`app/analytics/page.tsx`) is a separate card. This card only defines the metrics.
            - Collecting data we do not already collect. If a metric needs a new column, that goes in a separate instrumentation card.
        """),
    },
    {
        "id": "t_pm_user_stories",
        "title": "[P0] User stories (5-7, with acceptance criteria)",
        "assignee": "pm", "status": "todo", "priority": 0, "created_by": "pm",
        "body": textwrap.dedent("""\
            Write 5-7 user stories for the v1 MVP. Each story follows the standard As-a / I-want-to / So-that shape with explicit acceptance criteria (Given/When/Then) and a wiring back to the codebase.

            This is the parent of: Inbox UI (eng), Knowledge Ingestion (eng), Settings pages (eng), Escalation UX (design + eng), Analytics dashboard (eng). Every child card should reference a story ID.

            ## Scope — story candidates (pick 5-7)

            - **US-1: Inbound SMS auto-triage** — As a support agent, I want incoming SMS messages to land in the inbox with a pre-drafted AI reply and a confidence score, so that I can review-and-send in 2 clicks instead of typing from scratch.
            - **US-2: Escalation handoff** — As a support lead, I want any conversation that triggers an escalation rule to immediately show up in an "Escalated" lane with the rule that fired, so that I can audit and override AI decisions.
            - **US-3: Knowledge base ingestion** — As an owner, I want to upload a PDF/markdown doc and have the AI start referencing it in replies within minutes, so that answers stay in sync with our actual policies.
            - **US-4: Channel test connection** — As an owner, I want a "send a test message" button in settings that confirms my Twilio/Postmark credentials work, so that I do not find out about a misconfiguration from a customer.
            - **US-5: Auto-reply threshold tuning** — As an owner, I want a slider for "AI confidence threshold" per org, so that I can trade off containment for risk based on my team's comfort.
            - **US-6: Audit log export** — As a compliance lead, I want to export the audit log for our org as CSV for a date range, so that I can satisfy SOC2 evidence requests.
            - **US-7: Multi-tenant isolation** (more of a constraint story) — As the platform owner, I want to be confident that no org can ever see another org's conversations, messages, contacts, or knowledge docs.

            ## Acceptance criteria (for THIS card)
            - [ ] `InboxPilot/docs/USER_STORIES.md` exists with 5-7 stories.
            - [ ] Each story has: ID, As-a/I-want-to/So-that, Given/When/Then acceptance criteria, a "Files touched" list referencing real paths in this repo, and a "Depends on" list pointing at other cards on this board.
            - [ ] US-7 (multi-tenant isolation) has explicit criteria that reference `insforge/migrations/003_rls_policies.sql` and the test file `packages/support-core/__tests__/integration/rls-policies.test.ts`.
            - [ ] No story references a feature that does not exist in the codebase or in the PRD MVP scope (if you find one, surface it and either add to PRD or remove from stories).
            - [ ] Each story has an "Out of scope" line that names 1-2 things deliberately not in v1 for that story.

            ## Suggested skills
            `brainstorming`, `grill-me` (use it on your own draft before submitting — the persona should be defensible), `documentation-and-adrs`.

            ## Out of scope
            - Implementation. The story is a contract, not a sprint plan. Engineering will size and break it down.
        """),
    },
    {
        "id": "t_pm_launch_checklist",
        "title": "[P0] Launch checklist (gating document for v1 ship)",
        "assignee": "pm", "status": "todo", "priority": 1, "created_by": "pm",
        "body": textwrap.dedent("""\
            Produce the go/no-go checklist for the v1 launch. This is the document that says "we ship when all of these are true" — it is the single source of truth for the launch decision, not Slack memory and not the standup.

            ## Scope

            Sections (in order, every section has at least one criterion with a verifiable evidence path):

            1. **Functional readiness** — every P0 user story (`[P0] User stories` card) is implemented and demoed end-to-end against a real InsForge instance. Evidence: demo recording + at least 3 test tenants seeded with realistic data.
            2. **Multi-tenant safety** — `rls-policies.test.ts` passes on a fresh database; a manual cross-tenant probe shows org A cannot read org B's `conversations`/`messages`/`contacts`/`knowledge_documents`. Evidence: SQL session output screenshot.
            3. **AI safety** — escalation engine fires on the 8 rules in `packages/support-core/src/services/escalation-rules.ts` for the documented trigger patterns; an incident-response runbook exists for "AI sent a wrong reply". Evidence: runbook at `docs/INCIDENT_RESPONSE.md`.
            4. **Observability** — every function entrypoint logs structured JSON; `audit_logs` is append-only and queryable per org; the cost-per-conversation metric is computable. Evidence: a sample log line + the metric query from METRICS.md.
            5. **Documentation** — README quickstart works on a fresh clone; PRD, USER_STORIES, METRICS, and an updated ARCHITECTURE all exist and cross-link. Evidence: `docs/README_INDEX.md` table of contents.
            6. **Compliance** — credentials are stored in the `credentials_secret_id` column (not in code), the dev `.env.example` has no real keys, and a one-page security model exists. Evidence: `docs/SECURITY_MODEL.md`.
            7. **Go-to-market** — pricing page is live, a beta signup form exists, the first 5 design-partner tenants are named with a target onboarding date. Evidence: live URLs.
            8. **Rollback plan** — every function is independently redeployable; the schema migrations are reversible (down migrations or `DROP TABLE IF EXISTS ... CASCADE` documented); a one-command rollback script exists. Evidence: `scripts/rollback.sh` runs cleanly against a staging DB.

            ## Acceptance criteria
            - [ ] `InboxPilot/docs/LAUNCH_CHECKLIST.md` exists.
            - [ ] Each section has at least one criterion with a checkable, verifiable state (not "feels good").
            - [ ] Every section is owned (name + role) — no section is "TBD".
            - [ ] At least 2 cross-references to other docs/PM cards (PRD, METRICS, USER_STORIES, SEC-1 incident-response, etc.).
            - [ ] The doc is the parent of: QA bug-hunt, security review, perf budget, beta program design, and rollback-plan cards.

            ## Suggested skills
            `brainstorming`, `documentation-and-adrs`, `grill-me` (use it on yourself before finalizing — every "blocker" should be a real blocker, not a fear).
        """),
    },
    {
        "id": "t_pm_pricing_packaging",
        "title": "[P1] Pricing & packaging hypothesis (3 tiers, with rationale)",
        "assignee": "pm", "status": "todo", "priority": 1, "created_by": "pm",
        "body": textwrap.dedent("""\
            Produce a 3-tier pricing & packaging hypothesis for InboxPilot. This is *not* a final answer — it's a structured bet that engineering can build gating logic against and sales can take to design partners.

            The key constraint: every tier boundary must map to a check we can do in code (a flag in `ai_settings` or `organization_members.metadata`), not a vague "more value" promise. If the boundary is not enforceable, it's marketing fluff.

            ## Scope

            **Tiers (suggested — push back if you have data):**
            - **Starter** — $0 / 50 conversations / mo. Single channel (SMS OR email), 1 seat, knowledge base up to 5 docs, AI auto-reply off (draft-only mode). Hook.
            - **Growth** — $99 / 1,000 conversations / mo, then $0.10/conversation. Both channels, 5 seats, 50 docs, AI auto-reply on above a per-tenant confidence threshold. Primary commercial tier.
            - **Scale** — $499 / 10,000 conversations / mo, then $0.05/conversation. Both channels, unlimited seats, unlimited docs, custom escalation keywords, audit log export. Design-partner tier.

            **Gating mechanism:** a new `organization_subscriptions` table (1 row per org) with `tier` (`starter`/`growth`/`scale`), `conversation_quota`, `quota_period_start`. Enforce in `InboundMessageService` (return 402-style error when quota hit; do not silently drop). The build is a separate card; this card only designs the schema + UX.

            **Pricing signals to surface for the pricing page:**
            - "How many inbound conversations per month?" (calibrated to tier breakpoints)
            - "How many seats?" (cap at tier level)
            - "AI auto-reply on or off?" (Growth+)
            - "Need audit log export?" (Scale only)

            ## Acceptance criteria
            - [ ] `InboxPilot/docs/PRICING.md` exists with 3 tiers, a rationale paragraph for each, and a "what this tier is NOT" line.
            - [ ] A draft SQL sketch for `organization_subscriptions` (or a one-pager that says "extend `ai_settings` with these columns instead" if you think the existing table is fine).
            - [ ] At least 3 design-partner profiles sketched (company size, current support volume, current spend on alternatives like Front/Intercom/Ada).
            - [ ] At least 2 open questions marked "must answer with data" — e.g. is the auto-reply threshold enough of a hook, or do we need webhook/CRM integrations in Starter?
            - [ ] Linked from PRD.md and LAUNCH_CHECKLIST.md.

            ## Suggested skills
            `market-research`, `brainstorming`, `grill-me`.

            ## Out of scope
            - Final prices. This is a hypothesis. Real prices get set after the first 5 design-partner conversations.
            - Stripe wiring. There is a separate card for billing.
        """),
    },
    {
        "id": "t_pm_competitive",
        "title": "[P1] Competitive landscape (Front, Intercom Fin, Ada, Forethought, custom stacks)",
        "assignee": "pm", "status": "todo", "priority": 1, "created_by": "pm",
        "body": textwrap.dedent("""\
            Produce a competitive landscape doc that lets us answer "why InboxPilot, not X?" with specifics, not vibes. Output is a 2-axis positioning map and a 1-page per competitor.

            The reason this matters for *this* board: every eng/qa/design card implicitly makes a positioning call. The escalation engine is "safer than Fin" or "more transparent than Fin" — but only if we can name the Fin behavior we are differentiating from. Without the doc, marketing claims drift from reality.

            ## Scope

            **Competitors to cover (minimum):**
            - **Front** — shared inbox, AI features added in 2024. Strong on email, weaker on SMS. Our wedge: native SMS-first, multi-channel by default.
            - **Intercom Fin** — AI agent on top of Intercom platform. Strong brand, expensive ($0.99/resolution). Our wedge: per-tenant knowledge base ingestion in minutes, not days; transparent escalation rules.
            - **Ada** — enterprise AI agent. Strong on routing, weak on multi-channel. Our wedge: SMB price point and onboarding speed.
            - **Forethought** — predictive support / Triage. Strong on intent classification. Our wedge: full agent (Triage is read-only, we act).
            - **Custom stack** — Retool + OpenAI + Twilio + Zapier. Our wedge: time-to-value (custom stack = 2-4 weeks, InboxPilot = same day).

            **Required artifacts:**
            1. **Positioning map** — 2-axis. Suggested axes: (a) "AI autonomy" (draft-only to full auto-reply) vs (b) "Channel breadth" (email-only to email+SMS+voice+chat). Plot all 5 competitors and InboxPilot. Make the empty quadrant visible.
            2. **1-pager per competitor** — 5 sections: pricing model, AI features, channel coverage, on-prem/SOC2 story, our 1-line wedge. Cite sources.
            3. **"We will NOT compete on"** section — explicit. E.g. "We will not compete on voice in v1." "We will not compete on enterprise SSO/SAML in v1." This is the anti-PRD.

            ## Acceptance criteria
            - [ ] `InboxPilot/docs/COMPETITIVE.md` exists.
            - [ ] Positioning map is a real graphic (ASCII or link to image), not a description.
            - [ ] Each competitor has a 1-pager with at least one cited source (their pricing page, a review, a press release).
            - [ ] "We will NOT compete on" section has at least 3 items, each with a v2 milestone.
            - [ ] Linked from PRD.md and the pricing hypothesis card.

            ## Suggested skills
            `market-research`, `brainstorming` (for the positioning-map debates), `documentation-and-adrs`.
        """),
    },
    {
        "id": "t_pm_beta_program",
        "title": "[P1] Beta program design (5 design-partner tenants, 8-week runway)",
        "assignee": "pm", "status": "todo", "priority": 1, "created_by": "pm",
        "body": textwrap.dedent("""\
            Design the beta program — 5 design-partner tenants, 8 weeks, structured to learn 3 things: (1) does the AI actually contain conversations in production, (2) do escalation rules feel right to the support lead, (3) what would make the customer churn at week 4.

            ## Scope

            **Recruiting (weeks 1-2):**
            - 5 tenants, sized 3-50 support-agents, each handling 200-2,000 conversations/mo.
            - Mix: 2 SMS-heavy, 2 email-heavy, 1 both. Mix on intent: 1 e-commerce, 2 SaaS, 1 professional services, 1 marketplace.
            - Compensation: 50% off for 6 months + dedicated Slack channel + their name on the launch page. Document the terms in `docs/BETA_TERMS.md` before signing anyone.
            - Each tenant signs: data processing agreement (DPA), acceptable use policy (AUP), and a 30-day exit clause for either side.

            **Runway (weeks 3-10):**
            - Week 3: onboarding + first AI-decision review (read-only, no auto-reply).
            - Week 4: flip to draft-only mode, daily 15-min review with each lead.
            - Week 6: flip to auto-reply on, monitor escalation precision (from METRICS.md).
            - Week 8: structured interview — what would make you cancel, what surprised you, what would you pay double for.
            - Week 10: GA decision based on a written report.

            **Learn goals (3 — track them, do not let them get fuzzy):**
            1. **Containment in production** — is the rate from staging (e.g. 62%) realistic? What breaks it?
            2. **Escalation rule quality** — precision >= 70%? Which rule has the most false positives?
            3. **Churn signal at week 4** — what do the at-risk tenants have in common? (Help docs, SMS volume, team size, persona?)

            ## Acceptance criteria
            - [ ] `InboxPilot/docs/BETA_PROGRAM.md` exists.
            - [ ] Recruiting criteria spelled out (size, vertical, channel mix).
            - [ ] 8-week schedule with weekly milestone.
            - [ ] 3 explicit learn goals, each with a measurement source (which table / which event).
            - [ ] BETA_TERMS.md with the legal-template pointers (DPA, AUP, exit clause).
            - [ ] Linked from LAUNCH_CHECKLIST.md section 7.

            ## Out of scope
            - Building onboarding UI. The onboarding flow is a separate design + eng card.
            - Marketing site. That is the pricing/marketing page card.
        """),
    },
    {
        "id": "t_pm_tech_debt_backlog",
        "title": "[P1] Tech-debt backlog triage (LOW/INFO findings from QA, not spawned as cards)",
        "assignee": "pm", "status": "todo", "priority": 2, "created_by": "pm",
        "body": textwrap.dedent("""\
            The QA bug-hunt card will surface CRITICAL/HIGH/MEDIUM findings as individual cards (because each blocks launch). LOW and INFO findings should *not* be spawned as individual cards — they become a triage backlog doc that engineering can pick from between releases.

            Your job: build the doc, set the picking order, and review it with eng quarterly.

            ## Scope

            The doc lives at `InboxPilot/docs/TECH_DEBT.md`. Initial population comes from the QA bug-hunt output (the QA card formats it for you).

            **Picking-order heuristic:**
            - **Theme 1: correctness** — anything that could silently drop a message, mis-route an escalation, or break an audit log. Top priority.
            - **Theme 2: tenant isolation** — anything that smells like a missing RLS check. Even an INFO finding here is a P0 until reviewed.
            - **Theme 3: provider fragility** — anything that locks to one SMS/email provider without going through the adapter.
            - **Theme 4: cost/perf** — only after themes 1-3 are clean.
            - **Theme 5: DX/cleanliness** — last. Style nits.

            **Format per entry:**
            - ID (e.g. LOW-1, INFO-3) — refs the QA bug-hunt finding
            - File:line
            - Issue (1-2 sentences)
            - Theme (1-5 above)
            - Suggested pick-up (1-2 lines; "fix in this PR" or "wait for v2 refactor")
            - Estimated effort (S/M/L)
            - Risk of leaving it (low/med/high)

            ## Acceptance criteria
            - [ ] `InboxPilot/docs/TECH_DEBT.md` exists with the format above.
            - [ ] Picking-order heuristic documented and applied to at least 3 example entries.
            - [ ] A "promote criteria" section — when does a LOW entry become a card? (Suggested: when it becomes a Theme 1/2 issue, or when the same LOW surfaces 3+ times.)
            - [ ] Review cadence: quarterly with engineering. Schedule a recurring review with eng lead.

            ## Out of scope
            - Acting on the entries. That is engineering's job, picking from the backlog.
        """),
    },

    # ========================================================================
    # SECTION 2 — Engineering work (next-up)
    # ========================================================================
    {
        "id": "t_eng_auth",
        "title": "[P0] Authentication & multi-tenant session",
        "assignee": "engineering", "status": "todo", "priority": 0, "created_by": "user",
        "body": textwrap.dedent("""\
            Wire sign-up / sign-in / sign-out / session refresh using the InsForge built-in auth, and the Next.js middleware that protects every non-public route. Every user-owned table in this app is scoped to an `organization_id`, so auth is the foundation that lets RLS policies do their job.

            ## Tasks
            - `middleware.ts` already exists (274 bytes) — extend it to read the InsForge JWT from the cookie/session, redirect unauthenticated requests to `/login`.
            - `app/login/page.tsx` and `app/register/page.tsx` already exist as directories — flesh them out to use `insforge.auth.signInWithPassword()` and `insforge.auth.signUp()`.
            - Add a `useAuth()` hook in `lib/auth-context.tsx` (exists, may need extension) and a server-side `getServerUser()` helper in `lib/auth-server.ts` (new) for RSC and API routes.
            - Session refresh — server-side via the InsForge auth SDK, no client polling.
            - Add `auth.users.id` (i.e. the `user_id` column on `organization_members`) is already FK-equivalent. Verify the FK is enforced end-to-end.
            - Add vitest coverage at `__tests__/middleware.test.ts` (directory exists).

            ## Skills
            `insforge`, `insforge-runtime-patterns`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - All four flows (sign-up, sign-in, sign-out, refresh) work against the dev InsForge instance.
            - Middleware blocks unauthenticated access to `/inbox`, `/knowledge`, `/analytics`, `/settings/*`.
            - A new sign-up creates a `organizations` row, an `organization_members` row with `role='owner'`, and an `ai_settings` row (or a default-empty one).
            - `__tests__/middleware.test.ts` covers at least: unauth to redirect, authenticated to allowed, expired token to redirect.
            - README "Quickstart" still passes end-to-end after these changes.
        """),
    },
    {
        "id": "t_eng_inbox_ui",
        "title": "[P1] Inbox UI end-to-end (list + thread + reply composer + AI draft panel)",
        "assignee": "engineering", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The 8 inbox components already exist (`components/inbox/`): `AiDraftPanel`, `ContactDetails`, `ConversationItem`, `ConversationList`, `MessageBubble`, `MessageThread`, `ReplyComposer`, `StatusBadge`. Wire them into `app/inbox/page.tsx` (directory exists, page.tsx may be missing) end-to-end so a logged-in user can read, draft, and send.

            ## Tasks
            - Verify all 8 components render with real data from `conversations` and `messages` tables (currently the inbox is a stub).
            - The realtime hook `lib/use-realtime.ts` is polling-based per the README — wire it to refetch `conversations` and `messages` every N seconds.
            - `ReplyComposer` should call `send-reply` function with the JWT.
            - `AiDraftPanel` should call `regenerate-ai-draft` and `approve-ai-draft`.
            - The status badge should map the `conversations.status` enum to the badge variant correctly.
            - Empty states: no conversations, no messages in a thread, no contacts.

            ## Skills
            `next-best-practices`, `tailwind-design-system`, `frontend-design`, `subagent-driven-development`, `insforge`.

            ## Acceptance criteria
            - A signed-in user can: see the conversation list, click into a thread, see the AI draft in the panel, edit it, send, see the message appear with `sender_type='user'`, watch the realtime hook update the list.
            - All 8 components have at least one example-based test in `__tests__/components/` (new dir, use vitest's React testing).
            - No lint or typecheck regressions. `npm run lint` and `npm run build` both green.
        """),
    },
    {
        "id": "t_eng_knowledge_ingestion",
        "title": "[P1] Knowledge base ingestion UI + wiring",
        "assignee": "engineering", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The `process-knowledge-document` function entrypoint exists and `knowledge-ingestion-service.ts` (3.8 KB) handles chunking + embedding. The user-facing UI in `app/knowledge/page.tsx` (directory exists) is the missing piece.

            ## Tasks
            - Build the upload form: drag-and-drop + click-to-upload, accepts `.pdf`, `.md`, `.txt`, `.docx`.
            - POST to a new Next.js route `app/api/knowledge/upload/route.ts` that stores the file in InsForge Storage, creates a `knowledge_documents` row, and enqueues a `process_knowledge_document` job.
            - Show per-document status (`pending`, `processing`, `ready`, `failed`) with a manual retry button.
            - Document delete: confirm modal, soft-delete (set `metadata.deleted=true`), do not actually `DELETE` (audit-trail reasons).
            - Display chunk count + total token estimate per document.
            - Vitest coverage for the upload route's input validation.

            ## Skills
            `insforge`, `insforge-runtime-patterns`, `subagent-driven-development`, `test-driven-development`, `next-best-practices`, `tailwind-design-system`.

            ## Acceptance criteria
            - End-to-end: upload a 10-page PDF, watch status go `pending` to `processing` to `ready` within 60 seconds, see chunk count populate, send a test inbound SMS that should match the doc, verify `match_knowledge_chunks` returns relevant chunks.
            - Failed ingestion (e.g. corrupt PDF) shows a clear error, allows retry, logs the failure to `audit_logs`.
            - Storage URLs are persisted on the `knowledge_documents` row per the AGENTS.md note (both `url` and `key`).
        """),
    },
    {
        "id": "t_eng_settings_ai",
        "title": "[P1] AI settings page (mode, threshold, model, escalation keyword list)",
        "assignee": "engineering", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            `app/settings/` exists with subdirectories but the AI settings UI is empty. The data model (`ai_settings` table) and the per-org loading in `ai-agent-service.ts` are already there. Build the page that lets an owner edit the relevant fields and have the AI behavior change immediately (no app restart).

            ## Tasks
            - Form for: `mode` (off / draft_only / auto_reply), `auto_reply_threshold` (0.0-1.0 slider), `model` (text input, default `openai/gpt-4o-mini` per `.env.example`), `escalation_keywords` (tag input).
            - On save: update `ai_settings` row, write to `audit_logs` (kind: `ai_settings_changed` with before/after diff).
            - "Test connection" button -> calls the `test-channel-connection` function (exists) and shows the result inline.
            - All form fields are RBAC-gated — only `role IN ('owner','admin')` can save; agents and viewers see read-only.

            ## Skills
            `insforge`, `next-best-practices`, `tailwind-design-system`, `frontend-design`, `test-driven-development`, `subagent-driven-development`.

            ## Acceptance criteria
            - Saving the form re-fetches `ai_settings` and the next inbound message respects the new threshold (verify by sending a real test SMS or by reading the `conversations.ai_state` column after triggering).
            - Audit log entry written with the correct before/after diff.
            - An agent user (not owner) sees the form but the save button is disabled, with a tooltip explaining why.
            - All form fields validated with zod (already a dep).
        """),
    },
    {
        "id": "t_eng_settings_channels",
        "title": "[P1] Channel settings (SMS provider + email provider + test-connection UX)",
        "assignee": "engineering", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The `test-channel-connection` function entrypoint exists. The provider-account tables (`sms_provider_accounts`, `email_provider_accounts`, `sms_phone_numbers`) and repositories exist. The UI in `app/settings/` to add a Twilio / Telnyx / Postmark account is missing.

            ## Tasks
            - SMS settings page: add a provider account (Twilio or Telnyx), paste `account_sid` + `auth_token` (write to `credentials_secret_id` via the InsForge secrets endpoint — never store raw creds in the DB row), list connected phone numbers with a "make default" toggle, test-connection button.
            - Email settings page: add a Postmark account, paste `server_token` (same secrets-endpoint pattern), test-connection button that sends a real email to the admin.
            - Webhook URL display: each provider account has a `webhook_url` field that the admin copies into their Twilio/Postmark dashboard. Show it with a copy button.
            - The existing `test-channel-connection` function is JWT-gated — wire the button to call it via the SDK.

            ## Skills
            `insforge`, `insforge-runtime-patterns`, `next-best-practices`, `tailwind-design-system`, `test-driven-development`, `subagent-driven-development`.

            ## Acceptance criteria
            - Adding a Twilio sandbox account and clicking test-connection sends a real SMS to a test phone (use a known sandbox number) and shows the delivery status.
            - Adding a Postmark account and clicking test-connection sends an email to the admin's verified sender.
            - Credentials are stored in the secrets endpoint, not in the `*_provider_accounts` row (verify with `psql` or the InsForge dashboard).
            - `audit_logs` entry written for add/remove/rotate.
        """),
    },
    {
        "id": "t_eng_analytics_dashboard",
        "title": "[P1] Analytics dashboard (the metrics from METRICS.md, plus trendlines)",
        "assignee": "engineering", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The `app/analytics/` directory exists but the page is empty. Build the dashboard that surfaces the metrics from `[P0] Success metrics` card. Every chart must be backed by a query against real tables.

            ## Tasks
            - KPI tiles: AI containment rate (24h, 7d, 30d), FRT median, escalation precision (last 7d), cost per resolved conversation (last 30d).
            - Trendlines: daily conversation volume, daily AI-resolved count, daily escalation count. Last 30 days.
            - Drilldowns: top 10 escalation keywords, top 10 contacts by conversation count, channel split (sms vs email).
            - Export: "Download CSV" button on each tile's underlying data.
            - All queries are server-side via the InsForge PostgREST API; client never holds the service-role key.

            ## Skills
            `insforge`, `next-best-practices`, `tailwind-design-system`, `frontend-design`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - All KPI tiles load in < 1s on a 10k-conversation tenant (verify with a seeded tenant in `insforge/seed.sql`).
            - Each tile's underlying query is documented inline with a comment linking to the METRICS.md definition.
            - CSV export works for the date-range selector (default last 30 days).
            - No client-side call to `INSFORGE_SERVICE_ROLE_KEY`. Lint rule added to block `process.env.INSFORGE_SERVICE_ROLE_KEY` references in `app/`.
        """),
    },
    {
        "id": "t_eng_instrumentation",
        "title": "[P1] Metric instrumentation — schema additions for the metrics card",
        "assignee": "engineering", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The `[P0] Success metrics` card defines "cost per resolved conversation" but the `ai_decisions` table has no cost column. Add the schema + populate it.

            ## Tasks
            - Migration `insforge/migrations/004_metric_instrumentation.sql` (new file):
              - ALTER TABLE ai_decisions ADD COLUMN openrouter_cost_usd numeric(10,6);
              - ALTER TABLE ai_decisions ADD COLUMN openrouter_prompt_tokens integer;
              - ALTER TABLE ai_decisions ADD COLUMN openrouter_completion_tokens integer;
              - ALTER TABLE ai_decisions ADD COLUMN model text;
            - Update `ai-decision-repository.ts` (3.1 KB, exists) to write the new fields when an `ai-agent-service.ts` call returns.
            - Update `ai-agent-service.ts` (19.5 KB, exists) to read `usage` from the OpenRouter response and populate the fields.
            - Add a vitest property test in `__tests__/properties/ai-decision.prop.test.ts` (exists) covering: a successful OpenRouter call populates all 4 fields; a failure (4xx/5xx) does not write a row.

            ## Skills
            `insforge-cli`, `insforge`, `test-driven-development`, `subagent-driven-development`, `insforge-debug`.

            ## Acceptance criteria
            - Migration is reversible (`004_metric_instrumentation.down.sql` exists with the inverse).
            - After 100 synthetic AI jobs, the average `openrouter_cost_usd` per `ai_decisions` row is non-null for >= 95% of rows (failures are tracked separately).
            - The METRICS.md SQL sketch for "cost per resolved conversation" runs end-to-end and returns a number.
            - The RLS policy on `ai_decisions` is unchanged (still org-scoped); no tenant can see another's cost.
        """),
    },
    {
        "id": "t_eng_outbound_retry",
        "title": "[P2] Outbound reply — retry on transient provider errors",
        "assignee": "engineering", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            `outbound-message-service.ts` (6.4 KB) currently sends once and surfaces the provider error. For Twilio 5xx and Postmark transient errors, this is too brittle — one bad retry and the customer sees a "message failed" notification that we then immediately resolve.

            ## Tasks
            - Identify transient vs permanent errors per provider (Twilio 5xx, 429, network timeout; Postmark 4xx-with-Retry-After header are transient, 5xx transient, 4xx permanent).
            - Add a `withRetry(fn, { maxAttempts, backoffMs })` helper in `packages/support-core/src/utils/retry.ts` (new).
            - In `outbound-message-service.ts`, wrap the adapter call in `withRetry` and on success update `messages.delivery_status` to `sent`; on permanent failure `failed`; on exhausted retries `failed` and enqueue a `notify_human` job (new `notify_human` job type).
            - Property test in `__tests__/properties/retry.prop.test.ts` (new): simulated failures back off exponentially, never exceed maxAttempts, succeed on the first transient-then-recover.

            ## Skills
            `test-driven-development`, `subagent-driven-development`, `systematic-debugging`, `insforge`.

            ## Acceptance criteria
            - A simulated Twilio 503 followed by 200 on attempt 2 succeeds without surfacing a "failed" state to the user.
            - A simulated Twilio 401 (permanent) fails fast and surfaces the error in the UI within 2s.
            - Retry count is recorded on `messages.metadata.retry_count` (or a new column — pick one and document).
            - The property test runs 100+ iterations with no flaky failures.
        """),
    },
    {
        "id": "t_eng_job_queue_observability",
        "title": "[P2] Job queue — observability + dead-letter dashboard",
        "assignee": "engineering", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            `postgres-job-queue.ts` (7.5 KB) implements the queue with exponential backoff and dead-lettering per the README. There is no UI or admin endpoint to see what is stuck, what is dead-lettered, or how long the p95 wait is.

            ## Tasks
            - Add a `GET /functions/v1/admin/job-queue-stats` function entrypoint (new) that returns: pending count, running count, dead-lettered count, p50/p95 wait time, top 5 failing job types. JWT-gated to `role='admin'`.
            - Add a section in `app/analytics/` (or a new `/admin` page) that surfaces these stats.
            - Add a "retry" button per dead-lettered job that resets its status to `pending` and writes to `audit_logs`.
            - Add a `last_heartbeat_at` to jobs (already in `task_runs` schema — port the concept to the support-core `support_jobs` table if not there).

            ## Skills
            `insforge`, `insforge-debug`, `next-best-practices`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - A failed `process_ai_message` job (simulated by setting `payload` to invalid JSON) shows up in the dead-lettered list within 1 minute of its max-retry exhaustion.
            - Clicking "retry" resets the job and the next `process-jobs` cron tick processes it.
            - p95 wait time is shown as a sparkline for the last 24h.
            - The admin endpoint is RBAC-gated; an agent user gets 403.
        """),
    },
    {
        "id": "t_eng_test_connection_ux",
        "title": "[P2] Test-channel-connection UX hardening",
        "assignee": "engineering", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            `test-channel-connection` function exists. The UI button calls it but the error states are thin — the admin sees a generic "Failed" with no actionable next step.

            ## Tasks
            - Differentiate error states: invalid credentials, rate-limited, webhook not configured (provider is rejecting our outbound IP), account suspended.
            - Each error state shows a copy-pasteable diagnostic block (curl command with the same headers, sample response, link to the provider's status page).
            - Success state shows the actual provider message SID / Postmark message ID for verification.
            - Log every test-connection call to `audit_logs` with the result and a redacted credential reference.

            ## Skills
            `frontend-design`, `tailwind-design-system`, `subagent-driven-development`, `test-driven-development`, `insforge`.

            ## Acceptance criteria
            - Each of the 4 error states has a dedicated UI treatment.
            - A real Twilio 401 surfaces "invalid credentials" with a "rotate now" link to the settings page.
            - All test-connection attempts are queryable in `audit_logs` per org.
        """),
    },

    # ========================================================================
    # SECTION 3 — QA + Security + Compliance
    # ========================================================================
    {
        "id": "t_qa_bug_hunt",
        "title": "[P0] Deep bug-hunt review of InboxPilot",
        "assignee": "qa", "status": "todo", "priority": 0, "created_by": "user",
        "body": textwrap.dedent("""\
            Deep QA bug-hunt on InboxPilot pre-v1. Produce a structured bug report, not code fixes. This card is the parent of every CRITICAL/HIGH/MEDIUM finding card that follows.

            ## Scope
            - /home/azureuser/workspace/InboxPilot
            - 17 DB tables, 14 function entrypoints, 9 services, 14 repositories, 8 inbox components, 6 pages, 11 property-based test suites.

            ## Process
            1. **Run the static checks first** and record every error verbatim:
               - `cd /home/azureuser/workspace/InboxPilot && npm run lint`
               - `npm run build` (Next.js typecheck + bundle)
               - `npm test` (vitest unit + property-based)
            2. **Read every file** in `packages/support-core/src/services/` and `insforge/functions/_shared/`. For each, look for:
               - Unhandled errors / no try-catch around I/O (InsForge, fetch, retry)
               - Auth checks missing on functions (every function should JWT-verify OR be a known-webhook OR be a known-internal)
               - RLS bypass risks in any function that takes a user-supplied `organization_id`
               - User input passed to `dangerouslySetInnerHTML`, `eval`, or shell
               - Race conditions in the job queue (concurrent claim_support_jobs, missing lock)
               - Memory leaks (unbounded arrays, no cleanup, event listeners in React)
               - Missing input validation (zod schemas missing on POST bodies)
               - Type assertions hiding bugs (`as any`, `as unknown as`)
            3. **Read all 14 function entrypoints** for:
               - Webhook signature verification correctness
               - Provider header parsing edge cases
               - SQL injection in raw RPC calls (e.g. `rpc('match_knowledge_chunks', ...)`)
               - Quota / limit enforcement (does an org with 0 quota still get a reply?)
            4. **Read the 3 migration files** for:
               - Missing indexes on hot paths (conversations, messages)
               - RLS policy gaps (`WITH CHECK` vs `USING` symmetry)
               - `gen_random_uuid()` exposure (it isn't by default in pg, only with pgcrypto)
            5. **Read the 8 inbox components** for:
               - Race conditions in optimistic UI updates
               - Unbounded lists (no virtualization on a 10k-conversation inbox)
               - Missing keyboard accessibility (a support agent lives in the inbox, keyboard nav matters)
            6. **Read the 6 app pages** for:
               - Unprotected routes (any page that does not gate on `useAuth()`)
               - Server component vs client component boundary mistakes (server-only secrets leaking to client)

            ## Severity rubric
            - **CRITICAL** — production data loss, security breach, RLS bypass, hard crash. Block launch.
            - **HIGH** — major feature broken, escalation engine misfire, data inconsistency. Block launch.
            - **MEDIUM** — degraded UX, edge case data loss, performance cliff under load. Fix before beta ends.
            - **LOW** — DX, cleanup, tech debt. Triage into tech-debt backlog (separate card).
            - **INFO** — observation, possible future concern. Tech-debt backlog only.

            ## Acceptance criteria
            - `InboxPilot/docs/QA_BUG_HUNT.md` exists.
            - Every finding has: ID (CRITICAL-1, HIGH-1, ...), file:line, issue, repro, suggested fix (1-3 lines), theme, severity, effort estimate.
            - CRITICAL and HIGH findings are spawned as individual cards on this board (one card per finding, parent = this card).
            - MEDIUM findings are listed in the doc with a "promote to card if not fixed in 2 weeks" note.
            - LOW/INFO findings feed the tech-debt backlog card.

            ## Skills
            `codebase-audit`, `codebase-inspection`, `requesting-code-review`, `subagent-driven-development`.
        """),
    },
    {
        "id": "t_qa_rls_audit",
        "title": "[P0] RLS audit — multi-tenant isolation proof",
        "assignee": "qa", "status": "ready", "priority": 0, "created_by": "user",
        "body": textwrap.dedent("""\
            Independently verify that no org can read or write another org's data. This is the single most important safety property of the platform — without it, the SaaS is a compliance failure.

            ## Tasks
            - Read `insforge/migrations/003_rls_policies.sql` (16.9 KB) line by line. For each `CREATE POLICY`, verify it is org-scoped and that the `USING` and `WITH CHECK` clauses match (asymmetric policies are a common bug).
            - For each of the 17 tables, write a SQL probe that:
              1. As org A's user, attempts to SELECT a row from org B. Expect 0 rows.
              2. As org A's user, attempts to INSERT a row with `organization_id = orgB`. Expect error or silent no-op.
              3. As org A's user, attempts to UPDATE/DELETE a row from org B. Expect 0 rows affected.
            - Test the special case: the `audit_logs` table should be INSERT-only and org-scoped (no UPDATE, no DELETE) per the ARCHITECTURE design principle.
            - Run all probes against a seeded test DB with 3 orgs and document results.

            ## Skills
            `insforge-debug`, `insforge`, `codebase-audit`, `test-driven-development`, `subagent-driven-development`.

            ## Acceptance criteria
            - All 17 tables pass all 3 probes.
            - `audit_logs` probes confirm INSERT-only and org-scoped.
            - A "RLS Probe Results" table in `docs/RLS_AUDIT.md` with one row per table x probe, color-coded pass/fail.
            - Any failure is spawned as a CRITICAL card on this board with `parent=t_qa_rls_audit`.
        """),
    },
    {
        "id": "t_qa_escalation_proptest",
        "title": "[P1] Escalation engine — adversarial test corpus",
        "assignee": "qa", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The escalation engine (`packages/support-core/src/services/escalation-rules.ts`, 9.1 KB) runs 8 rules pre-LLM. Property tests in `__tests__/properties/escalation.prop.test.ts` exist. Build an *adversarial* corpus — the test cases the current property tests do not cover.

            ## Tasks
            - For each of the 8 rules in `escalation-rules.ts`, hand-craft 5-10 test cases that target the rule's *boundary* (the cases that almost-but-do-not-quite match). Examples:
              - HumanRequestRule: "I'd like a human" vs "the human body" vs "humane treatment"
              - ProfanityAngerRule: emoji-laden profanity, leet-speak ("f*ck", "f4ck"), unicode lookalikes
              - SensitiveTopicRule: a request that is *medical* but framed as "I have a question about my mom's prescription" — should the rule fire? Document the intent.
              - SafetyConcernRule: "this is unsafe" (literal) vs "is this safe?" (question)
              - MissingKnowledgeRule: a question that the knowledge base almost-but-does-not-quite answer
              - LowConfidenceRule: post-LLM only — but the pre-LLM no-op is correct, so this rule is hard to trigger pre-LLM; write a unit test that confirms the no-op
              - RepeatedFailureRule: 2nd failure vs 3rd vs 4th
              - KeywordRule: org-configured keywords — test the empty-keyword case, the regex-injection case, the case-insensitive case
            - Add each test case to `__tests__/unit/escalation-engine.test.ts` with a comment explaining what it is trying to catch.
            - For any case where the current behavior is wrong, file a finding and spawn a fix card.

            ## Skills
            `test-driven-development`, `subagent-driven-development`, `systematic-debugging`, `codebase-audit`.

            ## Acceptance criteria
            - 40+ adversarial cases added (5+ per rule).
            - All cases have a comment explaining the attack vector.
            - Any case that exposes a bug is spawned as a separate card (parent = `[P0] Deep bug-hunt review` or this card).
            - `npm test` still green.
        """),
    },
    {
        "id": "t_qa_integration_flows",
        "title": "[P1] Integration tests — fill in the stubs",
        "assignee": "qa", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            `packages/support-core/__tests__/integration/` has 6 stub files: `inbound-sms-flow.test.ts`, `inbound-email-flow.test.ts`, `outbound-message-flow.test.ts`, `rls-policies.test.ts`, `realtime-events.test.ts`, `seed-idempotency.test.ts`. They are stubs — flesh them out against the real InsForge dev DB.

            ## Tasks
            - Set up a docker-compose or local Postgres for the integration suite (check if one exists; if not, propose the simplest setup).
            - For each stub, implement the test body against the seeded DB:
              - inbound-sms: send a real-shape Twilio webhook payload to the function, verify a `messages` row, a `conversations` row, an `ai_decisions` row (after the job runs), an `audit_logs` row.
              - inbound-email: same for Postmark.
              - outbound-message-flow: call `OutboundMessageService.sendReply` with a mock adapter, verify the `messages` row + audit log + realtime event.
              - rls-policies: the SQL probes from the `[P0] RLS audit` card, run as part of CI.
              - realtime-events: subscribe to `org:{orgId}` channel, trigger an event, assert receipt within N seconds.
              - seed-idempotency: run `insforge/seed.sql` twice, assert no duplicate rows.

            ## Skills
            `test-driven-development`, `subagent-driven-development`, `insforge`, `insforge-debug`.

            ## Acceptance criteria
            - All 6 integration tests pass against a clean DB.
            - Tests are deterministic — no flakiness from network or timing. Use polling with explicit timeouts, not `setTimeout`.
            - CI runs integration tests in a separate job from unit tests (slower, gated).
        """),
    },
    {
        "id": "t_qa_ai_eval",
        "title": "[P2] AI evaluation harness — golden conversations + LLM-as-judge",
        "assignee": "qa", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            The AI agent (`ai-agent-service.ts`, 19.5 KB) has unit tests but no end-to-end evaluation. Build a golden-conversation suite that exercises real OpenRouter calls (or a deterministic mock) and grades the output.

            ## Tasks
            - Curate 20-30 golden conversations: each is a seed `messages` history + an expected `ai_decisions` row (escalate / draft / auto-reply) + a rubric for the reply text (length, tone, contains-key-fact, no-emoji-in-formal-context, etc.).
            - Write an `eval.ts` script that runs each golden conversation through `ai-agent-service.ts` and produces a CSV: `conversation_id, expected_decision, actual_decision, match, expected_rubric, rubric_pass`.
            - For text quality, use an LLM-as-judge (a second, stronger model rates the reply against the rubric) with a structured JSON output.
            - Run the harness against the current `gpt-4o-mini` default and at least one other model (e.g. `claude-haiku`). Compare decision accuracy and rubric pass rate.
            - Add a "regression gate" to CI: if the harness's pass rate drops > 5% from the last green commit, fail the build.

            ## Skills
            `dspy`, `evaluating-llms-harness`, `test-driven-development`, `subagent-driven-development`, `weights-and-biases` (for tracking runs).

            ## Acceptance criteria
            - 20+ golden conversations in `packages/support-core/__tests__/golden/`.
            - `npm run eval` runs the harness and writes a CSV to `eval-output/`.
            - CI gate fires on a synthetic 10% drop.
            - Comparison report between two models is reproducible.
        """),
    },

    # ========================================================================
    # SECTION 4 — DevOps / infra
    # ========================================================================
    {
        "id": "t_devops_repo_setup",
        "title": "[P0] Repo setup (license, contributing, CI, gitignore)",
        "assignee": "devops", "status": "done", "priority": 0, "created_by": "user",
        "body": textwrap.dedent("""\
            Housekeeping before launch: LICENSE, CONTRIBUTING, CI workflow, .gitignore, issue and PR templates. Most of this is "set it once, never touch it" but if you skip it, the first outside contributor hits a wall.

            ## Tasks
            - LICENSE — pick one (MIT / Apache 2.0 are fine for an OSS-friendly posture; otherwise Proprietary with a `LICENSE` file saying "All rights reserved").
            - .gitignore — verify it covers `node_modules/`, `.next/`, `.env.local`, `.insforge/`, `coverage/`, `eval-output/`, `dist/`, `*.log`.
            - CONTRIBUTING.md — Conventional Commits, branch naming, PR template.
            - .github/ISSUE_TEMPLATE/bug.md and feature.md.
            - .github/PULL_REQUEST_TEMPLATE.md.
            - .github/workflows/ci.yml — install, lint, typecheck, test, build. Use a Node 18+ matrix. Cache `node_modules` and `.next/cache`.

            ## Skills
            `local-tunnel` (for the webhook testing step), `webhook-subscriptions`, `documentation-and-adrs`, `insforge-cli`.

            ## Acceptance criteria
            - All 7 files exist at the right paths.
            - CI runs green on a fresh push to a feature branch.
            - A simulated PR goes through the PR template + the issue templates and is well-formed.
        """),
    },
    {
        "id": "t_devops_migration_runner",
        "title": "[P0] Migration runner script (idempotent, reversible)",
        "assignee": "devops", "status": "ready", "priority": 0, "created_by": "user",
        "body": textwrap.dedent("""\
            The 3 migration files (`001_initial_schema.sql`, `002_rpc_functions.sql`, `003_rls_policies.sql`) plus `insforge/seed.sql` need a one-command runner that can apply them in order, on a fresh DB, and be re-runnable (idempotent). Today they are "apply via the InsForge SQL editor" — that does not scale to a CI pipeline or a new dev onboarding.

            ## Tasks
            - Write `scripts/apply-migrations.sh` that:
              - Reads `insforge/migrations/*.sql` in order.
              - Applies each via `psql` (or the InsForge REST SQL endpoint) with `set -euo pipefail`.
              - Tracks applied migrations in a `schema_migrations` table (version, applied_at, sha256 of the file).
              - Skips already-applied migrations unless `--force` is passed.
            - Write `scripts/apply-migrations.down.sh` that rolls back the last N migrations, using a `*.down.sql` companion file if it exists, or a "best-effort" DROP for known objects otherwise.
            - Write `scripts/seed.sh` that runs `insforge/seed.sql` (idempotent by design per README).
            - CI uses the apply-migrations script in the integration-test job before the tests run.

            ## Skills
            `insforge-cli`, `insforge`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - `scripts/apply-migrations.sh` on a fresh DB: 0 to 17 tables, all RLS policies, both RPC functions.
            - `scripts/apply-migrations.sh` on an already-migrated DB: no-op (verified by row count in `schema_migrations`).
            - `scripts/apply-migrations.down.sh --last 1` removes the most recent migration cleanly.
            - The CI integration job uses the script and the integration tests pass after.
        """),
    },
    {
        "id": "t_devops_observability",
        "title": "[P1] Structured logging + per-tenant log query",
        "assignee": "devops", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            Every function entrypoint should log structured JSON (timestamp, level, request_id, org_id, user_id, function_name, duration_ms, status). The current logger (in `insforge/functions/_shared/`, check `create-db-client.ts`) is mostly `console.log` — replace with a small structured logger and ship logs to a queryable place.

            ## Tasks
            - Create `insforge/functions/_shared/logger.ts` with a `log(event: LogEvent)` function that emits JSON to stdout.
            - Wrap each function entrypoint in a try/catch that logs the start, end, duration, and any caught error.
            - Decide on a log destination. Two reasonable choices:
              - (a) InsForge's own log endpoint (if exposed) — simplest
              - (b) A separate log sink (e.g. Axiom / Logtail) via fetch
            - Document the choice in `docs/OBSERVABILITY.md`.
            - Add a vitest unit test for the logger (JSON shape, level filter).

            ## Skills
            `insforge`, `insforge-debug`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - Every function entrypoint logs a start and end event with the required fields.
            - A failed request logs an error event with the stack and the request_id.
            - A log query by `org_id` returns only that org's events.
            - A log query by `request_id` returns the full request lifecycle (start to end).
        """),
    },
    {
        "id": "t_devops_perf_budget",
        "title": "[P2] Performance budget + Lighthouse + API p95 targets",
        "assignee": "devops", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            Define a perf budget, instrument it, gate CI on regressions. Targets based on the SaaS-support-tool category norms: LCP < 2.5s, INP < 200ms, CLS < 0.1 on the inbox page; API p95 < 500ms for read endpoints, < 2s for AI-bound endpoints.

            ## Tasks
            - Add `lighthouserc.cjs` at the repo root with the budget above and a CI integration.
            - Add an API perf check script `scripts/api-perf.sh` that hits `/functions/v1/send-reply`, `/functions/v1/regenerate-ai-draft`, `/functions/v1/approve-ai-draft` and asserts p95 < threshold.
            - Document the budget in `docs/PERFORMANCE.md` with the rationale.
            - Add a CI job that runs both and posts the result as a PR comment.

            ## Skills
            `subagent-driven-development`, `insforge`, `test-driven-development`.

            ## Acceptance criteria
            - Lighthouse CI runs on every PR and reports the three core web vitals.
            - A regression > 10% on any metric fails the PR.
            - `docs/PERFORMANCE.md` is referenced from LAUNCH_CHECKLIST.md.
        """),
    },
    {
        "id": "t_devops_webhook_tunnel",
        "title": "[P2] Local webhook testing (tunnel from dev to Twilio/Postmark)",
        "assignee": "devops", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            Twilio and Postmark need a public URL to send webhooks to. Devs currently fake this with `ngrok` ad-hoc. Standardize it.

            ## Tasks
            - Add `npm run tunnel` script that uses `localtunnel` (or `ngrok` if already configured) to expose `:3000` and print the public URL.
            - Add a `docs/LOCAL_DEV.md` section that explains: how to point a Twilio sandbox number at the tunnel URL, how to point a Postmark inbound webhook at the tunnel URL, how to update the URL when the tunnel restarts.
            - Add a vitest that fakes a Twilio webhook payload, POSTs it to the tunnel URL, and asserts the function processes it.

            ## Skills
            `local-tunnel`, `webhook-subscriptions`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - `npm run tunnel` starts the tunnel, prints the URL, and keeps running until Ctrl-C.
            - A real Twilio sandbox SMS to the configured number lands in the local InboxPilot inbox.
            - The vitest reproduces the above in CI using a local tunnel.
        """),
    },
    {
        "id": "t_devops_secret_rotation",
        "title": "[P2] Secret rotation runbook + test",
        "assignee": "devops", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            Provider credentials (Twilio `auth_token`, Postmark `server_token`, OpenRouter `api_key`) live in InsForge's secrets store, referenced by `credentials_secret_id`. There is no runbook for rotating them in place without dropping a tenant.

            ## Tasks
            - Write `docs/SECRET_ROTATION.md` covering: pre-rotation checklist (alert tenants, schedule window), the rotation steps per provider (Twilio: rotate in Twilio console, update secret in InsForge, restart functions, verify test-connection), post-rotation verification.
            - Add a vitest that simulates a rotation: create a `sms_provider_accounts` row with secret A, send a test SMS, rotate to secret B, send another test SMS, assert both work.
            - Make the runbook reference-able from LAUNCH_CHECKLIST.md.

            ## Skills
            `insforge`, `insforge-debug`, `insforge-cli`, `documentation-and-adrs`, `subagent-driven-development`, `test-driven-development`.

            ## Acceptance criteria
            - Runbook covers the 3 providers and the 3 rotation phases.
            - Vitest passes on a clean DB.
            - The runbook is referenced from the launch checklist.
        """),
    },

    # ========================================================================
    # SECTION 5 — Design
    # ========================================================================
    {
        "id": "t_design_inbox_states",
        "title": "[P1] Inbox UI states (empty, loading, error, escalated lane, AI-draft pending)",
        "assignee": "design", "status": "ready", "priority": 1, "created_by": "user",
        "body": textwrap.dedent("""\
            The 8 inbox components exist but their empty / loading / error states are inconsistent and the "Escalated" lane UX is undefined. A support agent lives in the inbox 8 hours a day — every state needs to be intentional, not afterthought.

            ## Tasks
            - For each of: `ConversationList`, `MessageThread`, `AiDraftPanel`, `ReplyComposer`, `StatusBadge` — produce a Figma (or a hand-drawn sketch) of: empty, loading, error, success states. Note hover and focus states for keyboard nav.
            - The "Escalated" lane: where does it live in `ConversationList`? Filter chip? Sort order? Color treatment?
            - The "AI draft pending" state: how does `AiDraftPanel` show that the AI is thinking? (Skeleton, spinner, elapsed-time label?)
            - Spec the keyboard shortcuts: J/K for next/prev conversation, R for reply, Cmd-Enter to send, E to escalate, S to resolve. Document in the Figma.
            - Hand off to the `[P1] Inbox UI end-to-end` eng card with annotated screenshots.

            ## Skills
            `frontend-design`, `popular-web-designs`, `web-design-guidelines`, `humanizer`.

            ## Acceptance criteria
            - 5 components x 4 states = 20 mock states in Figma (or sketch + markdown).
            - Keyboard shortcut spec is in the Figma, not just a comment.
            - "Escalated" lane treatment is decided (not "TBD").
            - Eng hand-off doc references the specific frames.
        """),
    },
    {
        "id": "t_design_knowledge_ux",
        "title": "[P2] Knowledge base upload UX (drag-and-drop, status, delete confirm)",
        "assignee": "design", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            `[P1] Knowledge base ingestion UI` is the eng build; this card is the UX design that feeds it. The current `app/knowledge/page.tsx` is empty — needs the full upload flow designed before the eng build starts.

            ## Tasks
            - Drag-and-drop zone with hover state, file-type validation, size limit.
            - Upload-progress states: queued, uploading, processing, ready, failed.
            - Failed state: show the error message, a "view error" link to the server log, a "retry" button.
            - Delete confirm: a soft-confirm modal that explains "this will remove the document and any cached embeddings; the AI will stop referencing it on the next message" — not a generic "are you sure?".
            - Document detail view: chunk count, token estimate, last-tested-at, source URL (if it was a URL import).
            - The hand-off includes Figma frames with copy, not just shapes.

            ## Skills
            `frontend-design`, `web-design-guidelines`, `humanizer`.

            ## Acceptance criteria
            - 6 frames in Figma covering: drop zone, upload-progress, ready state, failed state, delete confirm, document detail.
            - All copy is in the frames (not "Lorem ipsum" and not "TBD").
            - Hand-off to eng includes the asset list (icons, colors, type scale).
        """),
    },
    {
        "id": "t_design_analytics_dashboard",
        "title": "[P2] Analytics dashboard visual design",
        "assignee": "design", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            The `[P1] Analytics dashboard` eng build needs the visual design first. A support lead is the primary reader — they need to scan the page in 5 seconds and answer "are we ok this week?".

            ## Tasks
            - KPI tile design: 4-6 tiles, each with current value, delta vs prior period, sparkline.
            - Trendline charts: 3 line charts (volume, AI-resolved, escalations), all with the same time axis for easy comparison.
            - Drilldown tables: top-10 escalation keywords, top-10 contacts, channel split. Sortable, with a CSV export button per row.
            - Color: green for healthy, yellow for watch, red for action. Document the threshold mapping.
            - Mobile: support leads often check on the go — design a 1-column collapsed layout.

            ## Skills
            `frontend-design`, `popular-web-designs`, `web-design-guidelines`, `humanizer`.

            ## Acceptance criteria
            - Figma with all tiles and charts in desktop + mobile.
            - Color thresholds documented in the Figma's design system panel.
            - Hand-off includes the chart-library recommendation (e.g. Recharts vs Tremor vs custom SVG).
        """),
    },
    {
        "id": "t_design_onboarding",
        "title": "[P2] First-run onboarding (3 steps, <= 5 min to first AI-replied SMS)",
        "assignee": "design", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            A new tenant opens InboxPilot and needs to send their first AI-replied SMS in under 5 minutes. The current flow (register, settings, connect Twilio, set knowledge base, flip auto-reply on) takes 20+ minutes and is the #1 place SMB support tools lose people.

            ## Tasks
            - 3-step wizard: (1) Connect SMS, (2) Connect email (skippable), (3) Add one knowledge document. Skip-able step 2 to keep the < 5 min target for SMS-first users.
            - Each step has a "what this does" tooltip that explains the value, not the feature.
            - After step 3: a "send a test message" prompt that shows the full loop in 60 seconds.
            - Empty state for the inbox post-onboarding: a "your first message will appear here" placeholder with a refresh button.
            - Hand-off to eng with Figma + the copy + a checklist of all the things the wizard MUST verify (e.g. test-connection success before allowing "next").

            ## Skills
            `frontend-design`, `web-design-guidelines`, `humanizer`.

            ## Acceptance criteria
            - Figma with all 3 steps + the test-message prompt + the empty-inbox state.
            - Copy is in the frames, ready to paste into the React components.
            - Hand-off specifies the time target per step (<= 90s for step 1, <= 60s for step 2, <= 90s for step 3).
        """),
    },

    # ========================================================================
    # SECTION 6 — Security / compliance (PM-driven)
    # ========================================================================
    {
        "id": "t_sec_security_model",
        "title": "[P0] Security model (one-pager, PM-authored)",
        "assignee": "pm", "status": "todo", "priority": 0, "created_by": "pm",
        "body": textwrap.dedent("""\
            One-pager explaining InboxPilot's security model in language a customer's CISO or compliance lead can read. The technical controls are already in the code (RLS, secrets-endpoint, audit logs, JWT); the *narrative* of how they compose is what is missing.

            ## Scope

            Sections:
            1. **Tenant isolation** — every query is org-scoped at the database level via RLS. Even a bug in app code cannot leak across tenants. (Reference `insforge/migrations/003_rls_policies.sql` and the `[P0] RLS audit` card.)
            2. **Credential storage** — provider credentials live in the InsForge secrets endpoint, not in the `*_provider_accounts` rows. The `credentials_secret_id` column is SELECT-revoked from client roles. (Reference the column-level revocation in `003_rls_policies.sql`.)
            3. **Authentication** — InsForge JWT, server-validated on every function entrypoint that takes a user action. Webhook signature verification on every inbound. (Reference `insforge/functions/_shared/verify-jwt.ts` and the per-adapter signature logic.)
            4. **Audit trail** — every significant action writes an append-only `audit_logs` row. The RLS policy on `audit_logs` denies UPDATE and DELETE. (Reference the audit-log property test in `__tests__/properties/audit-log.prop.test.ts`.)
            5. **AI safety** — escalation rules fire before any LLM call. The AI never sees profanity, legal threats, or safety concerns unfiltered. (Reference `escalation-rules.ts` and the 8 rules.)
            6. **Threat model summary** — name the threats we explicitly addressed (cross-tenant access, credential leak, prompt injection, AI misuse) and the threats we did NOT (DDoS at the edge, key compromise on the customer side).
            7. **Incident response** — point to `docs/INCIDENT_RESPONSE.md` (separate card) for the runbook.

            ## Acceptance criteria
            - `InboxPilot/docs/SECURITY_MODEL.md` exists.
            - Every claim in the doc is backed by a file:line reference in this repo.
            - Linked from LAUNCH_CHECKLIST.md section 6.
            - Reviewed by a technical reviewer (e.g. engineering lead) before publishing.

            ## Out of scope
            - Penetration test. That is a separate card and requires an external firm.
            - SOC2 audit. Separate workstream.
        """),
    },
    {
        "id": "t_sec_incident_response",
        "title": "[P1] Incident response runbook (AI-sent-wrong-reply, cross-tenant leak, credential leak)",
        "assignee": "pm", "status": "todo", "priority": 1, "created_by": "pm",
        "body": textwrap.dedent("""\
            The runbook for the 3 incident classes we care about. Without this, the first AI-sent-wrong-reply in production will be a 3am panic, not a 15-minute triage.

            ## Scope

            Three scenarios, each with: trigger, first-15-minutes, first-hour, first-day, post-mortem.

            ### Scenario 1 — AI sent a wrong / harmful reply
            - **Trigger:** customer complaint, support lead flag, or auto-detected by the `[P2] AI evaluation harness`.
            - **First 15 min:** identify the conversation ID; flip the org's `ai_settings.mode` to `off` to stop further auto-replies; pull the `ai_decisions` row + the `audit_logs` for the conversation.
            - **First hour:** if the reply is *harmful* (not just wrong), identify all recipients (could be 1 or could be 1000 if a rule was disabled and we batched); draft a customer-facing apology template.
            - **First day:** root-cause: was it a missing escalation rule, a low-quality knowledge chunk, a model behavior change, or a threshold misconfig? Patch and write a post-mortem.
            - **Post-mortem:** add a regression test to the golden conversations suite.

            ### Scenario 2 — Cross-tenant data leak suspected
            - **Trigger:** a customer reports seeing another org's data; an internal RLS audit finds a gap; an outside researcher reports a finding.
            - **First 15 min:** stop the leak — identify the RLS policy or function that allowed it, disable the function or revert the migration; preserve evidence.
            - **First hour:** determine scope — how many orgs, how many rows, what data classes. Pull from `audit_logs` to enumerate.
            - **First day:** notify affected orgs per the data-processing agreement. Engage legal if PII is involved.
            - **Post-mortem:** add a probe to the integration test suite to prevent regression.

            ### Scenario 3 — Provider credential leak
            - **Trigger:** a credential is found in a public repo, a customer's logs, or a misconfigured bucket.
            - **First 15 min:** rotate the credential in the provider's console; update the secret in InsForge secrets endpoint; restart functions if needed.
            - **First hour:** audit the credential's usage window — which orgs sent messages in the period? Any unauthorized sends? Pull from `sms_delivery_events` and `email_delivery_events`.
            - **First day:** if unauthorized sends happened, contact affected contacts (per the AUP) and consider provider-side rate-limit or block.
            - **Post-mortem:** add a check to the secret-rotation runbook to catch the same misconfiguration earlier.

            ## Acceptance criteria
            - `InboxPilot/docs/INCIDENT_RESPONSE.md` exists with all 3 scenarios.
            - Each scenario has the 4-phase timing structure.
            - Linked from LAUNCH_CHECKLIST.md and SECURITY_MODEL.md.
            - Tested once: a "tabletop" exercise where the team walks through scenario 1 on a whiteboard.

            ## Suggested skills
            `documentation-and-adrs`, `grill-me` (run the tabletop scenario and pressure-test it).
        """),
    },
    {
        "id": "t_sec_pentest_scope",
        "title": "[P2] Pen-test scope doc (for engaging an external firm)",
        "assignee": "pm", "status": "todo", "priority": 2, "created_by": "pm",
        "body": textwrap.dedent("""\
            The scope document for the external pen-test that needs to happen before SOC2 / enterprise deals. Even if we do not engage yet, having the doc ready means we can move fast when the budget lands.

            ## Scope

            Sections:
            1. **System overview** — 1 page, the architecture diagram from `docs/ARCHITECTURE.md`, plus a list of all 14 function entrypoints and their auth methods.
            2. **In-scope assets** — the 6 app pages, the 14 function entrypoints, the InsForge dashboard (separate test account), the 3 migration files (review only), the audit log writer.
            3. **Out-of-scope** — the InsForge platform itself, the OpenRouter / Twilio / Postmark APIs (third-party), the Next.js framework.
            4. **Test types** — black-box external, grey-box authenticated, social engineering (phishing) for the admin user.
            5. **Credentials provided** — 2 test tenants (1 owner role, 1 agent role), a JWT generator for impersonation testing, a seeded DB with realistic data.
            6. **Success criteria** — finding classification (CRITICAL/HIGH/MEDIUM/LOW/INFO matching our internal rubric), acceptance window, what counts as a "fix verified".
            7. **Legal** — authorization letter, data handling agreement, NDA, the standard "you do not own the data" clause.
            8. **Budget range** — research the going rate for SaaS BaaS pen-tests ($15k-40k typical for 2 weeks) and note it in the budget section.

            ## Acceptance criteria
            - `InboxPilot/docs/PENTEST_SCOPE.md` exists.
            - All 8 sections present with the contents above.
            - Reviewed by the engineering lead for technical accuracy.
            - Linked from LAUNCH_CHECKLIST.md and SECURITY_MODEL.md.

            ## Out of scope
            - The actual pen-test engagement. This is the *scope doc* — engaging a firm is a separate action.
        """),
    },
    {
        "id": "t_sec_dpa_aup",
        "title": "[P2] DPA + AUP templates (for beta tenants and beyond)",
        "assignee": "pm", "status": "todo", "priority": 2, "created_by": "pm",
        "body": textwrap.dedent("""\
            Two legal templates every enterprise-ish customer will ask for before signing. Use off-the-shelf open-source templates (e.g. the Open Data Commons DPA, the GitHub AUP) and customize for our specific data classes (PII, message content, embeddings).

            ## Scope

            - **DPA (Data Processing Agreement)** — at minimum: parties, data classes, processing purposes, sub-processors (InsForge, OpenRouter, Twilio, Postmark), data location, data subject rights (access / delete / export), breach notification window (72h GDPR-aligned), termination clauses.
            - **AUP (Acceptable Use Policy)** — at minimum: no illegal content, no spam, no harassment, no impersonation, no scraping, no reverse-engineering the AI; consequences (warning to suspension to termination); the AI-reply disclaimer ("AI-generated, review before relying on").

            ## Acceptance criteria
            - `InboxPilot/legal/DPA.md` and `InboxPilot/legal/AUP.md` exist.
            - Reviewed by a lawyer before any tenant signs (this card is the *template*, not the legal review).
            - Linked from `docs/BETA_TERMS.md` (referenced from the beta program design card).

            ## Out of scope
            - The legal review itself. That requires a real lawyer.
        """),
    },

    # ========================================================================
    # SECTION 7 — Operational / cross-cutting
    # ========================================================================
    {
        "id": "t_ops_runbook",
        "title": "[P2] Operator runbook (deploy, rollback, tenant on/off-boarding, quota reset)",
        "assignee": "devops", "status": "ready", "priority": 2, "created_by": "user",
        "body": textwrap.dedent("""\
            The runbook for the 4 operations a real SaaS does every week. Without it, the first time we have to rollback a function, we will fumble it.

            ## Tasks
            - **Deploy** — one-command deploy of all 14 functions + the latest migration. The InsForge CLI does most of this; document the exact commands and the order.
            - **Rollback** — `scripts/rollback.sh` that redeploys the previous function versions and applies the down-migration if needed. Test it on staging.
            - **Tenant onboarding** — the wizard does most of it; the runbook is the manual fallback (e.g. enterprise customer wants a white-glove setup).
            - **Tenant offboarding** — the legal/privacy request path: export all data, soft-delete, then hard-delete after the retention window. Document the data classes and the retention default.
            - **Quota reset** — for the per-tenant conversation quota: cron job, edge cases (what if a tenant is at 99% of quota at the reset moment?).
            - **On-call rotation** — if we have one, document the schedule, the alert routing, and the escalation tree.

            ## Skills
            `insforge-cli`, `insforge`, `insforge-debug`, `documentation-and-adrs`, `subagent-driven-development`, `local-tunnel`.

            ## Acceptance criteria
            - `InboxPilot/docs/OPERATOR_RUNBOOK.md` exists with all 6 sections.
            - `scripts/rollback.sh` runs cleanly on staging and is referenced.
            - Tenant offboarding tested on a sample tenant in staging.
            - Linked from LAUNCH_CHECKLIST.md.
        """),
    },
    {
        "id": "t_ops_support_handoff",
        "title": "[P2] Tier-1 support handoff (FAQ, known issues, escalation path to eng)",
        "assignee": "pm", "status": "todo", "priority": 2, "created_by": "pm",
        "body": textwrap.dedent("""\
            The first 5 design-partner tenants will email us when something breaks. We need a Tier-1 support playbook so the first reply is fast and consistent — and so we know which issues are real bugs vs expected behavior.

            ## Scope

            - **FAQ** — 20-30 questions across: pricing/billing, "why did not my SMS send", "how do I rotate credentials", "where do I find the audit log", "can I add more seats". Each with a 1-2 sentence answer + a link to a deeper doc.
            - **Known issues** — a living doc. Any issue we cannot fix in 48h goes here, with status and ETA.
            - **Escalation path** — Tier 1 (us, the founders/PM for v1) to Tier 2 (engineering on rotation) to Tier 3 (founder-level for anything legal or security).
            - **Tone & voice** — short version. We respond within 4 business hours in v1. We never blame the customer. We never say "this is by design" without a workaround.

            ## Acceptance criteria
            - `InboxPilot/docs/SUPPORT_PLAYBOOK.md` exists with all 4 sections.
            - FAQ has at least 20 entries.
            - Known-issues section is empty at launch (we want it that way).
            - Escalation path lists real names + roles.
            - Tone doc has 5-7 do/do not examples.
        """),
    },
    {
        "id": "t_ops_status_page",
        "title": "[P3] Status page + incident comms template",
        "assignee": "devops", "status": "todo", "priority": 3, "created_by": "pm",
        "body": textwrap.dedent("""\
            A public status page (status.inboxpilot.example) for the 3 services we depend on: InsForge, OpenRouter, the SMS/email providers. Plus a template for incident comms.

            ## Tasks
            - Pick a status page host (Statuspage, Better Uptime, or a self-hosted option). Recommend one.
            - Wire a simple "is X up?" check from the operator runbook for each upstream.
            - Write 3 incident-comms templates: degraded (something is slow), partial outage (some users affected), full outage. Each with: subject line, opening line, current status, next-update cadence, closing line.
            - Document the process for posting an incident in `docs/INCIDENT_COMMUNICATIONS.md`.

            ## Skills
            `webhook-subscriptions`, `documentation-and-adrs`, `subagent-driven-development`.

            ## Acceptance criteria
            - Status page is live and reachable.
            - The 3 upstream checks run every 60s and update the page.
            - 3 incident-comms templates exist.
            - Process doc is referenced from INCIDENT_RESPONSE.md and the operator runbook.

            ## Out of scope
            - Customer-facing comms workflow. The template is for *us* to use; the workflow (when to email all tenants vs only affected) is in a future card.
        """),
    },

    # ========================================================================
    # SECTION 8 — Pre-existing / done
    # ========================================================================
    {
        "id": "t_done_initial_schema",
        "title": "[DONE] 001_initial_schema.sql — 17 tables, indexes, extensions",
        "assignee": "engineering", "status": "done", "priority": 0, "created_by": "user",
        "body": "The initial schema migration is in place: 17 tables, indexes, the pgcrypto and vector extensions, the `gen_random_uuid()` default. Anchor for the rest of the work — every other migration assumes this is applied. File: `insforge/migrations/001_initial_schema.sql` (15.0 KB).",
    },
    {
        "id": "t_done_rls_policies",
        "title": "[DONE] 003_rls_policies.sql — tenant isolation, append-only audit logs",
        "assignee": "engineering", "status": "done", "priority": 0, "created_by": "user",
        "body": "RLS policies in place for all 17 tables, with column-level SELECT revocations on `*_credentials_secret_id` columns. `audit_logs` is INSERT-only. File: `insforge/migrations/003_rls_policies.sql` (16.9 KB). The QA RLS audit card will verify this in practice.",
    },
    {
        "id": "t_done_rpc_functions",
        "title": "[DONE] 002_rpc_functions.sql — match_knowledge_chunks + claim_support_jobs",
        "assignee": "engineering", "status": "done", "priority": 0, "created_by": "user",
        "body": "Two RPC functions: `match_knowledge_chunks` (pgvector similarity search) and `claim_support_jobs` (atomic job queue claim with SKIP LOCKED). File: `insforge/migrations/002_rpc_functions.sql` (2.1 KB).",
    },
    {
        "id": "t_done_support_core",
        "title": "[DONE] packages/support-core — portable business logic",
        "assignee": "engineering", "status": "done", "priority": 0, "created_by": "user",
        "body": "The portable business-logic package is in place. 9 services, 14 repositories, 4 adapters, type/interfaces/utils layers, with the strict no-InsForge-SDK rule enforced. 11 property-based test suites + 14 example-based unit tests + 6 integration test stubs. This is the architectural foundation everything else builds on.",
    },
    {
        "id": "t_done_function_entrypoints",
        "title": "[DONE] 14 serverless function entrypoints",
        "assignee": "engineering", "status": "done", "priority": 0, "created_by": "user",
        "body": "All 14 function entrypoints scaffolded: sms-inbound, sms-status, email-inbound, email-status, send-reply, approve-ai-draft, regenerate-ai-draft, process-ai-job, process-knowledge-document, process-jobs, escalate-conversation, resolve-conversation, reopen-conversation, test-channel-connection. Auth is in place (webhook sigs for inbound/status, JWT for user actions, internal for cron-triggered jobs).",
    },
    {
        "id": "t_done_docs",
        "title": "[DONE] Documentation set (ARCHITECTURE, DATABASE, API, DEVELOPMENT, TESTING, deep-research-report)",
        "assignee": "pm", "status": "done", "priority": 0, "created_by": "user",
        "body": "6 docs files in `InboxPilot/docs/`. This PM-seeded board assumes they exist and references them by name. The PM-authored cards (PRD, METRICS, USER_STORIES, LAUNCH_CHECKLIST, etc.) are the gaps that this scaffold does not yet have.",
    },
    {
        "id": "t_done_seed",
        "title": "[DONE] insforge/seed.sql — idempotent dev seed (1 org, 3 contacts, 5 conversations, 10 messages, 2 KB docs)",
        "assignee": "engineering", "status": "done", "priority": 1, "created_by": "user",
        "body": "Idempotent seed for local development. 1 org with 1 owner member, 3 contacts (SMS + email), 5 conversations, 10 messages with varied sender types, 2 knowledge documents with chunks and embeddings, sample AI settings. The integration test suite depends on this.",
    },
    {
        "id": "t_archived_devops_changelog",
        "title": "[ARCHIVED] Stub changelog (replaced by release-aggregation workflow)",
        "assignee": "devops", "status": "archived", "priority": 2, "created_by": "user",
        "body": "The original CHANGELOG.md was a hand-maintained stub. It has been replaced by the release-aggregation workflow (the `[Release]` card from PageVault's pattern, ported for InboxPilot). Keeping the ID alive for audit-trail reasons.",
    },
    {
        "id": "t_archived_design_v0_brand",
        "title": "[ARCHIVED] v0 brand exploration (logo, color, type) — superseded by v1 system",
        "assignee": "design", "status": "archived", "priority": 2, "created_by": "user",
        "body": "The v0 brand exploration (3 logo directions, 2 type pairings, 4 color schemes) was a useful warm-up but the v1 system (in the in-progress `[P2] Inbox UI states` work) is the source of truth. Archived to keep the file tree clean.",
    },
]


# task_links (parent_id, child_id) — same shape as PageVault board.
# Each link expresses: "this parent task produces/unblocks this child task".
LINKS = [
    # PM epics fan out to children
    ("t_pm_prd", "t_eng_auth"),
    ("t_pm_prd", "t_eng_inbox_ui"),
    ("t_pm_prd", "t_eng_knowledge_ingestion"),
    ("t_pm_prd", "t_eng_settings_ai"),
    ("t_pm_prd", "t_pm_user_stories"),
    ("t_pm_prd", "t_pm_metric_tree"),

    ("t_pm_user_stories", "t_eng_inbox_ui"),
    ("t_pm_user_stories", "t_eng_knowledge_ingestion"),
    ("t_pm_user_stories", "t_eng_settings_ai"),
    ("t_pm_user_stories", "t_eng_settings_channels"),
    ("t_pm_user_stories", "t_eng_analytics_dashboard"),
    ("t_pm_user_stories", "t_design_onboarding"),

    ("t_pm_metric_tree", "t_eng_instrumentation"),
    ("t_pm_metric_tree", "t_eng_analytics_dashboard"),

    ("t_pm_launch_checklist", "t_qa_bug_hunt"),
    ("t_pm_launch_checklist", "t_qa_rls_audit"),
    ("t_pm_launch_checklist", "t_sec_security_model"),
    ("t_pm_launch_checklist", "t_sec_incident_response"),
    ("t_pm_launch_checklist", "t_devops_perf_budget"),
    ("t_pm_launch_checklist", "t_pm_beta_program"),
    ("t_pm_launch_checklist", "t_pm_pricing_packaging"),
    ("t_pm_launch_checklist", "t_ops_runbook"),
    ("t_pm_launch_checklist", "t_pm_competitive"),

    ("t_pm_beta_program", "t_design_onboarding"),
    ("t_pm_pricing_packaging", "t_pm_beta_program"),

    # QA bug-hunt children — CRITICAL/HIGH/MEDIUM findings spawn off this
    ("t_qa_bug_hunt", "t_qa_rls_audit"),
    ("t_qa_bug_hunt", "t_qa_escalation_proptest"),
    ("t_qa_bug_hunt", "t_qa_integration_flows"),
    ("t_qa_bug_hunt", "t_qa_ai_eval"),
    ("t_qa_bug_hunt", "t_pm_tech_debt_backlog"),

    # Security
    ("t_sec_security_model", "t_sec_incident_response"),
    ("t_sec_security_model", "t_sec_pentest_scope"),
    ("t_sec_incident_response", "t_ops_status_page"),

    # Devops
    ("t_devops_repo_setup", "t_devops_observability"),
    ("t_devops_repo_setup", "t_devops_perf_budget"),
    ("t_devops_repo_setup", "t_devops_webhook_tunnel"),
    ("t_devops_migration_runner", "t_qa_integration_flows"),

    # Eng chains
    ("t_eng_auth", "t_eng_inbox_ui"),
    ("t_eng_settings_ai", "t_eng_inbox_ui"),
    ("t_eng_settings_channels", "t_eng_inbox_ui"),

    # Design chains
    ("t_design_inbox_states", "t_eng_inbox_ui"),
    ("t_design_knowledge_ux", "t_eng_knowledge_ingestion"),
    ("t_design_analytics_dashboard", "t_eng_analytics_dashboard"),
    ("t_design_onboarding", "t_pm_beta_program"),

    # Done cards — anchor for new work
    ("t_done_initial_schema", "t_done_rls_policies"),
    ("t_done_initial_schema", "t_done_rpc_functions"),
    ("t_done_support_core", "t_done_function_entrypoints"),
    ("t_done_docs", "t_pm_prd"),
]
