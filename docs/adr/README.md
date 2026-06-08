# Architecture Decision Records (ADRs)

ADRs document significant architectural decisions: what we decided, why, and what trade-offs we accepted. Once accepted, an ADR is rarely changed — if the decision is reversed, we write a new ADR that supersedes the old one.

## Status

| ID | Title | Status | Date | Affected docs |
|---|---|---|---|---|
| 1.4 | RAG over Past Resolved Conversations | Accepted (in-progress implementation) | 2024 | [`../reference/architecture.md`](../reference/architecture.md), [`../reference/jobs.md`](../reference/jobs.md) |
| 3.1 | Internal Notes & @mentions | Accepted (in-progress) | 2024 | n/a yet — feature not landed |
| 7.3 | Web Chat Widget | Accepted (implemented) | 2024 | [`../reference/webchat.md`](../reference/webchat.md), [`../reference/architecture.md`](../reference/architecture.md), [`../reference/database.md`](../reference/database.md), [`../reference/api.md`](../reference/api.md) |

## Index

- [`1.4-rag-over-past-conversations.md`](1.4-rag-over-past-conversations.md) — when a new inbound message arrives, surface similar past resolved/escalated conversations alongside knowledge chunks so the AI can model its answer on prior handling.
- [`3.1-internal-notes.md`](3.1-internal-notes.md) — private notes on a conversation visible to agents but not customers, with `@mentions` and a real-time bell counter.
- [`7.3-webchat-widget.md`](7.3-webchat-widget.md) — drop-in JS snippet for live chat between an anonymous visitor and an InboxPilot agent. Reuses the existing AI pipeline.

## Conventions

Each ADR follows this structure:

1. **Goals & non-goals** — what the change is and isn't.
2. **Locked decisions** — a table of small decisions made during planning, each with the chosen value and (sometimes) the rationale.
3. **Design overview** — typically a diagram.
4. **Detailed sections** — schema, services, components, etc.

The ID format is `<epic>.<sub>` where `<epic>` is a broad project area and `<sub>` is the increment. They're not strict numbers (no "ADR 1" precedes "ADR 2") — they're tags for grouping related decisions.
