# components/inbox/ — Inbox Feature

**Always loaded** for any work on the inbox screen, conversation list, message thread, or AI draft panel.

## OVERVIEW
10 feature components that compose the 3-pane inbox (`/inbox`): left filters+list, center thread, right detail panel. **No barrel `index.ts`** — every import is explicit. (The other feature dirs use barrels; this one is the gap.)

## THE 10 COMPONENTS
| File | What it does |
|---|---|
| `AiDraftPanel.tsx` | Right-rail AI draft UI: shows the latest `ai_decision` for a conversation, allows regenerate / approve / edit-then-approve. |
| `ContactDetails.tsx` | Right-rail contact card (name, email, phone, metadata, recent conversations). |
| `ConversationItem.tsx` | Single row in the conversation list (avatar, name, preview, time, status pill). |
| `ConversationList.tsx` | The list itself, with virtualized scroll and selection. |
| `CustomerSelector.tsx` | Combobox for switching the contact attached to a conversation. |
| `InboxFilters.tsx` | Left-rail filters: status, channel, assigned_to, date range. (Plumbing TODO for URL params — see `Sidebar.tsx` TODO(3.2).) |
| `MessageBubble.tsx` | Single message in the thread (sender alignment, AI badge, delivery status). |
| `MessageThread.tsx` | The thread itself, paginated with `useInfiniteMessages`. |
| `ReplyComposer.tsx` | Bottom-of-thread composer: textarea + channel selector + send (calls `send-reply` API route). |
| `RightPanel.tsx` | The right rail container that switches between `AiDraftPanel` and `ContactDetails` based on the selected conversation. |

## WHERE TO LOOK
- **Add a new conversation field** → update `ConversationListItem` in `lib/queries/keys.ts`, then surface in `ConversationItem` (and the right rail if it shows contact data).
- **Tweak the AI draft flow** → `AiDraftPanel.tsx` is the only consumer of `useAiDecision`. State transitions live in the API route handlers.
- **Add a new filter** → `InboxFilters.tsx` + propagate to `queryKeys.conversationsInfinite()` filters arg.
- **Adjust the message layout** → `MessageThread.tsx` (layout) and `MessageBubble.tsx` (per-message rendering).
- **Send a reply** → `ReplyComposer.tsx` calls `POST /api/functions/send-reply` (via `getAccessToken()`).

## CONVENTIONS
- **No barrel `index.ts`** — every consumer imports the specific file (e.g. `import { ConversationList } from '@/components/inbox/ConversationList'`). The other feature dirs (`knowledge/`, `customers/`) do have barrels; this is the gap.
- **All data fetching via React Query hooks** from `lib/queries/hooks/` (e.g. `useConversations`, `useInfiniteMessages`, `useAiDecision`). Components never call `insforge.database.from(...)` directly.
- **All mutations via `fetch('/api/functions/<route>', …)`** — no mutation hooks in `lib/queries/`. (Potential factoring: extract a `useApiMutation` wrapper.)
- **Selection state lives in URL search params** for the `conversationId` (so deep links work and back/forward navigate cleanly).
- **Realtime invalidation via `useRealtime`** — `MessageThread` and `ConversationList` subscribe to `org:${orgId}` channel and invalidate queries on `new_message` / `conversation_updated` events.

## ANTI-PATTERNS
- Adding a barrel `index.ts` to this dir without auditing the existing imports (would require touching every page that imports from here).
- Calling `insforge.database.from(...)` directly from a component (use a hook).
- Hardcoding the conversation ID in component state (URL params only).
- Adding business logic (delegation, retries) to a component — that's the API route handler's job.

## UNIQUE
- **No barrel file** — the only feature subdir without one.
- **`AiDraftPanel` is the only consumer of `useAiDecision`** — AI state machine lives in the API routes.
- **The 3-pane layout is the heart of the app** — changes here affect every agent workflow.
- **`InboxFilters` has a TODO(3.2) for URL param plumbing** — currently the sidebar's `assigned_to` filter doesn't propagate to the inbox filters.
- **Virtualization** in `ConversationList` (assumes `react-virtual` or similar — check imports before adding new list items).
