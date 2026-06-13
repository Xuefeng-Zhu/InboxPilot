# InboxPilot — UI Mockups

Static HTML mockups for 5 design directions. Open each file in a browser; no build step.

| # | File | Direction | Headline change |
|---|------|-----------|-----------------|
| 1 | `1-linear-grade.html` | Linear-grade | Dark, dense, keyboard-first. `⌘K`, `J/K`, monochrome with one indigo accent. |
| 2 | `2-front-grade.html` | Front-grade | Three-channel command center. Channel-colored rails, segmented channel filter, real Timeline tab (replaces broken "Audit" placeholder), AI panel as bottom drawer. |
| 3 | `3-notion-grade.html` | Notion-grade | Calm, generous, content-first. No nested cards, hairline borders only, AI state is a soft pulsing dot, no icons in buttons. |
| 4 | `4-retool-grade.html` | Retool-grade | Power-user split inbox. Pinned columns (Mine / Escalated / AI drafted / Awaiting), SLA chips, keyboard macro bar, bulk-action bottom bar, inline hover previews. |
| 5 | `5-stripe-grade.html` | Stripe-grade | Marketing/product continuity. Real product screenshot in browser chrome, kitchen-sink component section using the app's own primitives, structured footer. |

All mockups reuse the same customer / order / message scenario (Maya Patel, SMS, order #4892, refund) so you can compare the same moment across directions.

## Viewing

```bash
open mockups/1-linear-grade.html
# or just open the folder and click any file
```

## Notes

- All five use Tailwind via CDN for fast iteration. In production, switch to the existing `tailwind.config.ts` tokens (`status.*`, `surface.*`, `text-display-*`).
- Mockup 2 is the recommended first implementation: it makes the multi-tenant multi-channel value prop visible, kills the broken Audit placeholder, and aligns with the current component structure (`MessageThread`, `AiDraftPanel`, `ConversationItem`).
- Mockup 5 should be the first marketing-side change because the current landing is detached from the app.
- Mockup 1 (dark) requires token work that's currently out of scope per `docs/plans/ui-polish.md`. Worth doing after Phase 1–3 land.
- Mockup 4 is the biggest product pivot (triage tool vs chat app) and needs a stakeholder call before designing around it.
