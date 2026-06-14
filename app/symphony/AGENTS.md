# app/symphony/ — Symphony Inbox Visualization

**Always loaded** for any work on the Symphony view, the River visualization, or the inbox timeline feature.

## OVERVIEW
**Alternate inbox view** — a horizontal "river" of conversation cards laid out on a time axis, with a minimap for navigation. Has its own 7 components, 5 tests, and a data hook (`useSymphony.ts`). Linked from `components/layout/Sidebar.tsx` (line 277-281). Symphony is partially documented: a reference page exists at `docs/reference/symphony.md`, but it is not in the root `README.md` or any `AGENTS.md` summary.

**WARNING**: This is not in any documentation. If you find yourself needing to refactor or extend it, document the change here.

## STRUCTURE
```
app/symphony/
├── page.tsx                      Entry point (parses ?zoom= from URL)
└── _components/
    ├── SymphonyView.tsx          Main view (River + TimeAxis + MiniMap + expanded panel)
    ├── SymphonyControls.tsx      Zoom pills (Today/Week/Month/All) + prev/next nav arrows
    ├── TimeAxis.tsx              Time axis with floating "NOW" pin
    ├── River.tsx                 Horizontal scrollable strip of RiverCards
    ├── RiverCard.tsx             Per-conversation card (contact, channel, last message, AI state pill)
    ├── RiverExpandedPanel.tsx    Expanded view of a card (full thread + edit/approve AI draft + send reply)
    └── MiniMap.tsx               One-bar-per-conversation minimap with click-to-jump
```

Supporting code (outside this dir):
- `lib/queries/hooks/useSymphony.ts` — data hooks + window math + axis/pill helpers (the largest hook file in the project).
- `lib/queries/keys.ts` — adds `'symphony-conversations'` and `'symphony-counts'` query keys.
- `__tests__/symphony/River.test.tsx`, `MiniMap.test.tsx`, `RiverCard.test.tsx`, `RiverExpandedPanel.test.tsx`, `UseSymphonyCounts.test.ts` — 5 component/hook tests.
- `design-review/concept-04-symphony.html` — original design mockup.

## FEATURES
- **4 zoom levels:** `today` / `week` (default) / `month` / `all`. `?zoom=` URL param drives it.
- **Prev/next nav arrows** step ±1 window.
- **Per-card AI state pill** (auto-replied / drafted / escalated / idle) with channel icon.
- **Click a card** → expanded panel with full thread (`useMessages`) + latest AI decision (`useAiDecision`) + composer that calls the same `send-reply` / `approve-ai-draft` API routes.
- **Realtime subscription** via `useRealtime({messageChannel: org:${orgId}, conversationChannel: org:${orgId}})` — invalidates symphony queries on `new_message` / `conversation_updated`.

## WHERE TO LOOK
- **Change the zoom levels / window math** → `useSymphony.ts` (the `Zoom` type, `computeSymphonyWindow`, `getAxisTicks`).
- **Add a new pill tone or AI state** → `useSymphony.ts` (`pillForAiState`, `barToneForAiState`) and the `AiState` type in `components/ui/StatusBadge.tsx`.
- **Tweak the card layout** → `RiverCard.tsx`.
- **Change the minimap** → `MiniMap.tsx` (one bar per conversation, click to jump).
- **Update the URL parsing** → `page.tsx` (`parseZoom` function).
- **Document this view** → add it to `docs/README.md` and `README.md`. Currently absent.

## CONVENTIONS
- **Private folder pattern:** `_components/` with underscore prefix prevents Next.js from generating routes for component subdirs.
- **URL is the source of truth for zoom** — `useSearchParams` + `<Suspense>` boundary (required by Next 16).
- **`<AppShell noPadding>` wraps the page** (matches inbox).
- **Realtime invalidation** in `SymphonyView.tsx` — uses `useRealtime` from `lib/use-realtime.ts`.
- **Mutations go through `/api/functions/*`** (same as inbox).

## ANTI-PATTERNS
- Hardcoding the zoom level (read from `?zoom=`).
- Calling `insforge.database.from(...)` from a component (use the hooks).
- Adding a `'use client'` boundary at the page level if not needed (the page is already a client component because of `useSearchParams`).
- Adding the view to docs without first making the implementation final (it's in-progress).

## UNIQUE
- **The only fully-built, fully-wired but undocumented feature** in the project. Find via Sidebar link only.
- **Largest data hook file:** `useSymphony.ts` carries both the queries AND the window/axis/pill math.
- **Uses `useSearchParams` in a client component** — requires the `<Suspense>` boundary at the page level.
- **Has its own design mockup** at `design-review/concept-04-symphony.html` (24.3 KB).
- **Tests are component-level only** (`River.test.tsx`, `MiniMap.test.tsx`, `RiverCard.test.tsx`, `RiverExpandedPanel.test.tsx`, `UseSymphonyCounts.test.ts`) — no property tests.
- **The "Now" pin on the time axis** (`TimeAxis.tsx`) is a distinctive UI element not seen elsewhere in the app.

## TODO / KNOWN GAPS
- Not in `README.md` or any `AGENTS.md` summary. A reference page exists at `docs/reference/symphony.md` and it is linked from `docs/README.md`.
- No property-based tests (only 5 component/hook tests).
- The "old settings page" referenced elsewhere is not the Symphony; Symphony is a separate, fully-built feature.
