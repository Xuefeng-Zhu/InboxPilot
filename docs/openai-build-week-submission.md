# OpenAI Build Week submission draft

This is a working draft for the Devpost submission at <https://openai.devpost.com/>. It is not a substitute for the final Devpost fields.

## Core fields

- Project name: **InboxPilot**
- Tagline: **Human-in-the-loop AI support for SMS, email, and web chat—escalating risky conversations before an LLM responds.**
- Category: **Work & Productivity**
- Repository: <https://github.com/Xuefeng-Zhu/InboxPilot>
- Demo video: **Missing — upload a public YouTube video under 3 minutes.**
- `/feedback` Session ID: **Missing — retrieve the primary build-thread ID.**
- Live test URL: **No public deployment URL has been verified. Use the repository setup path unless a demo deployment is supplied.**

The current checkout is `4f87c29`, 63 commits ahead of `origin/main`; the repository is the source of truth for the Build Week work described here.

## Project description

Customer support teams work across SMS, email, and web chat, but the cost of switching channels is only half the problem. AI can draft a useful answer while still missing a safety signal, a policy constraint, or the point where a human must take over.

InboxPilot is a multi-tenant AI support workspace that brings those channels into one inbox. Incoming messages are normalized, deduplicated, attached to the right customer conversation, and placed on a durable job queue. The AI pipeline retrieves relevant knowledge, evaluates deterministic escalation rules before any LLM call, and then produces either a draft, an auto-reply, or a human escalation based on organization settings, confidence, and safety requirements. Agents can approve, regenerate, send, escalate, resolve, and reopen conversations while realtime updates keep the inbox and embedded web-chat visitor in sync.

The product is built on Next.js and React with an InsForge backend. Nine Deno function entrypoints handle webhooks, jobs, and webchat lifecycle; the portable `packages/support-core/` package contains the business logic behind injected database, queue, AI, provider, and realtime interfaces. PostgreSQL RLS enforces tenant boundaries, pgvector supports knowledge retrieval, audit logs preserve significant actions, and atomic RPCs protect AI decisions, pending drafts, delivery status, and retries from race conditions.

The project is intentionally designed for failure-aware support operations: escalation is evaluated before the model sees sensitive content; jobs use active/lifetime idempotency and retry boundaries; late provider callbacks cannot overwrite terminal delivery outcomes; and authenticated realtime channels are scoped to the organization or visitor thread. The repository includes unit, property-based, source-contract, and opt-in live integration coverage for seed idempotency, tenant isolation, realtime delivery, inbound SMS/email, and outbound messaging.

## Codex and GPT-5.6 provenance

Use this section as the final, human-verified provenance paragraph. Do not submit it unchanged until the primary `/feedback` Session ID and the exact GPT-5.6 work are confirmed:

> I used Codex throughout the Build Week iteration to map the support pipeline, implement and test cross-channel behavior, and harden the retry, realtime, RLS, and AI-decision boundaries. GPT-5.6 was used for **[describe the specific feature, debugging pass, or design decision completed with GPT-5.6]**. The primary build thread is `/feedback` Session ID **[insert exact ID]**.

## Demo video script (target: 2:30–2:50)

1. **0:00–0:20 — Problem.** “Support teams receive customer conversations through multiple channels, and unsafe or low-confidence automation needs a reliable human handoff.”
2. **0:20–0:45 — Product.** Show the InboxPilot inbox and explain that SMS, email, and web chat share one conversation model.
3. **0:45–1:20 — AI workflow.** Send an inbound message, show the queued processing, knowledge-backed draft, confidence/status, and the deterministic escalation path for a sensitive message.
4. **1:20–1:50 — Human control.** Approve or edit a draft, send a response, then show escalation/resolve/reopen and the audit trail.
5. **1:50–2:15 — Web chat and reliability.** Show the embedded widget receiving a reply through realtime updates; briefly call out idempotent jobs, tenant-scoped RLS, and atomic AI-decision finalization.
6. **2:15–2:45 — Build Week provenance.** Explain exactly where Codex accelerated the work and exactly what was done with GPT-5.6. Display the repository URL and stop before three minutes.

## Verification evidence

- `npm test`: 978 passed, 30 opt-in live tests skipped by default.
- `npm run build`: passed, including the widget build and Next.js production build.
- `npm run lint`: passed, including TypeScript, Deno safety scan, and Deno checks for all nine function entrypoints.
- Recent live suites cover seed idempotency, RLS tenant isolation, realtime delivery, inbound SMS, inbound email, and outbound messaging when run against the guarded disposable branch.

## Final blockers before submission

- Upload and verify a public YouTube demo under three minutes with voiceover covering the product, Codex, and GPT-5.6.
- Retrieve and enter the primary `/feedback` Codex Session ID.
- Replace the provenance placeholder with the exact, human-verified GPT-5.6 contribution.
- Confirm Devpost account/team fields and country of residence; do not infer either from the repository.
- Resolve repository licensing/access for judging. The local README currently says “Private — not for redistribution,” while the Devpost rules require a public repo with a relevant license or a private repo shared with `testing@devpost.com` and `build-week-event@openai.com`.
- Do not click final Submit until every required field and the video link have been checked immediately beforehand.
