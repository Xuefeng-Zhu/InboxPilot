# Frontend

> Next.js 16 App Router, React 19, React Query 5, Tailwind 3.4, InsForge SDK 1.2.

## Stack

| Concern | Tool | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server + Client Components |
| UI | React 19 | Server actions not currently used |
| Styling | Tailwind CSS 3.4 | **Do not upgrade to v4** (see `AGENTS.md`) |
| Data fetching | TanStack Query 5 | `lib/queries/` |
| Auth state | React Context | `lib/auth-context.tsx` |
| Realtime | InsForge Realtime (Socket.IO) | `lib/use-realtime.ts` |
| Server-side DB | `@insforge/sdk` with service role | `lib/insforge-admin.ts` |
| Client-side DB | `@insforge/sdk` with anon key | `lib/insforge.ts` |
| Markdown | `react-markdown` + `remark-gfm` | For KB document display |

## Project layout

```
app/                          # Pages (App Router)
  layout.tsx                  # Wraps with <AuthProvider> + <QueryProvider>
  page.tsx                    # Marketing landing
  login/                      # /login
  register/                   # /register (with workspace creation)
  forgot-password/            # /forgot-password
  reset-password/             # /reset-password
  inbox/                      # /inbox and /inbox/kanban
  knowledge/                  # /knowledge — KB management
  analytics/                  # /analytics
  settings/                   # /settings (AI, SMS, email, web chat, team)
  customers/                  # /customers
  team/                       # /team — members list
  symphony/                   # /symphony — timeline inbox
  wchat/[widgetId]/           # Widget iframe content
  api/functions/              # 12 InsForge-verified, RBAC-checked routes
components/
  inbox/                      # Conversation list, thread, AI draft panel, etc.
  knowledge/                  # KB table, editor, document content
  customers/                  # Customer table, modals
  layout/                     # AppShell, Sidebar, AuthGuard, NavItem
  landing/                    # Marketing landing
  ui/                         # Button, Card, Input, Select, etc.
lib/
  insforge.ts                 # Browser client (anon key)
  insforge-admin.ts           # Server-side client (service role)
  auth-context.tsx            # <AuthProvider>, useAuth()
  query-provider.tsx          # <QueryProvider> wrapping <QueryClientProvider>
  queries/                    # keys, helpers, and feature-scoped query hooks
    index.ts                  # public query-hook exports
    keys.ts                   # tenant-aware query keys
    helpers.ts                # shared pagination and auth helpers
    hooks/                    # feature-specific hooks
  use-realtime.ts             # useRealtime() hook (Socket.IO)
  onboarding.ts               # createOrganizationWithOwner() (calls the SQL RPC)
proxy.ts                      # Auth redirect for protected routes
```

## Data flow

```mermaid
flowchart LR
  Page["Server Component (page.tsx)"]
  Client["Client Component ('use client')"]
  Hook["useConversations() / etc."]
  Q[("React Query cache")]
  Insforge["insforge.database.from(...)"]
  DB[("Postgres / PostgREST")]
  RT["lib/use-realtime.ts"]
  Socket[("InsForge Realtime")]

  Page --> Client
  Client --> Hook
  Hook --> Q
  Q --> Insforge
  Insforge --> DB
  RT -.subscribes.-> Socket
  Socket -. invalidates queries .-> Q
```

## Auth context

`lib/auth-context.tsx` provides `useAuth()` returning `{ user, loading, signIn, signUp, signOut }`.

- On mount, the provider calls `insforge.auth.getCurrentUser()` to hydrate.
- After `signIn`, the access token is mirrored to the `insforge_access_token` cookie. It is a session cookie unless Remember me is selected, in which case it lasts seven days. Sign-up uses the seven-day cookie. SDK token refreshes are mirrored back to a session cookie by `lib/insforge.ts`.
- `proxy.ts` allows auth/recovery pages (`/`, `/login`, `/register`, `/forgot-password`, `/reset-password`), webchat/function/API paths, and static assets. Other paths redirect to `/login` when the cookie is missing.

### Auth gating

- **Server-side**: `proxy.ts` redirects unauthenticated users on protected paths.
- **Client-side**: `useAuth()` returns `loading` until hydration; pages can early-return a spinner.
- **API routes**: `app/api/functions/_auth.ts` verifies the access token with InsForge before using the service-role client, then checks org membership permissions for the requested action.

## React Query conventions

`lib/queries/keys.ts` defines tenant-aware query keys, `lib/queries/helpers.ts` contains shared helpers such as `useAuthReady()`, and `lib/queries/hooks/` contains feature-scoped hooks. `lib/queries/index.ts` is the public barrel. Hooks gate requests until authentication and required identifiers are ready.

### Query keys

```ts
export const queryKeys = {
  conversations: (orgId, filters) => ['conversations', orgId, filters],
  conversationsInfinite: (orgId, filters, pageSize) =>
    ['conversations', 'infinite', orgId, filters, pageSize],
  messages: (conversationId) => ['messages', conversationId],
  messagesInfinite: (conversationId, pageSize) =>
    ['messages', 'infinite', conversationId, pageSize],
  conversation: (id) => ['conversation', id],
  contacts: (orgId, filters) => ['contacts', orgId, filters],
  contact: (orgId, id) => ['contact', orgId, id],
  knowledgeDocs: (orgId) => ['knowledge-documents', orgId],
  knowledgeDoc: (orgId, id) => ['knowledge-document', orgId, id],
  teamMembers: (orgId) => ['team-members', orgId],
  teamMemberInfo: (orgId) => ['team-member-info', orgId],
  organization: (orgId) => ['organization', orgId],
  aiDecision: (conversationId) => ['ai-decision', conversationId],
  aiDecisionsForConversation: (conversationId) =>
    ['ai-decisions', conversationId],
  orgMembership: (userId) => ['org-membership', userId],
  conversationCounts: (orgId) => ['conversation-counts', orgId],
  inboxSublineCounts: (orgId) => ['inbox-sublime-counts', orgId],
  symphonyConversations: (orgId, zoom) =>
    ['symphony-conversations', orgId, zoom],
  symphonyCounts: (orgId, zoom) => ['symphony-counts', orgId, zoom],
  kanbanLanes: (orgId, userId) => ['kanban-lanes', orgId, userId],
  auditLogs: (orgId, filters) => ['audit-logs', orgId, filters],
};
```

### Available hooks

| Hook | Returns | Notes |
|---|---|---|
| `useOrgMembership(userId)` / `useCurrentMembership(userId)` | Organization id / membership | Resolve the current user's first organization and role. |
| `useOrganization(orgId)` | `Organization` | Organization name, slug, and SLA thresholds. |
| `useConversations(orgId, filters?)` | `Conversation[]` | Filters: `status`, `channel`, `contactId`, `search`. Excludes `status = 'resolved'` by default. Joins `contacts(*)`. |
| `useInfiniteConversations(orgId, filters?)` | Paginated conversations | The inbox's 25-row infinite query. |
| `useConversation(conversationId)` | `Conversation` (with contact) | Single conversation with joined contact. |
| `useMessages(conversationId)` / `useInfiniteMessages(conversationId)` | Messages | Chronological list or 50-row infinite query. |
| `useContacts(filters?)` | `Contact[]` | |
| `useContact(contactId)` | `Contact` | |
| `useAiDecision(conversationId)` / `useAiDecisionsForConversation(conversationId)` | AI decisions | Latest draft or complete conversation decision history. |
| `useKnowledgeDocs()` | `KnowledgeDocument[]` | `staleTime: 0` so updates show up immediately. |
| `useKnowledgeDoc(docId)` | `KnowledgeDocument` | |
| `useTeamMembers()` / `useTeamMemberInfo()` | Memberships / profile details | The second hook enriches members through the authorized server route. |
| `useAuditLogs(filters?)` / `useConversationAuditTrail(conversationId)` | Audit rows | Tenant-scoped audit queries and a deduplicated conversation trail. |
| `useSymphonyConversations(orgId, zoom)` / `useSymphonyCounts(orgId, zoom)` | Timeline data | Windowed Symphony rows and counts. |

### Default React Query config

`lib/query-provider.tsx` sets `staleTime: 30_000`, `refetchOnWindowFocus: true`, `retry: 1`.

## Calling the backend

Frontend code uses three patterns to talk to the backend:

### 1. Direct DB reads (via `insforge.database.from()`)

For read-only queries that should be subject to RLS. Use the chainable SDK API:

```ts
const { data, error } = await insforge.database
  .from('conversations')
  .select('*, contacts(*)')
  .eq('organization_id', orgId)
  .order('last_message_at', { ascending: false });

if (error) throw new Error(error.message);
```

Always use `.from('table').select().eq().order()` — never raw `fetch()` to PostgREST.

### 2. Server-side writes (via Next.js API routes)

For writes, call the local Next.js route (`/api/functions/<name>`) using the access token:

```ts
const res = await fetch('/api/functions/send-reply', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAccessToken()}`,
  },
  body: JSON.stringify({ conversationId, body }),
});
```

The access token comes from `getAccessToken()` in `lib/insforge.ts`, which reads and URL-decodes the `insforge_access_token` cookie. The SDK keeps its own in-memory auth state; the custom fetch wrapper mirrors refreshed access tokens into the cookie for local API calls and `proxy.ts`.

### 3. InsForge Realtime events

Use the `useRealtime()` hook in pages that should react to live updates:

```ts
useRealtime({
  messageChannel: `org:${orgId}`,
  conversationChannel: `org:${orgId}`,
  onNewMessage: (payload) => { /* e.g. refetch messages */ },
  onConversationUpdated: (payload) => { /* refetch conversation */ },
});
```

The hook subscribes via `insforge.realtime.connect()` / `.subscribe()` and unsubscribes on unmount. It tracks callbacks in a ref so changing handlers don't reset the subscription.

## InsForge SDK patterns

- **Auth**: `insforge.auth.signInWithPassword({ email, password })`, `insforge.auth.signUp({ email, password })`, `insforge.auth.getCurrentUser()`, `insforge.auth.signOut()`. All return `{ data, error }`.
- **Database**: `insforge.database.from('table').select()...`. Insert takes an array: `insert([{ ... }])`.
- **Realtime**: `insforge.realtime.connect()`, `subscribe(channel)`, `on(event, handler)`, `off(event, handler)`, `unsubscribe(channel)`.
- **Functions**: invoked via raw `fetch()` to `${INSFORGE_URL}/functions/v1/<name>` with `apikey` and `Authorization` headers — but the **frontend usually does not call Deno functions directly**; it goes through the local `/api/functions/*` routes.

## Adding a new page

1. Create `app/your-page/page.tsx`.
2. If the page needs auth, it can be a client component that uses `useAuth()` and early-returns while `loading` or while `!user`.
3. If the page needs data, prefer an existing export from `lib/queries/`; add a feature hook under `lib/queries/hooks/` if needed.
4. Use Tailwind for styling. **Do not upgrade to v4.**
5. If the page should be public, add the path to `PUBLIC_PATHS` in `proxy.ts` and add proxy coverage.

## Known gotchas

- **Real-time channel names** — app code subscribes to `org:{orgId}` channels, which match the InsForge functions' published events. The hook also listens for legacy `message_created` events for compatibility.
- **Proxy checks cookie presence only** — protected API handlers perform the real token verification with InsForge and then apply permission checks. Do not treat `proxy.ts` as the authorization boundary.
