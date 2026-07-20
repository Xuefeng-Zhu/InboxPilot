# InboxPilot Documentation

InboxPilot is a multi-tenant AI customer support platform built on [InsForge](https://insforge.dev). It handles inbound and outbound communication over SMS, email, and an embedded web chat widget; uses AI to draft and auto-reply; and escalates sensitive conversations to human agents.

This directory is organized by audience and use case.

## Quick start

| If you are… | Start here |
|---|---|
| Setting up the project for the first time | [`guides/getting-started.md`](guides/getting-started.md) |
| Working on a task in the codebase | [`reference/architecture.md`](reference/architecture.md) |
| Looking up a schema, table, or RPC | [`reference/database.md`](reference/database.md) |
| Calling or integrating with an API | [`reference/api.md`](reference/api.md) |
| Embedding the web chat widget | [`reference/webchat.md`](reference/webchat.md) |
| Working on the Next.js frontend | [`reference/frontend.md`](reference/frontend.md) |
| Debugging a production issue | [`guides/debugging.md`](guides/debugging.md) |
| Reviewing security / RBAC | [`reference/rbac.md`](reference/rbac.md) |
| Reading or writing tests | [`reference/testing.md`](reference/testing.md) |
| Exploring the alternate timeline inbox view | [`reference/symphony.md`](reference/symphony.md) |

## Layout

```
docs/
├── README.md                  ← this file
├── guides/                    ← how-to / workflow docs
│   ├── getting-started.md
│   ├── local-development.md
│   ├── adding-a-channel.md
│   ├── adding-an-escalation-rule.md
│   ├── debugging.md
│   └── deploying.md
├── reference/                 ← source-of-truth tables and diagrams
│   ├── architecture.md
│   ├── database.md
│   ├── api.md
│   ├── rbac.md
│   ├── jobs.md
│   ├── audit.md
│   ├── frontend.md
│   ├── symphony.md
│   ├── webchat.md
│   └── testing.md
├── adr/                       ← Architecture Decision Records (accepted/proposed)
│   ├── README.md
│   ├── 1.4-rag-over-past-conversations.md
│   ├── 3.1-internal-notes.md
│   └── 7.3-webchat-widget.md
├── plans/                     ← living plans (work-in-progress, not ADRs)
│   ├── README.md
│   ├── ui-polish.md
│   ├── refactor.md
│   └── multi-round-ai-fix.md
└── research/                  ← archived research artifacts (not authoritative)
    ├── README.md
    ├── deep-research-report.md
    └── original-prompt.md
```

## What changed in this reorganization

The docs were previously a flat set of `docs/*.md` files that had drifted out of sync with the code. They are now:

- **Renamed and moved** to `reference/` and `guides/` to separate source-of-truth from how-to.
- **Extended** with five new reference docs that previously existed only as inline content: `rbac.md`, `jobs.md`, `audit.md`, `frontend.md`, `webchat.md`.
- **Corrected** to reflect the current state of the code: 9 InsForge Deno functions, 12 Next.js API routes, 20 application tables, 15 repositories, 25 migration files, 3 channels (SMS, email, webchat), and React Query on the frontend. Last verified: 2026-07-20.
- **Mermaid diagrams** replace ASCII for component diagrams, sequence flows, and state machines.
- **ADR directory is now pure** — the living plans (`ui-polish`, `refactor`, `multi-round-ai-fix`) moved to `plans/`. Research artifacts moved to `research/`.

If you find a stale reference, broken link, or inaccuracy, please update the doc in place. See [`reference/architecture.md`](reference/architecture.md) for the system overview, and the `AGENTS.md` at the repo root for development rules.
