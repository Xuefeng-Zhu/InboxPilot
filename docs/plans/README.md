# Living Plans

This directory holds **living plans** — work-in-progress documents that describe multi-step work the team is currently doing or planning to do. They are not ADRs (those live in `../adr/`) because they change frequently and may not represent a single architectural decision.

| Plan | Scope | Status |
|---|---|---|
| [`ui-polish.md`](ui-polish.md) | Full UI/UX polish pass — 46 reviewable commits across 8 tracks (A–H) | Proposed (tracks 1, 5, 6, 7 partially started) |
| [`refactor.md`](refactor.md) | Codebase refactor — finish React Query migration, unify provider-account panels, add `withAuth`/`logAudit`/`enqueueJob`/`callFunction` helpers, unify `StatusBadge` | Proposed |
| [`multi-round-ai-fix.md`](multi-round-ai-fix.md) | Multi-round AI reply fix plan — diagnosed 2 of 5 multi-turn scenarios that fail in the current pipeline | Proposed (diagnostic complete; fix TBD) |

## When to use a plan vs an ADR

- **ADR**: you made a decision, want to record it, and don't expect to change it. Future readers should be able to understand "why is it this way" by reading the ADR.
- **Plan**: you're scoping or executing work, and the document will change as you learn. The output is a feature or a fix, not a record of a decision.

When a plan stabilizes (the work is done and the design is settled), promote the relevant sections into an ADR. If the plan introduces a new architectural decision, write a new ADR that links to the plan as the execution record.
