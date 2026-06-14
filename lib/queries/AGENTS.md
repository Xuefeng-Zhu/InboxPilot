# lib/queries/ — React Query Data Layer

**Always loaded** for any frontend data work — every screen reads from here.

## OVERVIEW
The single data-layer for the Next.js frontend. All InsForge reads go through hooks in this dir. **No mutation hooks** — writes go through `fetch('/api/functions/<route>', …)` from the components (or the API routes use `insforgeAdmin` directly).

## STRUCTURE
```
lib/queries/
├── index.ts        Barrel — re-exports hooks, helpers, keys, types
├── keys.ts         queryKeys factory + row/item types + page-size constants
├── helpers.ts      useAuthReady() + pure utilities + cross-cutting helpers
└── hooks/
    ├── useOrganization.ts       useOrgMembership(userId), useOrganization(orgId)
    ├── useConversations.ts      useConversations, useInfiniteConversations, useConversation
    ├── useMessages.ts           useMessages, useInfiniteMessages
    ├── useContacts.ts           useContacts, useContact
    ├── useKnowledge.ts          useKnowledgeDocs, useKnowledgeDoc
    ├── useAiDecision.ts         useAiDecision(conversationId) — latest AI decision
    ├── useTeamMembers.ts        useTeamMembers
    └── useSymphony.ts           useSymphonyConversations, useSymphonyCounts, window math, pill/axis helpers
```

## WHERE TO LOOK
- **Add a new query for a resource** → new `use<Resource>.ts` in `hooks/`, register key in `keys.ts`, export from `index.ts`, then use from components.
- **Change page size** → `keys.ts` constants (`CONVERSATION_PAGE_SIZE=25`, `MESSAGE_PAGE_SIZE=50`).
- **Re-sort or post-process a list** → `helpers.ts` (`attachLatestMessages[AndSortConversations]`, `flattenMessagesChronologically`, `getNextPageOffset`).
- **Add a Symphony helper** → `useSymphony.ts` (the file is fat — 100+ LOC of window math, axis ticks, pill/position helpers).

## CRITICAL RULES
1. **Every query hook calls `useAuthReady()` first** to gate fetches until the `AuthProvider` finishes hydrating. Prevents unauthenticated 401s on first paint.
2. **All keys flow through `queryKeys.*`** (in `keys.ts`). Never inline a key array — invalidation breaks.
3. **Hooks return React Query results directly** — components destructure `{ data, isLoading, error }`. No custom wrapper.
4. **Types live in `keys.ts`** (row types like `ConversationListRow`, `MessageListRow`) and are mapped to the public types (`ConversationListItem`, etc.) in `helpers.ts`.

## CONVENTIONS
- **Hook file naming:** `use<Resource>.ts` (one hook or a small set per file).
- **Query key shape:** tuple starting with the resource name, then narrowing args: `['conversations', 'infinite', orgId, filters, pageSize]`.
- **All `insforge.database.from(...)` calls live inside the hooks.** Components never call InsForge directly.
- **No mutation hooks.** All writes are `fetch('/api/functions/<route>', { method: 'POST', body, headers: { Authorization: \`Bearer ${getAccessToken()}\` } })`.
- **`getAccessToken()` is read from the `insforge_access_token` cookie** (see `lib/insforge.ts`).

## ANTI-PATTERNS
- Calling `insforge.database.from(...)` outside a hook in this dir (breaks the data-layer contract).
- Skipping `useAuthReady()` (causes flash-of-unauthenticated 401s).
- Inlining a query key (`['conversations', id]`) instead of using `queryKeys.conversation(id)`.
- Adding a mutation hook (mutations live in `app/api/functions/`).
- Returning raw row types from a hook (map to public types via `attachLatestMessages*`).

## UNIQUE
- **`useSymphony.ts` is the largest hook file** — it carries the Symphony window math, axis ticks, and pill/position helpers in addition to the data hooks.
- **`useAiDecision` returns the latest decision only** — there's no historical fetch (audit trail lives in `audit_logs`).
- **`useAuthReady()` is the cross-cutting auth gate** — every other hook depends on it.
- **The data layer has no caching beyond React Query defaults** (`staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: true` — see `lib/query-provider.tsx`).
- **`useOrganization` exposes `useOrgMembership(userId)` and `useOrganization(orgId)` separately** — components that need both usually call both and merge.

## NOTES
- Adding realtime invalidation: subscribe to `org:${orgId}` channel in the relevant page's component using `useRealtime()` (from `lib/use-realtime.ts`).
- Symphony data hooks bypass the standard pagination — they use window-bounded queries (today/week/month/all) and a `Zoom` type.
