# OpenAI Build Week submission draft

This is a working draft for the Devpost submission at <https://openai.devpost.com/>. It is not a substitute for the final Devpost fields.

## Core fields

- Project name: **InboxPilot**
- Tagline: **Human-in-the-loop AI support for SMS, email, and web chat—escalating risky conversations before an LLM responds.**
- Submitter type: **Individual**
- Country of residence: **United States**
- Category: **Work & Productivity**
- Repository: <https://github.com/Xuefeng-Zhu/InboxPilot>
- Demo video: <https://youtu.be/u8UTRrz4wNo>
- `/feedback` Session ID: **Missing — retrieve the primary build-thread ID.**
- Live test URL: **No public deployment URL has been verified. Use the repository setup path unless a demo deployment is supplied.**

The current checkout is `4f87c29`, 63 commits ahead of `origin/main`; the repository is the source of truth for the Build Week work described here.

## Project description

InboxPilot

InboxPilot is a human-in-the-loop AI support workspace for teams that need to respond across SMS, email, and web chat without letting automation outrun judgment.

## What it does

The app turns every inbound message into an auditable support conversation:

- brings SMS, email, and embedded web chat into one shared inbox;
- normalizes and deduplicates provider events before they become customer history;
- retrieves organization knowledge and produces a grounded AI draft or confidence-gated auto-reply;
- evaluates deterministic escalation rules before any LLM call for safety concerns, legal threats, profanity, missing knowledge, and other configured signals;
- lets agents approve, edit, regenerate, send, escalate, resolve, and reopen conversations;
- keeps the agent inbox and web-chat visitor synchronized through authenticated realtime events; and
- preserves the message, AI decision, knowledge evidence, delivery outcome, and human handoff in an audit trail.

The result is more than a chatbot: support teams can see what the system decided, why it decided it, and exactly where a human took control.

## How it works

A Next.js App Router client provides the inbox, customer, knowledge, analytics, settings, and embedded web-chat experiences. InsForge provides authentication, Postgres persistence, row-level security, storage, realtime delivery, and serverless functions.

The trusted backend is split into nine Deno function entrypoints for inbound webhooks, delivery callbacks, job processing, and webchat lifecycle. They delegate to the portable `packages/support-core/` package, where database, queue, AI, provider, and realtime dependencies are injected behind interfaces.

The reliability boundaries are deliberate:

- deterministic escalation runs before the model sees sensitive content;
- durable jobs use active/lifetime idempotency, retries, stale-claim recovery, and dead-letter handling;
- PostgreSQL RLS and organization-scoped realtime channels enforce tenant isolation;
- atomic RPCs protect pending drafts, AI-decision finalization, and monotonic delivery status from races and late callbacks; and
- pgvector-backed knowledge retrieval records the chunks used by each AI decision.

The public source is available at https://github.com/Xuefeng-Zhu/InboxPilot. The repository includes setup instructions, seeded sample data, unit and property-based tests, source-contract coverage, and guarded live integration suites for seed idempotency, tenant isolation, realtime delivery, inbound SMS/email, and outbound messaging.

## Why it matters

Traditional support automation optimizes for sending the next reply. That is the wrong default when the message contains a safety issue, a legal threat, an uncertain policy answer, or a delivery failure that needs investigation.

InboxPilot makes the reasoning and the handoff observable. Teams get the speed of AI-assisted responses without losing the controls that make automation trustworthy: a deterministic safety gate, grounded knowledge, confidence-based behavior, durable retries, tenant boundaries, and an auditable path back to a human.

## Build notes

I used ChatGPT and Codex throughout the Build Week iteration to decompose the cross-channel message lifecycle, implement the authenticated event and state-transition flows, harden the AI and delivery boundaries, and drive the live regression-verification loop. Codex accelerated the work by turning the support pipeline into testable interfaces and by helping trace failures across the Next.js client, InsForge functions, Postgres/RLS policies, realtime channels, and provider adapters.

The final README and submission should identify the primary `/feedback` Codex Session ID and the specific GPT-5.6 contribution used during the Build Week window.

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

- Verify that the supplied public YouTube demo is under three minutes and has voiceover covering the product, Codex, and GPT-5.6.
- Retrieve and enter the primary `/feedback` Codex Session ID.
- Replace the provenance placeholder with the exact, human-verified GPT-5.6 contribution.
- Confirm Devpost account/team fields and country of residence; do not infer either from the repository.
- Resolve repository licensing/access for judging. The local README currently says “Private — not for redistribution,” while the Devpost rules require a public repo with a relevant license or a private repo shared with `testing@devpost.com` and `build-week-event@openai.com`.
- Do not click final Submit until every required field and the video link have been checked immediately beforehand.
