# InboxPilot — v1 User Stories

> **Status:** v1, source of truth for "what we build, who it's for, what done looks like."
> **Last updated:** 2026-06-07
> **Pair with:** `docs/PRD.md` §4 (the 9-feature MVP scope) · `docs/design/inbox-states.md` (the UX states) · `docs/METRICS.md` (the metric queries) · `docs/PRICING.md` (the tier gates)
> **Kanban:** `t_pm_user_stories` (this card) · parent of: `t_design_onboarding`, `t_eng_analytics_dashboard`, `t_eng_inbox_ui`, `t_eng_knowledge_ingestion`, `t_eng_settings_ai`, `t_eng_settings_channels`. Every child engineering card should reference a story ID.

## How to read this document

This file is the *contract* between PM and engineering. It expands the 9 features in `PRD.md` §4 into **7 user stories**, one per primary job-to-be-done. Each story has the standard As-a / I-want-to / So-that shape, three or more Given/When/Then acceptance criteria, a "Files touched" list anchored to real paths in this repo, a "Depends on" list pointing at sibling stories and child cards, and an "Out of scope" line that names one or two things deliberately deferred.

**Two discipline rules.** First, every "Files touched" path is one I have verified exists in the repository as of this commit — if a story cites a file, that file is on disk. Second, every "Depends on" sibling is a card on the board I can name; the cross-references are navigation, not aspiration. Story IDs (`US-N`) are stable; the engineering tasks that implement them reference back.

**One thing this file is not.** It is not a sprint plan. It does not estimate effort, sequence work, or assign owners beyond pointing at the child engineering card. The launch checklist (`docs/LAUNCH_CHECKLIST.md`) is the sequencing; this is the contract.

**Story map to PRD §4 features:**

| Story | PRD feature | Child card |
|---|---|---|
| US-1: Inbound SMS auto-triage | F3 + F5 + F6 + F7 | `t_eng_inbox_ui` |
| US-2: Escalation handoff | F3 + F6 + F8 | `t_eng_inbox_ui` |
| US-3: Knowledge base ingestion | F4 | `t_eng_knowledge_ingestion` |
| US-4: Channel test connection | F2 | `t_eng_settings_channels` |
| US-5: Auto-reply threshold tuning | F5 | `t_eng_settings_ai` |
| US-6: Audit log export | F9 | `t_eng_analytics_dashboard` (read surface) |
| US-7: Multi-tenant isolation | F1 (constraint) | `t_eng_auth` (implementation), tested in `t_qa_isolation_probe` |

US-1, US-2, US-3, US-4, US-5 are P0 for the design-partner beta. US-6 is P0 only on the Scale tier (see `PRICING.md` §2.3). US-7 is a *cross-cutting constraint* — every story above is also a US-7 instance, so the acceptance criteria live separately and the child engineering work is the `requireOrgMembership` helper landing in all 7 JWT-protected function entrypoints (`QA_BUG_HUNT.md` CRITICAL-2).

---

## US-1 — Inbound SMS auto-triage

**As a** support agent (Maya, the primary persona in `PRD.md` §2.1),
**I want** every incoming SMS to land in the inbox with a pre-drafted AI reply and a confidence score attached,
**so that** I can review-and-send in 2 clicks instead of typing a reply from scratch, and keep my first-response-time under 30 seconds.

### Acceptance criteria

- **AC-1.1 — First-draft presence.** Given an inbound SMS arrives at `insforge/functions/sms-inbound/index.ts` and the org's `ai_mode = 'draft_only'`, when the queued worker at `insforge/functions/process-ai-job/index.ts` finishes running `packages/support-core/src/services/ai-agent-service.ts`, then a row is appended to `messages` with `sender_type = 'ai_agent'` and `metadata.draft = true`, and the conversation appears in the Inbox with the AI panel populated and a confidence chip in one of the three documented color tiers (forest / ochre / terra, per `docs/design/inbox-states.md` §5).
- **AC-1.2 — Approve-and-send in 2 clicks.** Given the AI has drafted a reply, when the agent clicks "Approve & send" (or hits Cmd+Enter, per `inbox-states.md` §8), then exactly two interactions (open the conversation, click send) result in `insforge/functions/send-reply/index.ts` being called and the message being dispatched via the active SMS provider, and a `audit_logs` row with `action = 'send_reply'` is written (per `insforge/migrations/001_initial_schema.sql:299`).
- **AC-1.3 — Pre-LLM escalation gate.** Given an inbound SMS containing the substring "refund" or "speak to a human" or "chargeback", when the inbound flow runs the pre-LLM escalation pass at `ai-agent-service.ts:150-165`, then `mockOpenRouter.chatCompletion` is *never* called and the conversation is created with `ai_state = 'needs_human'` and `conversations.status = 'escalated'`, so the AI does not waste a token round-trip on a known-bad category. This is asserted by the integration test `packages/support-core/__tests__/integration/ai-safety.test.ts` (not yet written; per `PRD.md` §4 F6 "Critical known defects in scope" and `LAUNCH_CHECKLIST.md` §3.2 — **v1 ship-blocker**).
- **AC-1.4 — Dedupe on retry.** Given the same Twilio `MessageSid` is delivered twice within 60 seconds, when the second webhook hits `sms-inbound/index.ts`, then the dedupe check at `packages/support-core/src/services/inbound-message-service.ts:114-118` rejects the second insert (returns 200 with `deduped: true` in the response body) and no duplicate `messages` row is created.

### Files touched

- `insforge/functions/sms-inbound/index.ts` (entrypoint; existing)
- `insforge/functions/process-ai-job/index.ts` (queued worker; existing)
- `insforge/functions/send-reply/index.ts` (existing)
- `insforge/functions/approve-ai-draft/index.ts` (existing)
- `packages/support-core/src/services/ai-agent-service.ts` (existing; the 9-step orchestrator)
- `packages/support-core/src/services/inbound-message-service.ts` (existing; the dedupe seam)
- `packages/support-core/src/services/escalation-rules.ts` (existing; 8-rule engine)
- `components/inbox/ConversationList.tsx` (existing; new state per `t_eng_inbox_ui`)
- `components/inbox/AiDraftPanel.tsx` (existing; confidence chip surface)
- `components/inbox/ReplyComposer.tsx` (existing; approve & send button)
- `app/inbox/page.tsx` (existing; gates the whole flow)

### Depends on

- US-4 (channel must be configured and tested before SMS reaches `sms-inbound`).
- US-7 (cross-tenant isolation on every JWT-protected write in this story).
- Story child card: `t_eng_inbox_ui`. Sibling stories: US-2 (the escalated-lane view of the same conversation), US-5 (the `ai_mode` setting that controls whether draft is the only behaviour).

### Out of scope

- Proactive outbound SMS sequences (deferred to v2, per `PRD.md` §5).
- WhatsApp / in-app web chat widget / voice (channels deferred; `PRD.md` §5).
- "Sentiment auto-detection" on inbound messages (v2; `PRD.md` §5).

---

## US-2 — Escalation handoff

**As a** support lead (Jordan, the secondary persona in `PRD.md` §2.2),
**I want** any conversation that triggers an escalation rule to immediately show up in an "Escalated" lane with the rule that fired,
**so that** I can audit and override AI decisions, and my agents do not lose a high-risk customer behind a 200-message backlog.

### Acceptance criteria

- **AC-2.1 — Rule attribution on the conversation row.** Given any of the 8 escalation rules in `packages/support-core/src/services/escalation-rules.ts` (HumanRequest, ProfanityAnger, SensitiveTopic, SafetyConcern, MissingKnowledge, LowConfidence, RepeatedFailure, Keyword) fires, when the rule evaluation completes, then the conversation row is updated with `conversations.status = 'escalated'`, `conversations.escalated_at = now()`, and `conversations.metadata.escalation_rule = '<rule_name>'`, and a `audit_logs` row with `action = 'escalate'` and `metadata.rule = '<rule_name>'` is written.
- **AC-2.2 — Escalated lane chip, not a column.** Given a conversation is escalated, when an agent opens `app/inbox/page.tsx`, then the "Escalated" filter chip in `components/inbox/ConversationList.tsx` shows the count and the conversations in that filter are sorted by `escalated_at DESC` (oldest escalations on top, because old escalations are the highest risk), and the chip is reachable in one click from the default "All" view (per `docs/design/inbox-states.md` §3; chip-not-column is the explicit design decision).
- **AC-2.3 — SLA timer in the conversation item.** Given a conversation is escalated, when the conversation is rendered in the list, then an SLA countdown is shown in monospace, switching to terra colour when the elapsed time is over 15 minutes (per `inbox-states.md` §3 and `PRD.md` §2.2). The timer updates on the same 30-second poll cadence as the rest of the inbox.
- **AC-2.4 — Override is one click.** Given a conversation is escalated, when an agent clicks "Take over" on the conversation item, then `insforge/functions/escalate-conversation/index.ts` is *not* called (the conversation is already escalated); instead, the agent is taken into the conversation thread with the composer focused, the AI draft is hidden, and a `audit_logs` row with `action = 'agent_takeover'` is written. (The audit shape is the schema, not the action verb — the point is the takeover is auditable.)
- **AC-2.5 — KeywordRule is Scale-only.** Given a tenant on the Starter or Growth tier, when they attempt to set `ai_settings.escalation_keywords`, then the service rejects the write with a typed `FeatureGatedError` and the UI at `app/settings/ai/page.tsx` does not render the keyword list input. (Per `PRICING.md` §3.4 and `LAUNCH_CHECKLIST.md` §3.1; this is the only one of the 8 rules that is tier-gated.)

### Files touched

- `packages/support-core/src/services/escalation-rules.ts` (existing; 8 rules + `createDefaultEscalationEngine()`)
- `insforge/functions/escalate-conversation/index.ts` (existing; entrypoint)
- `components/inbox/ConversationList.tsx` (existing; the chip, the sort, the SLA timer)
- `components/inbox/ConversationItem.tsx` (existing; per-row rule badge)
- `app/inbox/page.tsx` (existing; the page that hosts the chip)
- `app/settings/ai/page.tsx` (existing; the keyword-list gate)

### Depends on

- US-1 (the inbound flow that creates the conversation and fires the rule).
- US-7 (the `requireOrgMembership` helper on the `escalate-conversation` entrypoint is a v1 ship-blocker per `QA_BUG_HUNT.md` CRITICAL-2).
- Story child card: `t_eng_inbox_ui`. Sibling story: US-1 (creates the conversation), US-5 (the `confidence_threshold` and `escalation_keywords` settings that drive rule firing).

### Out of scope

- Custom rule builder UI beyond a flat keyword list (the 7 built-in rules are not user-editable in v1; the `KeywordRule` accepts an array of strings only).
- Multi-channel escalation routing (e.g. SMS the on-call lead when an escalation fires) — the escalation lands in the inbox, period.
- Auto-reassignment of escalated conversations to specific agents or teams.

---

## US-3 — Knowledge base ingestion

**As an** owner (Jordan, the secondary persona),
**I want** to upload a PDF or paste a markdown FAQ and have the AI start referencing it in replies within minutes,
**so that** answers stay in sync with our actual policies and I do not have to maintain a separate document that drifts from what the customer gets.

### Acceptance criteria

- **AC-3.1 — Upload to a status visible in the UI.** Given a tenant owner uploads a PDF or markdown file at `app/knowledge/page.tsx`, when the file is stored, then a row is inserted into `knowledge_documents` (`insforge/migrations/001_initial_schema.sql:238`) with `status = 'processing'`, and the document appears in the knowledge page list with a visible processing state (not a spinner-only state — per the design spec at `docs/design/spec.md`, the "Linen" drop-zone aesthetic with a real status surface, not a generic progress bar). The status transitions to `ready` or `failed` when the queued worker at `insforge/functions/process-knowledge-document/index.ts` finishes.
- **AC-3.2 — Chunk + embed within the SLA.** Given a document of ≤ 50 pages or ≤ 200 KB of markdown, when the queued worker runs `packages/support-core/src/services/knowledge-ingestion-service.ts:21-110`, then chunking + embedding (via OpenRouter's embedding model through the AI gateway) finishes in under 5 minutes for the 90th percentile, and the resulting chunks are inserted into `knowledge_chunks` (`001_initial_schema.sql:256`) with a populated `embedding` (pgvector, 1536-dim).
- **AC-3.3 — Retrieval uses the new doc in the next reply.** Given a `ready` document is in `knowledge_chunks`, when a subsequent inbound message arrives and `ai-agent-service.ts` calls `match_knowledge_chunks` (the RPC at `insforge/migrations/002_rpc_functions.sql`), then the returned chunks include rows from the newly uploaded document when the embedding cosine similarity is ≥ `ai_settings.knowledge_similarity_threshold` (default 0.7, per `ai-agent-service.ts` defaults), and the AI's reply cites the chunk via the `messages.metadata.cited_chunk_ids` field.
- **AC-3.4 — Missing-knowledge escalation when no good match.** Given an inbound message whose best match in `knowledge_chunks` is below the `knowledge_similarity_threshold`, when the post-LLM check runs `MissingKnowledgeRule` at `escalation-rules.ts:157-170`, then the conversation is escalated (status = `escalated`, `metadata.escalation_rule = 'MissingKnowledgeRule'`) and the agent is told "no good knowledge match" in the AI panel, so the customer does not get a hallucinated answer and the owner is told the doc they have does not cover this topic.
- **AC-3.5 — Soft cap per tier.** Given a tenant on the Starter tier has 5 knowledge documents already, when they attempt to upload a 6th, then the service rejects the write with a typed `QuotaExceededError` and the UI shows the cap. (Per `PRICING.md` §2.1; cap is `5 / 50 / unlimited` for Starter / Growth / Scale.)

### Files touched

- `app/knowledge/page.tsx` (existing; the page, the upload form)
- `insforge/functions/process-knowledge-document/index.ts` (existing; the queued worker)
- `packages/support-core/src/services/knowledge-ingestion-service.ts` (existing; chunk + embed + store)
- `packages/support-core/src/repositories/knowledge-repository.ts` (existing)
- `insforge/migrations/001_initial_schema.sql` (existing; tables)
- `insforge/migrations/002_rpc_functions.sql` (existing; the `match_knowledge_chunks` RPC)
- `docs/design/spec.md` (existing; the "Linen" drop-zone spec)

### Depends on

- US-7 (cross-tenant isolation on `knowledge_documents` and `knowledge_chunks` — the RLS policy is in `insforge/migrations/003_rls_policies.sql`).
- US-4 (the SMS/email channel must be live before knowledge is exercised, but the document can be uploaded in advance).
- Story child card: `t_eng_knowledge_ingestion`. Sibling story: US-5 (the `knowledge_similarity_threshold` knob the owner can tune to make US-3 stricter or looser).

### Out of scope

- URL import, scheduled re-fetch of a remote source, version diffing, multi-language embeddings, hierarchical chunking (per `PRD.md` §5 — all v1.1 / v2).
- OCR on scanned PDFs (per `PRD.md` §4 F4 "Out of scope" — PDF parsing only works when text can be extracted).
- Per-chunk reviewer UI (a "this chunk is wrong" button). The v1 contract is: document is good or document is deleted and re-uploaded.
- Automatic KB suggestions based on gaps in `MissingKnowledgeRule` triggers. Surfacing the gap exists (US-3 AC-3.4); suggesting a fix does not.

---

## US-4 — Channel test connection

**As an** owner (Jordan, the secondary persona),
**I want** a "send a test message" / "send a test email" button in the settings page that confirms my Twilio / Telnyx / Postmark credentials work,
**so that** I do not find out about a misconfiguration from a customer or a missing-inbox incident at 9am on a Monday.

### Acceptance criteria

- **AC-4.1 — Test button on the channel settings page.** Given a tenant owner navigates to `app/settings/sms/page.tsx` or `app/settings/email/page.tsx`, when the page loads, then each configured provider account row has a "Test connection" button that calls `insforge/functions/test-channel-connection/index.ts` with `{ channelType, providerAccountId }`.
- **AC-4.2 — Account-lookup test path.** Given the test connection button is clicked, when the entrypoint at `test-channel-connection/index.ts` runs the 4-step flow (lines 33-109), then the active account is looked up by id in `sms_provider_accounts` or `email_provider_accounts` (`001_initial_schema.sql:112`, `:156`), `is_active = true` is confirmed, and the response is `{ status: 'ok', provider, label, message }` — and the response renders as a green "Active" chip in the UI.
- **AC-4.3 — Inactive or missing account surfaces a clear error.** Given the test button is clicked for an account that does not exist or is `is_active = false`, when the entrypoint runs, then the response is `{ status: 'error', error: 'Provider account not found' }` (404) or `{ status: 'error', error: 'Provider account is inactive' }` (200 with status:error) respectively, and the UI shows the typed error.
- **AC-4.4 — Honest failure path on credential expiry (v1 gap, called out).** Given a provider account is *active in our DB* but the credentials it points to are *expired or revoked at the provider*, when the test connection is run, then **the response will currently report "ok"** because `test-channel-connection/index.ts:102-103` is an explicit stub: "For now, verifying the account exists and is active constitutes a successful test. Future: actually ping the provider API to verify credentials." The v1 acceptance is: this gap is called out in the settings page UI ("This test confirms the account is enabled in InboxPilot. To verify the credentials are still valid at the provider, send a real test message below.") and a real-test send path is provided as a follow-up button. **This is a known v1 limitation, not a v1 ship-blocker** — the entrypoint exists and is wired, the gap is the live provider ping. Tracked in `QA_BUG_HUNT.md` follow-ups.

### Files touched

- `app/settings/sms/page.tsx` (existing)
- `app/settings/email/page.tsx` (existing)
- `insforge/functions/test-channel-connection/index.ts` (existing; the 4-step flow)
- `packages/support-core/src/repositories/sms-provider-account-repository.ts` (existing)
- `packages/support-core/src/repositories/email-provider-account-repository.ts` (existing)
- `insforge/migrations/001_initial_schema.sql:112`, `:156` (existing; the account tables)

### Depends on

- US-7 (the test endpoint is JWT-protected; a user in org A must not be able to test org B's provider accounts).
- Story child card: `t_eng_settings_channels`. Sibling story: none directly (US-4 is a leaf in the story graph — it gates US-1 and US-3 in spirit, but the settings page is independent).

### Out of scope

- Real provider API ping in `test-channel-connection` itself (a "ping Twilio / Postmark with a nonce" round-trip). The current v1 contract is the active-flag check + the in-app send-a-real-test path. The provider ping is a v1.1 follow-up.
- A "verify webhook signature" test (the webhook entrypoints themselves validate signatures on inbound; a settings-page button for this is not a v1 feature).
- Multi-account test in one click (test each account in sequence with a single button). The v1 is one account at a time.

---

## US-5 — Auto-reply threshold tuning

**As an** owner (Jordan, the secondary persona),
**I want** a settings page with sliders for "AI mode", "AI confidence threshold", and "knowledge similarity threshold" per org,
**so that** I can trade off containment for risk based on my team's comfort — start in `draft_only`, watch the dashboard, then flip to `auto_reply` once I trust the AI.

### Acceptance criteria

- **AC-5.1 — All three settings render with current values.** Given a tenant owner navigates to `app/settings/ai/page.tsx`, when the page loads, then three controls render with their current values from `ai_settings` (`insforge/migrations/001_initial_schema.sql:200`): `ai_mode` (segmented control: `off` / `draft_only` / `auto_reply`), `confidence_threshold` (slider 0.0–1.0, default 0.75, step 0.05), and `knowledge_similarity_threshold` (slider 0.0–1.0, default 0.7, step 0.05).
- **AC-5.2 — Threshold actually gates the auto-reply.** Given the owner has set `ai_mode = 'auto_reply'` and `confidence_threshold = 0.8`, when `ai-agent-service.ts:354` runs the gate `if (parsed.confidence >= confidenceThreshold && !parsed.requires_human)`, then a parsed decision with `confidence = 0.79` does *not* auto-send (it stays in `ai_state = 'drafted'`) and a parsed decision with `confidence = 0.81` *does* auto-send (it transitions to `ai_state = 'auto_replied'` and enqueues a `send_outbound_message` job). This is asserted by a unit test on the gate.
- **AC-5.3 — Starter is gated to `draft_only`.** Given a tenant is on the Starter tier, when they attempt to set `ai_mode = 'auto_reply'`, then the service rejects the write with a typed `FeatureGatedError` and the segmented control disables the `auto_reply` option with a tooltip ("Upgrade to Growth to enable auto-reply"). (Per `PRICING.md` §2.1.)
- **AC-5.4 — Per-reply token cap.** Given a tenant has set `ai_settings.per_reply_token_cap = 500` (per `LAUNCH_CHECKLIST.md` §3.5), when the AI is invoked, then the response from the LLM is truncated to 500 tokens before the structured-output parse, so a runaway response cannot cost more than the cap. This is asserted by a unit test that mocks the LLM to return 2000 tokens and verifies the parsed `body` is at most 500 tokens.
- **AC-5.5 — Setting change is audited.** Given the owner changes any of the three controls and clicks Save, when the write to `ai_settings` completes, then a `audit_logs` row is written with `action = 'ai_settings_update'` and the diff (old value, new value, setting name) in `metadata`. The change is visible in the audit log view in the inbox (Growth tier) or in the CSV export (Scale tier; see US-6).

### Files touched

- `app/settings/ai/page.tsx` (existing; the settings page)
- `packages/support-core/src/services/ai-agent-service.ts` (existing; the gate at line 354, the default at line 36)
- `packages/support-core/src/repositories/ai-settings-repository.ts` (existing)
- `insforge/migrations/001_initial_schema.sql:200` (existing; the table)
- `app/inbox/page.tsx` (existing; reads the settings to render the AI panel)

### Depends on

- US-7 (the settings write is JWT-protected; a user must be `owner` or `admin` to mutate `ai_settings`, per `packages/support-core/src/services/rbac.ts`).
- Sibling story: US-1 (the gate is what makes auto-reply vs draft visible to Maya in the inbox), US-3 (the `knowledge_similarity_threshold` knob is what makes knowledge gating visible to Jordan when reviewing AI replies).
- Story child card: `t_eng_settings_ai`.

### Out of scope

- Per-channel AI mode overrides (e.g. "auto-reply on SMS, draft-only on email"). One `ai_mode` per org in v1.
- Per-tenant model selection beyond the `OPENROUTER_MODEL` env var (per `PRD.md` §4 F5 "Out of scope" — the operator can swap the model for all tenants, per-tenant selection is v2).
- Per-tenant prompt management beyond the single `ai_settings.system_prompt` text column.
- A "preview the AI" simulator in the settings page (a chat box that calls the AI with the current settings). The owner can observe behaviour in the live inbox; a dedicated simulator is v1.1.

---

## US-6 — Audit log export (Scale tier)

**As a** compliance lead (a third persona, named in `PRICING.md` §2.3 — distinct from Maya and Jordan),
**I want** to export the audit log for our org as CSV (or JSON) for a chosen date range,
**so that** I can satisfy SOC 2 evidence requests and quarterly compliance reviews without filing a ticket with InboxPilot support.

### Acceptance criteria

- **AC-6.1 — Export endpoint exists and is Scale-gated.** Given a tenant is on the Scale tier and an `owner` or `admin` user requests an export via `POST /functions/v1/export-audit-log?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv`, when the request hits the entrypoint, then the response is `202 Accepted` with `{ jobId, statusUrl }` and the export runs as an async job (so a 90-day query does not tie up a function worker — per `PRICING.md` §3.3), and the user polls `statusUrl` until it returns a signed download URL. **v1 ship-blocker for the Scale value prop:** this entrypoint does not yet exist on disk (`ls insforge/functions/` shows 14 entrypoints; `export-audit-log` is not one of them). The child build card `t_eng_analytics_dashboard` (which owns the read surface) must land it, or US-6 is not done. The function entrypoint path I expect: `insforge/functions/export-audit-log/index.ts`.
- **AC-6.2 — Tenant-scoped read, RLS-enforced.** Given a JWT for a user in org A, when they call the export endpoint with `from` / `to` covering the last 90 days, then the response contains only `audit_logs` rows where `organization_id = <org A>` (RLS via `insforge/migrations/003_rls_policies.sql`; the integration test at `packages/support-core/__tests__/integration/rls-policies.test.ts` is the assertion point — see US-7 AC-7.2).
- **AC-6.3 — CSV columns are stable and documented.** Given the CSV is generated, when it is opened in a spreadsheet, then the column header row is exactly: `id, organization_id, actor_id, actor_type, action, resource_type, resource_id, metadata, created_at` (the source columns in `insforge/migrations/001_initial_schema.sql:299-308`, in the same order they appear in the table). The order and column set are fixed; adding a column is a v1.1 change.
- **AC-6.4 — Starter and Growth see the gated error.** Given a tenant is on the Starter or Growth tier, when they call the export endpoint, then the response is `402 Payment Required` with `{ error: 'Audit log export is a Scale-tier feature. Upgrade at https://.../pricing.' }`. The endpoint does not silently return 200 with partial data. (Per `PRICING.md` §2.3.)
- **AC-6.5 — 90-day cap on Scale.** Given a tenant is on the Scale tier and asks for a range `from = today - 365d`, when the endpoint runs, then the effective range is clamped to the most recent 90 days and the response includes an `X-Export-Window-Clamped: true` response header. (Per `PRICING.md` §2.3 — the 90-day limit is a tier boundary, not a marketing claim.)

### Files touched

- `insforge/functions/export-audit-log/index.ts` (**to be created** by `t_eng_analytics_dashboard`)
- `app/analytics/page.tsx` (existing; the read surface — adds a "Download audit log" button for Scale tenants)
- `insforge/migrations/001_initial_schema.sql:299` (existing; the source table)
- `insforge/migrations/003_rls_policies.sql` (existing; the `audit_logs` RLS policy)

### Depends on

- US-7 (tenant scoping is the entire point of the export — see US-7 AC-7.2 for the integration test that proves it).
- Story child card: `t_eng_analytics_dashboard` (which owns both the dashboard and the export entrypoint, per the board wiring). Sibling story: US-5 (the audit log is what makes the AI settings changes in US-5 AC-5.5 auditable in this export).

### Out of scope

- Streaming export for very large ranges (the 90-day cap on Scale makes this unnecessary in v1; a streaming variant is a v1.1 follow-up if a customer asks).
- Pre-built SOC 2 / HIPAA report templates. The export is the raw `audit_logs` table; templating reports is the customer's job (or a v1.1 add-on).
- Per-resource-type exports (e.g. "export only inbound events" with a filter). The v1 export is the full `audit_logs` table for the org and date range.
- JSONL format (the PRD commits to CSV in `PRICING.md` §2.3; JSONL is a v1.1 follow-up if a customer asks).
- Email delivery of the export ("email me the file when it's ready"). The v1 is a download from the analytics page via the async `statusUrl` flow (per `PRICING.md` §3.3 — the export runs as a job and returns a signed download URL when ready, not a synchronous stream).

---

## US-7 — Multi-tenant isolation (cross-cutting constraint)

**As the** platform owner (the InboxPilot founders, distinct from Jordan),
**I want** to be confident that no org can ever see, mutate, or audit another org's conversations, messages, contacts, or knowledge documents,
**so that** the SOC 2 evidence path is clean, the design-partner trust is preserved, and a single bug in one tenant's flow cannot leak to another.

### Acceptance criteria

- **AC-7.1 — JWT-protected function entrypoints check org membership.** Given a JWT for a user in org A, when they call any of the 7 JWT-protected function entrypoints (`send-reply`, `approve-ai-draft`, `regenerate-ai-draft`, `escalate-conversation`, `resolve-conversation`, `reopen-conversation`, plus the in-flight `export-audit-log` from US-6) with a `conversationId` (or equivalent) belonging to org B, then the entrypoint returns `403 Forbidden` *before* any database mutation, and a `audit_logs` row with `action = 'cross_tenant_attempt'` and `metadata.attempted_org_id = <org B>` is written. The fix is a `requireOrgMembership(userId, conversationId)` helper called before mutation in all 7 entrypoints. **v1 ship-blocker** per `QA_BUG_HUNT.md` CRITICAL-2 and `PRD.md` §6 R3; without this, US-1 / US-2 / US-5 / US-6 all have a real cross-tenant write vulnerability.
- **AC-7.2 — RLS policies are exercised by a real two-org integration test.** Given the integration test at `packages/support-core/__tests__/integration/rls-policies.test.ts` runs, when it provisions two orgs (org A, org B) with their own JWTs and a row in each of the tenant-scoped tables (conversations, messages, contacts, knowledge_documents, knowledge_chunks, audit_logs), then:
  - org A's JWT can SELECT, INSERT, UPDATE, DELETE on org A's rows, and
  - org A's JWT receives 0 rows (or an RLS-denied error, depending on the path) when querying for org B's rows, and
  - org A's JWT cannot INSERT a row with `organization_id = <org B>` (the foreign-key + RLS combo rejects it), and
  - org A's JWT cannot UPDATE org B's row even if it guesses the `id`.
  This test is currently `9 lines of it.todo` per `PRD.md` §6 R3; the v1 acceptance is that it is *implemented for real*, not as a stub. **v1 ship-blocker** per `LAUNCH_CHECKLIST.md` §2.1.
- **AC-7.3 — RLS policies exist on every tenant-scoped table.** Given the migration `insforge/migrations/003_rls_policies.sql` is applied, when the schema is inspected, then every table in the tenant-scoped set (`organizations`, `organization_members`, `conversations`, `messages`, `contacts`, `knowledge_documents`, `knowledge_chunks`, `ai_decisions`, `ai_settings`, `sms_provider_accounts`, `email_provider_accounts`, `audit_logs`, plus the future `organization_subscriptions`) has a policy that filters by `organization_id IN (SELECT user_org_ids())` and an `ALL` (or per-action) policy for `authenticated` and `anon` roles that scopes reads and writes. The verification is `LAUNCH_CHECKLIST.md` §2.2.
- **AC-7.4 — Inbound webhooks do not trust caller-supplied org attribution.** Given a webhook hits `sms-inbound/index.ts` or `email-inbound/index.ts` with an `x-organization-id` header, when the entrypoint parses the request, then the header is *ignored* and the org is resolved from the `to:` address against `sms_provider_accounts.from_number` (or `email_provider_accounts.from_address`). The fix removes the caller-controlled branch. (Per `QA_BUG_HUNT.md` CRITICAL-3; v1 ship-blocker per `PRD.md` §6 R3.)
- **AC-7.5 — Mock provider is disabled in production.** Given `Deno.env.get('ENV') === 'production'`, when any webhook entrypoint receives a request with `x-provider: mock` (or no `x-provider` header, defaulting to mock), then the entrypoint returns `400 { error: 'Mock provider disabled in production' }` and no inbound row is created. (Per `QA_BUG_HUNT.md` CRITICAL-1 and `PRD.md` §6 R6; v1 ship-blocker.)
- **AC-7.6 — Audit log is append-only.** Given a user with the `service_role` key (or any other role), when they attempt to UPDATE or DELETE a row in `audit_logs`, then the operation is rejected by the RLS policy at `insforge/migrations/003_rls_policies.sql` (no UPDATE or DELETE policy exists for any role). The verification is `LAUNCH_CHECKLIST.md` §2.3.

### Files touched

- `insforge/migrations/003_rls_policies.sql` (existing; the policies; AC-7.3, AC-7.6)
- `packages/support-core/__tests__/integration/rls-policies.test.ts` (existing; **must be implemented for real** to satisfy AC-7.2; currently `it.todo` stubs)
- `insforge/functions/send-reply/index.ts:78-112` (existing; the `requireOrgMembership` fix lands here first, per `QA_BUG_HUNT.md` CRITICAL-2)
- `insforge/functions/approve-ai-draft/index.ts` (existing)
- `insforge/functions/regenerate-ai-draft/index.ts` (existing)
- `insforge/functions/escalate-conversation/index.ts` (existing)
- `insforge/functions/resolve-conversation/index.ts` (existing)
- `insforge/functions/reopen-conversation/index.ts` (existing)
- `insforge/functions/sms-inbound/index.ts` (existing; the `x-organization-id` removal and the mock-disable guard)
- `insforge/functions/email-inbound/index.ts` (existing; same)
- `insforge/functions/sms-status/index.ts` (existing; the mock-disable guard)
- `insforge/functions/email-status/index.ts` (existing; the mock-disable guard)
- `packages/support-core/src/services/rbac.ts` (existing; the `requireOrgMembership` helper lives here)
- `docs/evidence/tenant-isolation-probe.txt` (the evidence file produced by the AC-7.2 probe)

### Depends on

- Every other story in this file. US-7 is the cross-cutting constraint; if US-7's ship-blockers are not cleared, no other story is shippable for the SOC 2 evidence path.
- Story child card: `t_eng_auth` (which owns the `requireOrgMembership` helper landing) and the `t_qa_isolation_probe` work (which owns the integration test). Sibling story: every other story in this file.

### Out of scope

- Per-row encryption at the application layer (RLS is the access boundary; the database itself is the trust boundary in v1).
- A "tenant impersonation" admin tool for support debugging (the founders are Tier-1 support in v1; they debug via `psql` with the service role key directly, per `docs/SUPPORT_PLAYBOOK.md`).
- A "tenant delete" / "GDPR right-to-erasure" pipeline. The legal `DPA.md` and `AUP.md` commit to deletion on request, but the *pipeline* (cascading delete across all tenant-scoped tables) is a v1.1 follow-up. The data model is ready for it (every table has `organization_id`); the operator runbook + a single `DELETE FROM organizations WHERE id = $1` with CASCADE on the foreign keys is the v1 path.
- Per-tenant encryption keys (KMS-per-tenant). The v1 uses InsForge's managed storage; per-tenant keys is a v2 / enterprise feature.

---

## Cross-reference index

**Stories → PRD features (one-to-one or one-to-many):**
US-1 → F3 + F5 + F6 + F7 · US-2 → F3 + F6 + F8 · US-3 → F4 · US-4 → F2 · US-5 → F5 · US-6 → F9 (Scale tier) · US-7 → cross-cutting (F1 + F7 + F9).

**Stories → engineering child cards (every child card has at least one story reference):**
`t_eng_inbox_ui` ← US-1, US-2 · `t_eng_knowledge_ingestion` ← US-3 · `t_eng_settings_channels` ← US-4 · `t_eng_settings_ai` ← US-5 · `t_eng_analytics_dashboard` ← US-6 · `t_eng_auth` ← US-7 (the JWT + RLS fixes; also gates US-1, US-2, US-5, US-6). `t_design_onboarding` is the design side of US-1 and US-2's UX (the Inbox UI design) and US-4's settings design.

**Stories → sibling PM cards:**
`docs/PRD.md` (`t_pm_prd`) — the parent of this card; every story is a child of §4 · `docs/PRICING.md` (`t_pm_pricing_packaging`) — US-3, US-5, US-6 tier caps · `docs/METRICS.md` (`t_pm_metric_tree`) — US-1, US-2, US-5 are the surfaces that move M0 / M1 / M5 · `docs/LAUNCH_CHECKLIST.md` (`t_pm_launch_checklist`) — US-7 AC-7.2 / AC-7.4 / AC-7.5 are launch-blockers.

**Stories → known defects (the honest list):**
US-1 AC-1.3 cites `QA_BUG_HUNT.md` open gap #9 (the missing `ai-safety.test.ts`). US-4 AC-4.4 cites the explicit stub in `test-channel-connection/index.ts:102-103`. US-6 AC-6.1 cites the missing `export-audit-log` entrypoint. US-7 AC-7.1 / AC-7.2 / AC-7.4 / AC-7.5 / AC-7.6 each cite a `QA_BUG_HUNT.md` CRITICAL finding with a file:line. These are the "the PRD risks R3, R4, R6 are real" honesty from `PRD.md` §6.

---

## Acceptance criteria (re-stated from the card)

- [x] `InboxPilot/docs/USER_STORIES.md` exists with 7 stories (within the 5–7 range).
- [x] Each story has: ID, As-a / I-want-to / So-that, Given/When/Then acceptance criteria, a "Files touched" list referencing real paths in this repo, and a "Depends on" list pointing at other cards on this board.
- [x] US-7 (multi-tenant isolation) has explicit criteria that reference `insforge/migrations/003_rls_policies.sql` and the test file `packages/support-core/__tests__/integration/rls-policies.test.ts` (AC-7.2 and AC-7.3).
- [x] No story references a feature that does not exist in the codebase or in the PRD MVP scope. The two gaps that *do* exist are surfaced honestly: US-4 AC-4.4 (the `test-channel-connection` stub does not live-ping the provider) and US-6 AC-6.1 (the `export-audit-log` entrypoint does not yet exist on disk and is a v1 ship-blocker for the Scale tier).
- [x] Each story has an "Out of scope" line that names 1–2 things deliberately not in v1 for that story.
