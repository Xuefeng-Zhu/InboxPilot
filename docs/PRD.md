# InboxPilot — Product Requirements (v1)

> **Status:** v1, source of truth for "what we ship, who it's for, what success looks like, and what we say no to."
> **Last updated:** 2026-06-07
> **Pair with:** `ARCHITECTURE.md` · `DATABASE.md` · `API.md` · `TESTING.md` · `DEVELOPMENT.md` · `PRICING.md` · `LAUNCH_CHECKLIST.md` · `SUPPORT_PLAYBOOK.md` · `SECRET_ROTATION.md` · `QA_BUG_HUNT.md` · `deep-research-report.md` · `legal/DPA.md` · `legal/AUP.md`
> **Kanban:** `t_pm_prd` · parent of: `t_eng_auth`, `t_eng_inbox_ui`, `t_eng_knowledge_ingestion`, `t_eng_settings_ai`, `t_pm_metric_tree`, `t_pm_user_stories`.

## How to read this document

This PRD is the *parent* of every other PM and engineering card on the board. If a section here is contradicted by a child card, the child card is wrong and should defer. The seven sections below are the order; the eight at the bottom are the shape.

The two most important constraints to internalize before reading:

1. **Every MVP-scope item is anchored to a real file in this repo.** No aspirational features, no "we'll figure out the architecture later." If it's not in `app/`, `insforge/functions/`, `packages/support-core/src/`, or `insforge/migrations/`, it's not in v1.
2. **The risks are not theoretical.** At least one risk in §6 is grounded in a specific known defect from `docs/QA_BUG_HUNT.md`, with a file:line citation. We will not pretend the system is safer than it is.

---

## 1. Problem

### 1.1 The pain, in one sentence

Small support teams (1–10 people) are simultaneously being asked to (a) be available on the channels their customers actually use (SMS, email) and (b) answer the same 20 questions 30 times a day, while the existing tools force them to choose between paying for a full helpdesk ($65+/seat/mo before any AI) and rolling a brittle Zapier-to-LLM chain that hallucinates refund amounts.

### 1.2 Why "AI support" hasn't fixed this for SMBs yet

The category has two failure shapes, and SMB support teams hit both:

- **The "drafts but never sends" trap.** The AI drafts replies, but a human has to read and click send on every one. At 200 conversations/day, the human is now the bottleneck the AI was supposed to remove. CSAT doesn't move. (See `PRICING.md` §5, Profile 1, where a 12-person SaaS team reports "our CSAT dropped 8 points" after adopting a DIY GPT-4 reply-drafter.)
- **The "AI sent a refund" catastrophe.** The AI is given too much rope and sends a wrong, costly, or legally-loaded reply. A refund. A shipping promise. A legal disclaimer that's wrong. The team's trust evaporates and they go back to manual. (See `PRICING.md` §5, Profile 2: a DTC store that "stopped using" Gorgias's AI Agent "because it gets refunds wrong.")

The market data in `docs/deep-research-report.md` confirms the *technical* gap (no turnkey OSS omnichannel AI support platform exists; the closest is Chatwoot, which is "not AI-first orchestration"). What it doesn't tell us — and what our design-partner conversations will — is whether SMBs want this product as a *front-end* to their existing helpdesk, or as a replacement for it. **That question is the v1 launch-blocker in §3, metric M0.**

### 1.3 The 5 customer signals we are betting on

We are pre-launch. We do not yet have 5 customer interviews on file. The signals below are the most concrete pain language we have *today* in the repository, and they are the hypotheses the design-partner program (`t_pm_beta_program`) will validate. The PRD is *not* claiming these are validated research; it is claiming these are the bets we ship v1 to test.

1. **"Our AI draft hallucinates 1-in-20 times."** — From `PRICING.md` §5 Profile 1, a 12-person SaaS team's articulation of why they need *InboxPilot's* deterministic escalation rules (`packages/support-core/src/services/escalation-rules.ts`), not another prompt-engineered black box.
2. **"Order-status questions are 60% of our volume."** — From `PRICING.md` §5 Profile 2, a DTC e-commerce store. The bet: a knowledge-base RAG with a 0.7 similarity threshold (`ai_settings.knowledge_similarity_threshold`) and a low-confidence gate at 0.75 (`AiAgentService` default) catches the "make something up" failure mode for the highest-volume question shape.
3. **"We lose 3-4 prospective tenants a week because nobody answered their SMS within 30 minutes."** — From `PRICING.md` §5 Profile 3, a property-management firm. The bet: an SMS-first inbox with auto-reply above a per-tenant confidence threshold is a 30-minute-response-time *floor*, not just a productivity boost.
4. **"The agent is exhausted by hour three of the inbox."** — From `docs/design/inbox-states.md` §1. The *internal* support agent (our user's employee) lives in the inbox 8 hours a day. A spinner-and-red-box UI is not a peripheral-vision surface; the design spec reframes every state to be glanceable, with the escalated lane on a chip (not a column) and the AI panel showing elapsed time in mono, not a spinner.
5. **"The AI sent a wrong reply" has no runbook.** — From `LAUNCH_CHECKLIST.md` §3.3, the runbook gap is explicit. We do not have a `docs/INCIDENT_RESPONSE.md` yet; the parent card `t_sec_incident_response` is the blocker. The PRD commits to shipping v1 *with* this runbook, not after.

**What this list is not.** It is not a market-sizing argument. The total addressable SMB support market is large; we don't need to prove that to ship v1. We need to prove the *thesis*: small teams will pay $99–$499/month for an AI that drafts, escalates, and audits safely on their existing channels. The 5 signals above are what the design-partner program is designed to confirm or refute.

### 1.4 What we are explicitly not solving in v1

The customer pain in §1.1 is scoped to *reactive inbound support on SMS/email*. We are not solving:

- Outbound marketing or sales sequences (Postscript, Klaviyo territory).
- A replacement for the customer's CRM, helpdesk, or order-management system. InboxPilot is a *conversation* surface; the source-of-truth for orders and contacts lives elsewhere and is integrated later.
- Proactive chat widgets on the customer's website. (Listed in §5.)
- Live phone/voice. (Listed in §5.)
- Multi-language support beyond English. (Listed in §5.)

---

## 2. Personas

The PRD names two. The primary persona is the user who *lives* in the inbox 8 hours a day. The secondary persona is the buyer who signs the contract. They have different jobs and tolerate different things.

### 2.1 Primary persona — "Maya, Tier-1 support agent at a 25-person SaaS company"

**A day in her life.** Maya is the first responder for 200–400 inbound conversations a day across SMS and email. She starts at 9am with the inbox already at 40 unread. Her job is to (a) read, (b) decide whether the AI draft is good, (c) approve or rewrite, (d) hit send. She also triages the escalated lane when a customer writes "speak to a human" or mentions a refund. The AI is her drafting assistant, not her replacement. She has 90 seconds per conversation on average, and the inbox is a peripheral-vision surface, not a deep-work tool.

**Tooling today.** Front ($65/seat) or Help Scout ($60/seat), a shared Google Drive of canned responses, and a Slack channel where she @-mentions the support lead when she doesn't know the answer. She does *not* write code. She does *not* tune the AI. She tolerates latency under 3 seconds; she does not tolerate the AI sending a wrong reply without showing her first.

**What she needs from InboxPilot (P0 jobs).**
- **Glanceable state.** She can see, in peripheral vision, whether the AI is thinking, has drafted, or has escalated. (See `docs/design/inbox-states.md` §5, "AI-draft pending — decision": three skeleton lines, elapsed-time label in mono, no spinner.)
- **The Escalated lane.** A filter chip — not a column — that surfaces the conversations that need *her*, sorted by `escalated_at DESC` because old escalations are the highest risk. (See `docs/design/inbox-states.md` §3.)
- **Confidence she can act on.** A confidence chip on every AI draft, in forest/ochre/terra color tiers, so she learns the rhythm at a glance. (See `docs/design/inbox-states.md` §5: "Confidence is always shown, never hidden.")
- **A keyboard for the work.** J/K for navigation, R for the composer, Shift+R for "ask AI again", Cmd+Enter to send, `?` for help. (See `docs/design/inbox-states.md` §8.)
- **A draft she can keep when something breaks.** RC-5 error state preserves the human's in-progress text so a network error doesn't lose her reply. (See `docs/design/inbox-states.md` §10, frame RC-5.)

**What she will not tolerate.**
- A spinner that doesn't tell her how long the AI will take. (Explicitly called out as "a lie" in `inbox-states.md` §5.)
- The AI auto-sending without her approval when `ai_mode = draft_only`. (This is the `Starter` tier's contract; see `PRICING.md` §2.1.)
- Hidden state changes. If the AI re-generates a draft, the previous draft is preserved as a version. (See `inbox-states.md` §8, Shift+R note.)
- Status badges that depend on color alone. (A11y requirement; see `inbox-states.md` §9: "Color is not the only signal.")

**What she is not.** She is not a buyer. She does not care about audit log export, RLS posture, or Stripe. The PRD's secondary persona owns those.

### 2.2 Secondary persona — "Jordan, support lead / owner at the same company"

**A day in his life.** Jordan manages Maya and 2–4 other agents. He is the org owner in the database. His day is split between the inbox (1–2 hours), 1:1s, and the analytics dashboard. He cares about three numbers: deflection rate (the AI resolved it without a human), first-response time (FRT), and CSAT. He also fields the occasional "why did the AI send that?" email from a customer. He is the one who escalates to engineering when the AI is misbehaving.

**Tooling today.** Same helpdesk as Maya, plus Stripe dashboard, plus a Google Sheet where he tracks FRT manually. He has limited tolerance for tooling that adds a new dashboard he has to log into; his data should be in the same place his agents work.

**What he needs from InboxPilot (P0 jobs).**
- **Per-tenant AI settings he can change himself.** `ai_settings.ai_mode` (`off` / `draft_only` / `auto_reply`), `ai_settings.confidence_threshold` (default 0.75, see `packages/support-core/src/services/ai-agent-service.ts:36`), `ai_settings.knowledge_similarity_threshold` (default 0.7), `ai_settings.escalation_keywords` (Scale tier only). All exposed at `app/settings/ai/page.tsx`.
- **The audit log.** Every AI decision, every approve/skip, every inbound — `audit_logs` (`insforge/migrations/001_initial_schema.sql:299`). For the Growth tier, read-only inside the inbox. For the Scale tier, CSV/JSON export of the last 90 days. (See `PRICING.md` §2.3.)
- **The escalation lane's SLA timer.** When a conversation is escalated, Jordan's agents see an SLA countdown in mono, switching to terra at under 15 minutes. (`inbox-states.md` §3.)
- **Per-tenant channel choice.** SMS **or** email on Starter, **and** on Growth+. (See `PRICING.md` §1.)
- **A pricing page he can show his CFO.** `docs/PRICING.md` exists and maps every tier boundary to a code-enforced check.

**What he will not tolerate.**
- A "confidence number" the AI will not honor. The `confidence_threshold` he sets *is* the gate the auto-reply obeys. (See `ai-agent-service.ts:354`: `if (parsed.confidence >= confidenceThreshold && !parsed.requires_human)`.)
- An AI that sends a refund on its own. The `SensitiveTopicRule` (`packages/support-core/src/services/escalation-rules.ts:113`) escalates "refund", "money back", "chargeback" — by design, the AI never sends a refund without a human.
- A data leak between tenants. RLS is on every tenant-scoped table (`insforge/migrations/003_rls_policies.sql`); the manual cross-tenant probe in `LAUNCH_CHECKLIST.md` §2.2 is a go/no-go item.
- A runbook that doesn't exist when the AI goes wrong. `docs/INCIDENT_RESPONSE.md` is a v1 launch-blocker (`LAUNCH_CHECKLIST.md` §3.3, parent card `t_sec_incident_response`).

**What he is not.** He is not the head of customer support at a 500-person SaaS. He does not have an SSO requirement. He does not need a CSM. (See §5: enterprise, SSO, white-label, and dedicated CSM are all out of scope for v1.)

---

## 3. Success metrics

The PRD ships with **one North Star** and **four input metrics**, each tied to a measurable event in the data model. These are the metrics the metric-tree card (`t_pm_metric_tree`) will refine into SQL queries in `docs/METRICS.md`. The PRD does not invent queries; it commits to the *events* those queries will count.

### 3.1 North Star — M0: AI containment rate ≥ 60% by week 4 of a new tenant's life

**Definition.** The share of inbound conversations that resolve (status = `resolved`) within 7 days *without* a human agent having sent an outbound message (sender_type = `human_agent` from `messages`). Counted per tenant, starting at tenant-creation time.

**Why this and not "active tenants" or "MRR."** Active tenants and MRR are *lagging* indicators of whether the product works. Containment is *leading*: if it doesn't hit 60% by week 4, the AI is not actually saving the customer time, and the customer will churn at month 3 regardless of how we price the seat. (The 60% number is anchored to the seed-data shape: a 25-person SaaS company doing 700 conversations/month and treating the AI as a Tier-1 drafter should see ~60% of those conversations fully resolved by an AI-sent reply. See `PRICING.md` §2.2, the Growth tier rationale.)

**Measurement event.** `messages` rows where `sender_type = 'ai_agent'`, joined to `conversations` where `status = 'resolved'` and `resolved_at - conversations.created_at < 7 days`, and where no row in `messages` for the same `conversation_id` has `sender_type = 'human_agent'`. Tenant-scoped: denominator is conversations per org.

**Decision rule.** If the median new tenant at week 4 is below 50%, the AI is not safe enough or not useful enough and we are losing the design-partner cohort. The 50% threshold is a tripwire; the 60% target is the goal.

### 3.2 Input metrics

These are the leading indicators that tell us, *before* the North Star moves, whether the system is on track.

#### M1 — Deflection rate (the safer leading indicator of M0)

**Definition.** The share of inbound messages that result in an outbound message with `sender_type = 'ai_agent'` *or* an `ai_decisions` row with `decision_type = 'respond' AND autoSent = true` (see `ai-agent-service.ts:391`), divided by total inbound messages, per tenant per week.

**Why this and not just M0.** Deflection counts *attempts*; M0 counts *successes*. A tenant with high deflection but low containment is one where the AI is sending a lot of replies but customers are still coming back to a human within 7 days. That is a different failure mode (the AI is *too* confident, or the knowledge base is *too* thin) and demands a different fix.

**Measurement event.** Same as M0 but counts messages, not conversations. Computed in `docs/METRICS.md` (not yet written — see `LAUNCH_CHECKLIST.md` §5.4 and parent card `t_ops_runbook`).

#### M2 — First response time (FRT)

**Definition.** The median time from the first inbound `messages` row on a conversation to the first outbound `messages` row (any sender_type) on the same conversation. Computed per tenant per day, reported weekly.

**Why this matters even more than deflection.** The §1.3 signal #3 (the property-management firm losing 3-4 prospective tenants/week) is fundamentally an FRT problem. Even if the AI never resolves a conversation, getting a *response* in under 30 seconds is the win. FRT moves before containment, so it's our canary.

**Measurement event.** `messages.created_at` deltas, joined on `conversation_id`. The 30-second target is the bet.

#### M3 — CSAT, sampled

**Definition.** For conversations with `status = 'resolved'`, the share of post-resolution CSAT responses that are 4 or 5 on a 5-point scale, where CSAT is captured by a follow-up message and stored in `messages.metadata.csat_score` (a column the metric-tree card will add).

**Why this is a metric and not just "did the customer stay."** SMB support teams do not have NPS infrastructure; building CSAT capture is on the metric-tree card. We are not promising to capture CSAT in v1 for *every* conversation, but the metric is defined here so the column and the capture path are part of v1's data model.

**Decision rule.** CSAT ≥ 4.0 average per tenant per month. Below 3.5 is a launch-blocker for the next design-partner cohort.

#### M4 — Cost per conversation ($/ticket)

**Definition.** Sum of `ai_decisions.tokens_used × price_per_token` (OpenRouter price table) plus provider fees (Twilio/Telnyx per-message, Postmark per-email) divided by the count of `conversations` rows with `status IN ('resolved', 'escalated')` for the same period.

**Why this is a metric and not just "do we make money."** This is the unit-economics sanity check. If $/ticket is above $0.30 at Growth-tier overage ($0.10), the unit economics are broken. The query lives in `docs/METRICS.md` (`LAUNCH_CHECKLIST.md` §4.3) and is computed weekly.

**Measurement event.** `ai_decisions` (`insforge/migrations/001_initial_schema.sql:219`) + `sms_delivery_events` + `email_delivery_events` (provider-billed side of the cost).

### 3.3 What we are not measuring (yet)

- **NPS.** SMB customers do not respond to NPS surveys reliably; CSAT is the right tool.
- **Agent-side metrics (handle time, occupancy).** Maya's employer cares about deflection and CSAT, not Maya's per-ticket handle time. We do not optimize for the wrong side of the desk.
- **Provider uptime.** Twilio/Postmark/OpenRouter have their own status pages. We measure *our* failure modes (rate of `failed` AI decisions, rate of `rejected_inbound` events) but not theirs.

---

## 4. MVP scope — 9 features, each anchored to a real file

The v1 surface is **9 features**, in priority order. Each feature is anchored to a real module/route/function in the repository. The reason for the 9-feature limit is not aesthetic: it is the boundary at which the design-partner program can credibly promise a stable product and the engineering team can credibly promise a launch date. Features beyond 9 are explicitly not v1 (see §5).

### F1. Multi-tenant auth and org membership

**User story.** As Jordan, I sign up, create an org, and invite Maya. Maya accepts and is bound to the same `organization_id`.

**Anchors.**
- Routes: `app/login/page.tsx`, `app/register/page.tsx`, `app/inbox/page.tsx` (gated by `middleware.ts`).
- Data: `organizations`, `organization_members` (`insforge/migrations/001_initial_schema.sql:16`, `:29`). Role enum: `owner` / `admin` / `agent` / `viewer` (per `SUPPORT_PLAYBOOK.md` §1 Q3).
- Auth: `insforge.auth.signUp`, `insforge.auth.signInWithPassword`, `insforge.auth.getCurrentUser` (per `AGENTS.md` §3).
- RLS: `insforge/migrations/003_rls_policies.sql` — every tenant-scoped table has a policy that filters by `organization_id IN (SELECT user_org_ids())`.

**Out of scope for v1.** OAuth (Google/GitHub) is deferred. SSO is deferred. Passwordless email is deferred. (All in §5.)

### F2. SMS and email channels with provider-neutral adapters

**User story.** As Jordan, I configure Twilio or Telnyx (SMS) and Postmark (email) in `app/settings/sms/page.tsx` and `app/settings/email/page.tsx`, and inbound messages start arriving in the inbox within 60 seconds.

**Anchors.**
- Adapters: `packages/support-core/src/adapters/twilio-sms-adapter.ts`, `telnyx-sms-adapter.ts`, `postmark-email-adapter.ts`, plus mock variants (`mock-sms-adapter.ts`, `mock-email-adapter.ts`) for local dev.
- Interfaces: `packages/support-core/src/interfaces/sms-provider-adapter.ts`, `email-provider-adapter.ts` — these are the seam that prevents provider lock-in (see §6 R2).
- Entrypoints: `insforge/functions/sms-inbound/index.ts`, `sms-status/index.ts`, `email-inbound/index.ts`, `email-status/index.ts`. The inbound entrypoints handle dedupe via `(provider, externalMessageId)` (`inbound-message-service.ts:114-118`).
- Credentials: stored as a `credentials_secret_id` UUID pointer on `sms_provider_accounts` (`insforge/migrations/001_initial_schema.sql:112`) and `email_provider_accounts` (`:156`), never as plaintext. Rotation is governed by `docs/SECRET_ROTATION.md`.

**Out of scope for v1.** WhatsApp, in-app chat, web chat widget, voice (all in §5). Sendgrid / Mailgun / Resend / SES are not adapters in v1; Postmark + Twilio + Telnyx is the v1 set. (See §5.)

### F3. Inbox UI: conversation list, message thread, AI panel, reply composer

**User story.** As Maya, I open the inbox, see the escalated lane chip, open a conversation, see the AI's draft, edit it, and send. Every state — loading, error, escalated, AI thinking — is intentional, not a spinner and a red box.

**Anchors.**
- Page: `app/inbox/page.tsx` (the 2-column layout; left rail, right thread).
- Components: `components/inbox/ConversationList.tsx`, `MessageThread.tsx`, `AiDraftPanel.tsx`, `ReplyComposer.tsx`. The component list and state matrix are in `docs/design/inbox-states.md` §10.
- Realtime: `lib/use-realtime.ts` (currently a polling stub — see `QA_BUG_HUNT.md` MEDIUM-8; v1 ships the polling, real WebSocket is v1.1).
- Keyboard: shortcuts per `docs/design/inbox-states.md` §8 — J/K, R, Shift+R, Cmd+Enter, E, S, ?, 1-5.

**Critical known defects in scope.** The inbox ships with the following *known* defects documented in `QA_BUG_HUNT.md`. The acceptance criterion for F3 is "the *happy path* works; the following known defects are tracked in the launch checklist, not blockers for v1":
- MEDIUM-6 (refetch on every poll event, no debounce).
- MEDIUM-7 (no virtualization past 1000 conversations).
- MEDIUM-9 (auto-scroll on every message change).
- MEDIUM-10 (middleware checks cookie presence only).
- MEDIUM-11 (multi-org users get no switcher).
- MEDIUM-14 (no Cmd+Enter hint).

This is a deliberate, honest acceptance bar: the inbox works for the 80% case at <1000 conversations/org, and the defects are tracked. See `LAUNCH_CHECKLIST.md` §1.1 for the full evidence path.

### F4. Knowledge base: upload, chunk, embed, retrieve

**User story.** As Jordan, I drop a PDF or paste a markdown FAQ into `app/knowledge/page.tsx`, the system chunks and embeds it, and the AI starts citing the right document in its replies within 5 minutes.

**Anchors.**
- Service: `packages/support-core/src/services/knowledge-ingestion-service.ts` (chunk → embed → store, lines 21-110).
- Entrypoint: `insforge/functions/process-knowledge-document/index.ts` (the queued worker that runs the service).
- Data: `knowledge_documents` and `knowledge_chunks` (`insforge/migrations/001_initial_schema.sql:238`, `:256`).
- Retrieval: `knowledge_chunks.embedding` (pgvector) + `match_knowledge_chunks` RPC (`insforge/migrations/002_rpc_functions.sql`). Threshold default 0.7 (`AiAgentService` default).
- UX: the design spec at `docs/design/spec.md` (the "Linen" aesthetic, drop-zone hero, real status states) ships alongside the v1 page. The existing `app/knowledge/page.tsx` is a flat list; the new design is in `docs/design/index.html` and the child card `t_eng_knowledge_ingestion` owns the rebuild.

**Out of scope for v1.** URL import, scheduled re-fetch, version diffing, multi-language embeddings, hierarchical chunking (per `docs/deep-research-report.md` §"A retrieval-friendly ingestion model…" — these are v1.1/v2 features). PDF parsing is in scope only if the chunk-and-embed step can read the text; OCR is not in scope.

### F5. AI agent: draft, auto-reply, escalate

**User story.** As Jordan, I set `ai_mode = draft_only` on day 1 and let the AI draft replies for every conversation. After 2 weeks, I see the AI is at 85% confidence on our top-10 questions, so I flip to `auto_reply` with `confidence_threshold = 0.8`. The escalated lane catches the refunds, the profanity, the legal threats.

**Anchors.**
- Service: `packages/support-core/src/services/ai-agent-service.ts` (the orchestrator, 9 steps, line 58 onward).
- Decision parser: `packages/support-core/src/services/ai-decision-parser.ts` (parses the LLM's JSON response into an `AiDecision`).
- Entrypoint: `insforge/functions/process-ai-job/index.ts` (the queued worker).
- Data: `ai_decisions` (`insforge/migrations/001_initial_schema.sql:219`); `ai_settings` (`:200`).
- Default settings: `aiMode = 'draft_only'`, `confidenceThreshold = 0.75`, `model = 'openai/gpt-4o-mini'` (see `ai-agent-service.ts:36-43`).

**Critical known defects in scope.** The AI service ships with the following known defects from `QA_BUG_HUNT.md` and a deep read of `ai-agent-service.ts`:
- The `LowConfidenceRule` in `escalation-rules.ts:182-206` is a *post*-LLM rule, called from `ai-agent-service.ts:252-256`. The pre-LLM escalation pass at `ai-agent-service.ts:150-165` does *not* include the low-confidence check; this is intentional but worth flagging.
- `countConsecutiveFailures` (`ai-agent-service.ts:495-500`) is a stub returning 0 or 1 — it does not actually count. The `RepeatedFailureRule` will rarely trigger in v1. Tracked.
- The `send_outbound_message` job is enqueued from `ai-agent-service.ts:372-383` but the actual send is in `insforge/functions/send-reply/index.ts`. This split is intentional (the AI service is portable; the function entrypoint is the integration) but it means the AI's "I sent it" claim is one queue hop away from the actual send. The audit log mitigates this.

**Out of scope for v1.** Fine-tuning, custom model selection beyond the `OPENROUTER_MODEL` env var, per-tenant prompt management beyond `ai_settings.system_prompt` (a single text column), and structured-output modes beyond JSON.

### F6. Escalation engine — 8 deterministic rules

**User story.** As Jordan, the 8 rules catch "speak to a human", profanity, refunds, chargebacks, medical emergencies, security breaches, missing knowledge, repeated AI failures, and my custom keywords. None of these are LLM-evaluated; they are string-match and metadata checks before the LLM is called.

**Anchors.**
- Service: `packages/support-core/src/services/escalation-rules.ts` (the 8 rules + the `createDefaultEscalationEngine()` factory at line 256).
- Rule list: `HumanRequestRule` (line 45), `ProfanityAngerRule` (line 74), `SensitiveTopicRule` (line 113), `SafetyConcernRule` (line 140), `MissingKnowledgeRule` (line 157), `LowConfidenceRule` (line 182), `RepeatedFailureRule` (line 210), `KeywordRule` (line 230).
- Tests: `packages/support-core/__tests__/unit/escalation-engine.test.ts`, `__tests__/properties/escalation.prop.test.ts` (per `LAUNCH_CHECKLIST.md` §3.1).
- Integration test: `packages/support-core/__tests__/integration/ai-safety.test.ts` — **does not exist yet** (per `LAUNCH_CHECKLIST.md` §3.2 and `QA_BUG_HUNT.md` open gap #9). It is a v1 ship-blocker; the test must assert that `mockOpenRouter.chatCompletion` is *not* called when an escalation rule fires.

**The 8th rule (KeywordRule) is the only Scale-only feature.** Custom escalation keywords are gated on tier (see `PRICING.md` §3.4 and `LAUNCH_CHECKLIST.md` §3.1). Starter and Growth inherit the default 7 rules only.

### F7. Approve / regenerate / send — the agent's primary action loop

**User story.** As Maya, I read the AI's draft, edit it if needed, and click "Approve & send" (the verb is intentional — see `inbox-states.md` §5, "the button should remind the agent that sending is destructive"). If I don't like the draft, I hit Shift+R to regenerate; the previous draft is preserved as a version.

**Anchors.**
- Entrypoints: `insforge/functions/approve-ai-draft/index.ts`, `regenerate-ai-draft/index.ts`, `send-reply/index.ts`. The latter is also used for human-written replies.
- Audit: every approve/skip/generate/send writes an `audit_logs` row (`insforge/migrations/001_initial_schema.sql:299`).
- RBAC: `approve-ai-draft` requires `role IN ('owner', 'admin', 'agent')` (the Rbac service, `packages/support-core/src/services/rbac.ts`).

**Critical known defects in scope.** From `QA_BUG_HUNT.md` CRITICAL-2: the JWT-authenticated function entrypoints (`send-reply`, `approve-ai-draft`, `regenerate-ai-draft`, `escalate-conversation`, `resolve-conversation`, `reopen-conversation`) do *not* enforce that the JWT user is a member of the conversation's org. The service-role key bypasses RLS. This is a real cross-tenant write vulnerability. The fix is a `requireOrgMembership(userId, conversationId)` helper, called before mutation in all 7 entrypoints. This is a **v1 ship-blocker** — F7 cannot be marked done until the fix lands.

### F8. Conversation state machine — open, pending, escalated, resolved, reopen

**User story.** As Maya, I escalate a conversation (status = `escalated`), a teammate resolves it (status = `resolved`), and 3 days later the customer writes back, and I reopen it (status = `open`). The state machine has invariants and the UI respects them.

**Anchors.**
- Service: `packages/support-core/src/services/conversation-service.ts` (state transitions).
- Entrypoints: `insforge/functions/escalate-conversation/index.ts`, `resolve-conversation/index.ts`, `reopen-conversation/index.ts`.
- Tests: `packages/support-core/__tests__/properties/state-machine.prop.test.ts` (property-based; verifies the invariants). `__tests__/unit/conversation-service.test.ts` (example-based).
- Data: `conversations.status` enum (`'open'` | `'pending'` | `'escalated'` | `'resolved'`); `ai_state` enum (`'idle'` | `'thinking'` | `'drafted'` | `'auto_replied'` | `'needs_human'` | `'failed'`).

**Critical known defects in scope.** From `QA_BUG_HUNT.md` MEDIUM-3: `findOpenByContactAndChannel` only matches `status = 'open'`, so an inbound message to a `'pending'` conversation creates a duplicate. Tracked. MEDIUM-15: `escalate-conversation` does not check current status, so a `'resolved'` conversation can be escalated. Tracked. MEDIUM-16: `resolve-conversation` does not record `resolved_at` as a separate column. The metric-tree card may add this column.

### F9. Audit log, structured JSON logging, and the 3-tier pricing gates

**User story.** As Jordan, every AI decision, every approve/skip, every inbound/outbound, every settings change, every credential rotation is in `audit_logs`. As a Scale customer, I can export the last 90 days as CSV or JSON. As a designer of the system, I can grep one log line per request (request_id, org_id, function_name, ts, status, duration_ms) to debug at 2am.

**Anchors.**
- Table: `audit_logs` (`insforge/migrations/001_initial_schema.sql:299`).
- Append-only: enforced by RLS (`insforge/migrations/003_rls_policies.sql`); verification at `LAUNCH_CHECKLIST.md` §2.3.
- Structured logging: `LAUNCH_CHECKLIST.md` §4.1 (every `insforge/functions/**/index.ts` must log a JSON line on entry and exit; a `grep -L "console.log(JSON.stringify" insforge/functions/**/index.ts` returns no results).
- Pricing gates: `organization_subscriptions` table (per `PRICING.md` §3.1 — schema drafted, child build card owns the actual migration). Three tiers (`starter` / `growth` / `scale`), enforced at the service layer (see `PRICING.md` §3.3 for the "why not a trigger" reasoning).
- Export (Scale only): not yet built; the function entrypoint `GET /functions/v1/export-audit-log` is implied by `PRICING.md` §2.3 and is a v1 ship-blocker for the Scale tier's value prop.

**Critical known defects in scope.** From `QA_BUG_HUNT.md` MEDIUM-18: `audit_logs` insert is best-effort in many services; failures are silently swallowed. This is a v1 ship-blocker for F9 — if the audit log is the source of truth for "did the AI send it," a silent failure means we cannot reconstruct the truth.

### 4.1 The 9 features in order of dependency

```
F1 (auth) ─┐
            ├─► F2 (channels) ─┐
            │                   ├─► F3 (inbox) ─► F7 (approve/regen/send)
            │                   │                       │
            │                   │                       ├─► F8 (state machine)
            │                   │                       │
            │                   ├─► F4 (KB) ────────────┤
            │                   │                       │
            │                   └─► F5 (AI) ──► F6 (escalation) ─┘
            │                                                   │
            └────────────────────────────────────────────────► F9 (audit + pricing)
```

F9 depends on F5/F7 writing to `audit_logs`; the F1→F2→F3/F4/F5 spine must be solid before F7 is meaningful.

---

## 5. Out of scope (explicit)

Every item in this list has had at least one person ask for it. The discipline of *naming* the "no" is the test of a PRD that actually scopes. Each item says where it goes: **v1.1** (next minor, shipped in 90 days), **v2** (the next major), or **never** (architecturally opposed to our model).

| Feature | Where it goes | Why not v1 |
|---|---|---|
| **Voice / phone calls** | v2 | The whole channel gateway is built around text normalization (`inbound-message-service.ts` step 2: normalize phone/email). Voice requires an entirely different idempotency model (audio chunks, transcripts, partial results) and a different escalation path. The deep-research report treats voice as a separate channel program, not a v1 feature. |
| **Multi-language beyond English** | v2 | All escalation rules, the system prompt, the knowledge chunker, and the AI's structured output are English. Adding a second language is a *data* problem (escalation phrases, KB coverage) more than a *code* problem; the code is already passable. The bet: v1 design partners operate in English-speaking markets. |
| **Custom AI model fine-tuning** | never | A per-tenant fine-tune is a multi-month effort and requires a labeled dataset we don't have. The current `OPENROUTER_MODEL` env var allows the *operator* to swap the model for all tenants; per-tenant model selection is a v2 product. The `ai_settings.system_prompt` column is the per-tenant knob in v1. |
| **White-label** | v2 | White-label is a multi-tenant *branding* problem (CNAME, custom email From, custom login page). The current schema has no `organization_branding` table and no theme tokens per tenant. A v1 white-label would be a demo, not a product. |
| **Multi-brand per org** | v2 | One org = one brand in v1. Multi-brand is a routing problem (which `to:` address goes to which brand) and a billing problem (one Stripe customer per org, vs per brand). The PRICING.md tier model assumes one brand per org. |
| **SSO (SAML / OIDC)** | v2 | InsForge Auth supports email+password in v1 (per `AGENTS.md` §3). Adding SSO requires a JWT trust setup (`insforge-debug` skill territory) and is enterprise procurement-driven, not SMB-driven. |
| **In-app web chat widget** | v1.1 | Adding a website widget is a thin extension (it's another channel, like SMS/email, with the same idempotency model). It is v1.1 because the design-partner program does not need it in beta, but the channel gateway's design accommodates it. |
| **WhatsApp** | v1.1 | Same as web chat — it's a channel addition. v1.1 because no v1 design partner is asking for it. |
| **Sendgrid / Mailgun / Resend / SES** (additional email providers) | v1.1 | The adapter interface (`packages/support-core/src/interfaces/email-provider-adapter.ts`) supports it; Postmark is the v1 set. Adding more providers in v1.1 once we have a real second-customer ask. |
| **Bandwidth / Vonage / Plivo / Messagebird** (additional SMS providers) | v1.1 | Same. Twilio + Telnyx is the v1 set; the adapter interface supports additions. |
| **Sentiment / CSAT auto-detection** | v2 | The LLM can already produce a sentiment tag in its structured output; we don't expose it. A real CSAT score is a labeled-data problem (see §3.2 M3). |
| **Proactive outbound campaigns** | v2 (post-v1) | Outbound sequences are a different product (Postscript, Klaviyo). We are reactive support, not marketing automation. |
| **CRM / Linear / Salesforce integrations** | v1.1 (per design-partner demand) | Per `PRICING.md` §6.1 Q1, the open question is whether "auto-reply" or "CRM export" is the real Growth-tier hook. Webhooks per design partner are v1.1. |
| **Voice-of-customer / NPS / cohort analytics** | v2 | The `analytics` page (`app/analytics/page.tsx`) is a basic v1 dashboard (deflection, FRT, volume). Cohort analytics and VoC are a data-pipeline project. |
| **Agent-side metrics (handle time, occupancy, QA scorecards)** | v2 | The PRD measures *customer* outcomes (M0-M4), not *agent* outcomes. Adding agent metrics is a separate product surface and a separate buyer (the support lead, not the customer). |

The list is not "we ran out of time." Every item is a deliberate deferral with a defined next-step home.

---

## 6. Risks

The PRD names **6 risks**, three of which are grounded in specific known defects in the code (cited with file:line). Each risk has a *named mitigation* and an *owner* from the launch checklist sign-off block.

### R1 — AI hallucination cost (P0 risk, blocks §3.3 M0 containment)

**The risk.** The LLM, given a thin knowledge base and a confidence threshold of 0.75, sends a reply that is factually wrong. The customer acts on it (a wrong shipping date, a wrong refund amount, a wrong legal disclaimer). The customer's trust evaporates and they churn.

**Why this risk is concrete, not theoretical.** The 8-rule escalation engine (`packages/support-core/src/services/escalation-rules.ts`) catches the known-bad categories (refund, chargeback, legal, profanity, medical, security) by string-match. The "low confidence" gate (`ai-agent-service.ts:354`: `if (parsed.confidence >= confidenceThreshold && !parsed.requiresHuman)`) catches the LLM's own uncertainty. But the gate is per-tenant (`ai_settings.confidence_threshold`), and a customer who sets the threshold to 0.5 to "let the AI handle more" is choosing to accept a higher hallucination rate in exchange for deflection.

**Mitigations.**
- The 8-rule escalation engine is evaluated *before* the LLM call (`ai-agent-service.ts:150-165`), not after. A message containing "refund" never reaches the LLM.
- `ai_settings.knowledge_similarity_threshold = 0.7` means the AI only cites a knowledge chunk when the embedding match is above 0.7; below that, the `MissingKnowledgeRule` fires (`escalation-rules.ts:157-170`) and the conversation is escalated.
- The `ai_settings.per_reply_token_cap` (per `LAUNCH_CHECKLIST.md` §3.5) caps the LLM's response length and thus the per-reply cost and verbosity. The unit test in `LAUNCH_CHECKLIST.md` §3.5 must assert the cap is enforced.
- Default `ai_mode = 'draft_only'` on a new tenant. The Starter tier *cannot* be `auto_reply` (see `PRICING.md` §2.1). The customer's first 50 conversations are human-in-the-loop, period.
- The audit log captures the LLM's raw response, the parsed decision, and the confidence. A post-hoc "did the AI hallucinate" review is a SQL query on `ai_decisions.raw_response` + `messages.body`.

**Owner.** ENG-LEAD. **Verifiable evidence.** `LAUNCH_CHECKLIST.md` §3.1, §3.2, §3.5.

### R2 — Single-vendor provider lock-in (P0 risk, blocks §4 F2)

**The risk.** Twilio becomes uneconomical, or Postmark is acquired, or Twilio's webhook format changes. Migrating off a hard-coded provider is a multi-week rewrite of every webhook entrypoint.

**Why this risk is concrete.** The bug-hunt report flags related issues: `QA_BUG_HUNT.md` CRITICAL-1 (mock adapters unconditionally `return true` from `verifyWebhook`, but the real adapters' signature validation is the only thing standing between an attacker and webhook injection) and MEDIUM-1 (Twilio `findByPhone` accepts a number that is not E.164-normalized, suggesting the normalization seam has gaps). The risk is that a *real* outage on the SMS/email provider hits the design-partner cohort in week 1 of beta, and the migration is a fire drill.

**Mitigations.**
- The provider-neutral adapter interface: `packages/support-core/src/interfaces/sms-provider-adapter.ts`, `email-provider-adapter.ts`. Every provider is a class implementing this interface; switching providers is a registration change, not a code change.
- The current v1 set is 2 SMS providers (Twilio, Telnyx) and 1 email provider (Postmark), with mock adapters for local dev. The interface supports more.
- The `support-core` package has *no* imports of `@insforge/sdk` (per `AGENTS.md` §1) and *no* imports of any provider SDK in the service layer — only in the adapter implementations. The service layer is the migration seam; if we move off InsForge, the adapters and the function entrypoints are the only files that need to change.
- Provider credentials are stored as a `credentials_secret_id` UUID pointer, not as plaintext. The rotation runbook (`docs/SECRET_ROTATION.md`) is provider-agnostic and covers Twilio, Postmark, and OpenRouter.

**Owner.** ENG-LEAD + DEVOPS. **Verifiable evidence.** `grep -r "@insforge/sdk" packages/support-core/src/` returns no results. `ls packages/support-core/src/adapters/` shows ≥ 2 SMS and ≥ 1 email provider.

### R3 — RLS bypass risk (P0 risk, blocks §4 F7 and §3.3 M0)

**The risk.** A query path bypasses the row-level security policies and lets a user in org A read or write org B's data. A "small" bypass is a CSV download; a "big" bypass is a credit card number in a `messages` row.

**Why this risk is concrete — and grounded in a real defect.** `QA_BUG_HUNT.md` CRITICAL-2 is a real, reproducible, **file:line**-cited RLS bypass:

> `insforge/functions/send-reply/index.ts:78-112` (also `approve-ai-draft`, `regenerate-ai-draft`, `escalate-conversation`, `resolve-conversation`, `reopen-conversation`): All 7 JWT-protected function entrypoints load the conversation by `conversationId` from the **request body** with no org filter, then update it with the **service-role-key-backed `DatabaseClient`**. Because the service-role key bypasses RLS, no defense-in-depth catches the cross-tenant write. Any user in any tenant can call `send-reply` with `conversationId: <other-tenant-conversation-uuid>`.

This is not a hypothetical. It is in the code. The fix is a `requireOrgMembership(userId, conversationId)` helper called before mutation. The 7 call sites are listed in the bug-hunt report.

**A second, related known defect:** `QA_BUG_HUNT.md` CRITICAL-3 — the inbound webhook entrypoints accept `x-organization-id` from caller headers. Caller-controlled org attribution is a tenant-isolation break.

**A third, related known defect:** `packages/support-core/__tests__/integration/rls-policies.test.ts` is **9 lines of `it.todo`** — the integration suite that is supposed to prove two-org isolation is *not implemented*. Per `QA_BUG_HUNT.md`: 6 integration suites are all `.skip()`-equivalent and ship as never-run; the RLS suite is one of them.

**Mitigations.**
- The fix to CRITICAL-2 (7 call sites) is a v1 ship-blocker. The `requireOrgMembership` helper is built first; every call site adopts it. The audit log records the cross-tenant attempt as a 403, so we can detect attempted bypasses.
- The fix to CRITICAL-3 (remove the `x-organization-id` branch from `sms-inbound` and `email-inbound`) is XS-effort (3 lines per entrypoint). v1 ship-blocker.
- The RLS integration test (`rls-policies.test.ts`) gets implemented for real in v1 — not as `it.todo` stubs, but as a real two-org probe that asserts SELECT/INSERT/UPDATE/DELETE isolation. Per `LAUNCH_CHECKLIST.md` §2.1, this is a go/no-go criterion.

**Owner.** QA + ENG-SEC. **Verifiable evidence.** `LAUNCH_CHECKLIST.md` §2.1, §2.2, §2.3. The evidence path is a `psql` session with two real org JWTs and a `docs/evidence/tenant-isolation-probe.txt` log.

### R4 — Cost amplification via unauthenticated internal endpoints (P1 risk, blocks §4 F5)

**The risk.** The `process-knowledge-document`, `process-ai-job`, and `process-jobs` function entrypoints are unauthenticated. An attacker who learns the function URL can force the system to re-embed documents or run AI jobs, multiplying OpenRouter spend.

**Why this risk is concrete.** `QA_BUG_HUNT.md` CRITICAL-4:

> None of these entrypoints call `verifyJwt`, do not check an `x-internal-token` header, and accept any `documentId` / `conversationId` in the request body. Anyone with the function URL can: `process-knowledge-document` — trigger re-embedding of any document, multiplying AI costs; `process-ai-job` — force AI analysis of any conversation, multiplying AI costs; `process-jobs` — claim up to 10 jobs and run them (consuming AI tokens).

**Mitigations.**
- Require a shared secret in `x-internal-token`, compared against `Deno.env.get('INTERNAL_DISPATCH_TOKEN')`. Reject if missing.
- Make the token long and rotated. The rotation pattern follows `docs/SECRET_ROTATION.md`.
- Add per-tenant rate limits to the AI service (in `ai-agent-service.ts` and the inbound flow). This is partly covered by the pricing quota (see R5) but the unauthenticated path bypasses the quota — the `INTERNAL_DISPATCH_TOKEN` is the actual fix.

**Owner.** ENG-LEAD + ENG-SEC. **Verifiable evidence.** `curl` repro from `QA_BUG_HUNT.md` CRITICAL-4 returns 401 after the fix.

### R5 — Cost overruns at the conversation quota (P1 risk, blocks §3.3 M4 $/ticket)

**The risk.** A tenant's usage spikes (a marketing email goes out, a thousand inbound messages arrive in an hour). OpenRouter + Twilio + Postmark spend goes through the quota. The pricing tier's overage rate (or hard stop, for Starter) needs to fire before the invoice is generated.

**Why this risk is concrete.** The pricing model in `PRICING.md` §3.2 inserts a *new* step 1.5 into `inbound-message-service.ts` — a quota check before the duplicate check, before the message insert. As of v1.0, the service does *not* have this check (the 9-step flow at the top of `inbound-message-service.ts` does not include a quota step). The `organization_subscriptions` table does *not* exist (the migration is sketched in `PRICING.md` §3.1 but the file `insforge/migrations/004_organization_subscriptions.sql` is not yet on disk).

**Mitigations.**
- Build the `organization_subscriptions` table and the new step 1.5 in `inbound-message-service.ts` before opening beta.
- The enforcement is in the service layer, not in an RLS trigger, for three documented reasons (`PRICING.md` §3.3): (1) a trigger fires on outbound retries, (2) a trigger can't lazily create a subscription row without a service-role key, (3) a trigger error becomes a 500, not a typed `QuotaExceededError` with a 402-style response the webhook provider can retry.
- The cost ceiling is also per-reply: `ai_settings.per_reply_token_cap` (per `LAUNCH_CHECKLIST.md` §3.5). Even if a tenant has quota, an LLM that goes off the rails on a single reply cannot cost more than the cap.

**Owner.** ENG-LEAD + DEVOPS. **Verifiable evidence.** The 9-step inbound flow grows to 10 steps (with quota at 1.5); `organization_subscriptions` exists; `inbound_rejected_quota` rows appear in `audit_logs` when a Starter tenant exceeds 50 conversations.

### R6 — Webhook signature bypass via mock adapter in production (P0 risk, blocks §4 F2)

**The risk.** The mock SMS and email adapters unconditionally return `true` from `verifyWebhook`. The function entrypoints (`sms-inbound`, `sms-status`, `email-inbound`, `email-status`) always register the mock adapter and default `provider` to `'mock'` when the `x-provider` header is missing or `'mock'`. In production, an attacker can hit the webhook with `x-provider: mock` and inject a fake inbound message into *any* org whose `to:` address they can guess.

**Why this risk is concrete.** `QA_BUG_HUNT.md` CRITICAL-1, with a working `curl` repro that creates a conversation in a victim org. The severity rationale is explicit: "Complete webhook auth bypass. Any anonymous caller can inject a fake 'delivery confirmation' via `/sms-status` or `/email-status`... inject a fake inbound email... spend AI tokens by injecting 10k fake inbound messages."

**Mitigations.**
- Refuse `x-provider: mock` in production env: in each webhook entrypoint, throw `400 { error: 'Mock provider disabled in production' }` when `Deno.env.get('ENV') === 'production' && provider === 'mock'`.
- Better: gate mock provider behind a build-time flag and short-circuit at adapter registration if production.
- This is XS-effort (a 2-line guard per entrypoint + removing the always-register-mock pattern). v1 ship-blocker.

**Owner.** ENG-SEC. **Verifiable evidence.** `QA_BUG_HUNT.md` CRITICAL-1 repro returns 400 in production env.

### 6.1 Risks we are *not* calling out (and why)

- **OpenRouter vendor lock-in.** A real risk in principle, but mitigated by the model-swap env var and the adapter-equivalent `ai_settings.model` column. The OpenRouter abstraction layer means we can move to a different hosted-LLM provider (or self-hosted) without rewriting `ai-agent-service.ts`.
- **Database vendor lock-in.** We use Postgres + pgvector. The schema is portable. The risk is migrating off InsForge itself, which is the *whole point* of the support-core portability rule (`AGENTS.md` §1).
- **Support volume spike on InboxPilot itself.** `docs/SUPPORT_PLAYBOOK.md` is the answer. Tier 1 → 3 escalation is defined; the Tier-2/3 contact inboxes are in §3. The founders are Tier 1 in v1.

---

## 7. Pricing & packaging hypothesis

This section is a one-paragraph pointer. The full hypothesis lives in `docs/PRICING.md`. The PRD defers to it because the design is a multi-page document with 4 open questions that need design-partner data, not a 1-page summary. The summary:

| | Starter | Growth | Scale |
|---|---|---|---|
| **Price (placeholder)** | $0 | $99/mo | $499/mo |
| **Conversations / mo** | 50 (hard stop) | 1,000 (then $0.10 each) | 10,000 (then $0.05 each) |
| **Channels** | SMS *or* email | SMS *and* email | SMS *and* email |
| **Seats** | 1 | 5 | unlimited |
| **KB docs** | 5 | 50 | unlimited |
| **AI auto-reply** | off (draft-only) | on (above threshold) | on (above threshold) |
| **Custom escalation keywords** | ❌ | ❌ | ✅ |
| **Audit log export** | ❌ | ❌ | ✅ (90 days) |

Every boundary in the table resolves to one of: a row in `organization_subscriptions`, a flag in `ai_settings`, a count in `organization_members`, or a count in `knowledge_documents`. This is the test that a boundary is "real" and not marketing fluff. The full schema, the `inbound-message-service.ts` quota enforcement touchpoint, the design-partner profiles, and the 4 open questions (Q1: is auto-reply the right Growth hook? Q2: is $99 the right Growth price? Q3: is 50 the right Starter quota? Q4: what does "audit log export" mean?) are in `PRICING.md`. The launch checklist's go-to-market section (`LAUNCH_CHECKLIST.md` §7) is the parent of the pricing page.

---

## 8. Cross-references and child cards

### 8.1 Documents this PRD is consistent with (or supersedes)

- `docs/ARCHITECTURE.md` — the system architecture matches the 9-feature scope.
- `docs/DATABASE.md` — the 17 tables map to the 9 features; the proposed 18th (`organization_subscriptions`) is in `PRICING.md` §3.1.
- `docs/API.md` — 14 function entrypoints, all anchored in §4.
- `docs/TESTING.md` — the test strategy (unit + property + integration) is the v1 acceptance shape.
- `docs/DEVELOPMENT.md` — the local setup, conventions, and "Critical Rules" match the 9-feature scope.
- `docs/PRICING.md` — the 3-tier hypothesis. The PRD §7 defers to this doc.
- `docs/LAUNCH_CHECKLIST.md` — the 8-section go/no-go. Every §6 risk above maps to a launch-checklist criterion.
- `docs/SUPPORT_PLAYBOOK.md` — the Tier-1 support posture (founders are Tier 1 in v1).
- `docs/SECRET_ROTATION.md` — the rotation runbook for the credentials in §4 F2.
- `docs/QA_BUG_HUNT.md` — the static-analysis findings; §6 risks R3, R4, R6 are direct citations of CRITICAL-1/2/3/4.
- `docs/design/inbox-states.md` and `docs/design/spec.md` — the UX designs that the §4 features implement.
- `legal/DPA.md` and `legal/AUP.md` — the data classes and acceptable use; the §1 problem statement is constrained by these.

### 8.2 Documents this PRD is *not* a substitute for

- `docs/METRICS.md` (not yet written; `t_ops_runbook` is the parent card). §3 commits to the *events*; the metric-tree card writes the SQL.
- `docs/INCIDENT_RESPONSE.md` (not yet written; `t_sec_incident_response` is the parent card). §6 R1 references the runbook but does not write it.
- `docs/SECURITY_MODEL.md` (not yet written; `t_sec_security_model` is the parent card). §6 R3 references it.
- `docs/USER_STORIES.md` (not yet written as a standalone doc; `t_pm_user_stories` is the parent card). The §4 features will be expanded into user stories with P0/P1/P2 tags.
- `docs/README_INDEX.md` (not yet written; the README is the index, and it links to this PRD after the §9 change lands).

### 8.3 Child cards this PRD parents

- `t_eng_auth` — implements §4 F1.
- `t_eng_inbox_ui` — implements §4 F3.
- `t_eng_knowledge_ingestion` — implements §4 F4.
- `t_eng_settings_ai` — implements §4 F5 surface.
- `t_pm_metric_tree` — implements §3 metric queries in `docs/METRICS.md`.
- `t_pm_user_stories` — expands §4 into `docs/USER_STORIES.md`.

### 8.4 Sibling cards (this PRD is a peer, not a parent)

- `t_pm_pricing_packaging` → `docs/PRICING.md`. PRD §7 defers.
- `t_pm_launch_checklist` → `docs/LAUNCH_CHECKLIST.md`. PRD §6 risks map to checklist sections.
- `t_qa_bug_hunt` → `docs/QA_BUG_HUNT.md`. PRD §6 R3/R4/R6 cite this directly.
- `t_ops_support_handoff` → `docs/SUPPORT_PLAYBOOK.md`. PRD §2 personas reference the role matrix here.
- `t_devops_secret_rotation` → `docs/SECRET_ROTATION.md`. PRD §4 F2 references the runbook.
- `t_sec_dpa_aup` → `legal/`. PRD §1 problem statement is bounded by the data classes here.

---

## 9. Acceptance criteria (re-stated from the card)

This PRD is *done* when:

- [x] `docs/PRD.md` exists at this path. *(This file.)*
- [x] All 7 sections present with the contents described in the card body.
- [x] MVP scope list is 9 items, each anchored to a real file path. *(§4 F1-F9.)*
- [x] At least one risk is grounded in a specific known limitation in the code. *(§6 R3, R4, R6 each cite `docs/QA_BUG_HUNT.md` with file:line.)*
- [ ] `README.md` links to `docs/PRD.md` in the Documentation section. *(See the README patch that follows this PRD.)*
