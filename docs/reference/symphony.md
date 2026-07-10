# Symphony (timeline inbox view)

> Alternate inbox visualization at `app/symphony/`. A horizontal "river" of conversation cards laid out on a time axis, with a minimap for navigation. Best for high-volume review of a day's conversations.

## Overview

Symphony is a complementary view of the same `conversations` data shown in the 3-pane inbox at `app/inbox/`. Instead of a vertical list with side-by-side thread preview, Symphony lays conversations out horizontally across a time axis (the **River**) and offers a per-conversation **MiniMap** strip for quick navigation. It is the right tool when an agent wants to scan the shape of a day's conversations, jump to a specific moment, and open one in an expanded panel — versus scrolling a list.

It is **not** a redesign of `/inbox`. Both routes exist side-by-side; the Sidebar links to both.

## Key components

All under `app/symphony/_components/`:

| Component | Purpose |
|---|---|
| `SymphonyView.tsx` | Top-level view: composes `River` + `TimeAxis` + `MiniMap` + the expanded panel |
| `SymphonyControls.tsx` | Zoom pills (Today / Week / Month / All) and prev/next nav arrows |
| `TimeAxis.tsx` | Time axis with a floating "NOW" pin showing the current moment |
| `River.tsx` | Horizontally scrollable strip of `RiverCard`s |
| `RiverCard.tsx` | Per-conversation card (contact, channel, last message, AI state pill) |
| `RiverExpandedPanel.tsx` | Expanded view of a card: full thread + AI decision + composer |
| `MiniMap.tsx` | One-bar-per-conversation minimap with click-to-jump |

## Data hook

`lib/queries/hooks/useSymphony.ts` — the largest hook file in the project. Owns:
- React Query fetches for the conversation list and the per-window counts
- Window math (`computeSymphonyWindow`) and axis/pill helpers (`getAxisTicks`, `pillForAiState`, `barToneForAiState`)
- The `Zoom` type (`'today' | 'week' | 'month' | 'all'`)

Query keys are registered in `lib/queries/keys.ts` as `'symphony-conversations'` and `'symphony-counts'`.

## URL params

| Param | Purpose |
|---|---|
| `?zoom=` | Controls the time-axis zoom level. Accepted values: `today`, `week` (default), `month`, `all`. |

`page.tsx` reads it via `useSearchParams`, so the page must be wrapped in a `<Suspense>` boundary (see `app/AGENTS.md` for the project convention).

## Tests

5 component/hook tests under `__tests__/symphony/`:

- `River.test.tsx`
- `MiniMap.test.tsx`
- `RiverCard.test.tsx`
- `RiverExpandedPanel.test.tsx`
- `UseSymphonyCounts.test.ts`

Property coverage for `computeSymphonyWindow` and `getAxisTicks` lives in `__tests__/properties/symphony-window.property.test.ts`.

## Linked from

`components/layout/Sidebar.tsx` (around lines 277-281).

## Status

Built and functional. Linked from the Sidebar. Complementary view to `/inbox`, not a replacement.

See `app/symphony/AGENTS.md` for the full file structure, conventions, and known gaps.
