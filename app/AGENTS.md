# app/ — Next.js App Router

**Always loaded** for any work on a page, layout, or API route.

## OVERVIEW
12 page routes + 8 API routes. Auth gating happens at three layers: `proxy.ts` (cookie check), `<AppShell>` (client wrapper), `_auth.ts` (server-side JWT verification for API routes). **No `loading.tsx` or `error.tsx` files** — loading via inline `<Suspense>`, errors via Next's default UI. **No nested `layout.tsx`** — every authed page wraps itself in `<AppShell>`.

## PAGES (12 total)
| Path | Auth | Notes |
|---|---|---|
| `/` | Public | Landing page; loads `/widget.js` if `NEXT_PUBLIC_DEMO_WIDGET_ID` set |
| `/login`, `/register` | Public | Auth forms; on success → `/inbox` |
| `/inbox` | Required | 3-pane shell (filters+list / thread / right panel) |
| `/knowledge` | Required | List with search + type filters |
| `/knowledge/[id]` | Required | Read/edit/delete; queues `process_knowledge_document` on save |
| `/analytics` | Required | KPI cards + volume chart + channel split (7d/30d/quarter) |
| `/settings` | Required | 7 tabs via `?tab=ai\|email\|sms\|webchat\|team\|billing\|audit`; team/billing/audit are placeholders |
| `/customers` | Required | List with search + email/phone filters + edit/delete modals |
| `/team` | Required | Members list (Edit Role/Remove buttons are presentational, not wired) |
| `/symphony` | Required | **Undocumented** — alternate inbox viz (River + MiniMap + TimeAxis) |
| `/wchat/[widgetId]` | Public | Web chat widget iframe; visitor-token auth, no app shell |
| `/not-found` | — | 404 handler (custom branded) |

## API ROUTES (8 total — all POST-only, all in `api/functions/`)
| Path | Body | Required perm | Side effects |
|---|---|---|---|
| `POST /api/functions/send-reply` | `{conversationId, body}` | `reply_conversations` | Insert outbound `messages`; for webchat, broadcast to `widget:{widgetId}:{jti}` |
| `POST /api/functions/approve-ai-draft` | `{conversationId, aiDecisionId, body?}` | `reply_conversations` | Insert `messages` (sender_type=ai); `ai_state=idle`; broadcast if webchat; audit `ai_draft_approved` |
| `POST /api/functions/regenerate-ai-draft` | `{conversationId}` | `reply_conversations` | Atomic pending-decision claim + `process_ai_message` enqueue; best-effort awaited trigger to `process-jobs` |
| `POST /api/functions/escalate-conversation` | `{conversationId}` | `reply_conversations` | `status=escalated, ai_state=needs_human` |
| `POST /api/functions/resolve-conversation` | `{conversationId}` | `reply_conversations` | `status=resolved, ai_state=idle` |
| `POST /api/functions/reopen-conversation` | `{conversationId}` | `reply_conversations` | `status=open, ai_state=idle` |
| `POST /api/functions/test-channel-connection` | `{channelType, providerAccountId}` | `manage_settings` | Pings the provider via `healthCheck()` (no real outbound send); loads credentials from InsForge secrets via `getSecret()`; returns `{status, data: {ok, message|reason, provider, active}}` |
| `POST /api/functions/delete-widget` | `{organizationId, widgetId}` | `manage_settings` | Delete `webchat_widgets` row; FK cascade wipes linked `webchat_threads` (conversations/contacts are not cascade-deleted); audit `webchat_widget_deleted` (only surviving record) |

## AUTH GATING — 3 LAYERS
1. **`proxy.ts`** at root: cookie-presence check. Public: `/`, `/login`, `/register`. Pass-through: `/_next/*`, `/api/*`, `/functions/*`, `/wchat/*`, anything with `.`. Gated: everything else (redirects to `/login` if cookie missing). **Note: cookie presence only, not JWT validation.**
2. **`<AppShell>` + `<AuthGuard>`** in `components/layout/`: client-side check showing "Please sign in" if `useAuth().user` is null after hydration.
3. **`app/api/functions/_auth.ts`**: server-side. `getUserFromToken(req)` calls `/api/auth/sessions/current` to verify the JWT (the **real auth boundary**). `userHasOrgPermission(userId, orgId, perm)` looks up `organization_members` and calls `hasPermission(role, perm)` from `@support-core/services/rbac`.

## WHERE TO LOOK
- **Add a new page** → `app/<route>/page.tsx`. Auto-gated by `proxy.ts` unless path is in PUBLIC_PATHS.
- **Add a new API route** → `app/api/functions/<name>/route.ts`. Use `_auth.ts` for auth + RBAC. Always `POST`.
- **Add a new settings tab** → `app/settings/page.tsx` (it's a single client component with internal tab routing via `?tab=`). Note: `team`/`billing`/`audit` are placeholder `<PlaceholderCard>` with stale "Coming soon to the redesign" copy.
- **Add the Symphony view to docs/README.md** — it's not listed in any docs.

## CONVENTIONS
- **Every page that needs auth wraps itself in `<AppShell>`** (or `<AppShell noPadding>` for inbox/symphony). No nested layouts.
- **Loading state via inline `<Suspense fallback={…}>`** when using `useSearchParams` (inbox, symphony, settings).
- **Every API route uses `getUserFromToken()` + `userHasOrgPermission()`** from `_auth.ts`. Pattern:
  ```ts
  const user = await getUserFromToken(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!await userHasOrgPermission(user.id, orgId, 'reply_conversations')) return …403;
  ```
- **API routes use `insforgeAdmin`** (service role) for these privileged actions — bypasses RLS by design.
- **API routes are all `POST`** — no GET/PUT/DELETE. Frontend reads via the InsForge client (chainable SDK), not via local API.

## ANTI-PATTERNS
- Adding a `GET`/`PUT`/`DELETE` API route (frontend reads via InsForge).
- Bypassing `_auth.ts` (always go through it for RBAC).
- Importing `lib/insforge-admin.ts` from a `'use client'` file (service role leaks to client).
- Hardcoding a route in the `proxy.ts` PUBLIC_PATHS (security risk).
- Adding a nested `layout.tsx` (project convention is to wrap with `<AppShell>` directly).
- Adding a `loading.tsx` / `error.tsx` (project convention is inline `<Suspense>` and Next's default UI).

## UNIQUE
- **`app/symphony/` is fully built and now partially documented** — River of cards + minimap + zoomable time axis. Has its own 7 components, 5 tests, and a data hook (`useSymphony.ts`). Linked from Sidebar. A reference page exists at `docs/reference/symphony.md`; it is not yet in the root `README.md` or any `AGENTS.md` summary.
- **`app/wchat/[widgetId]/page.tsx` is the only public authed-content page** — it lives outside the agent shell and uses visitor JWT auth (in URL `?t=`).
- **`/settings` `team`/`billing`/`audit` tabs are placeholders** with stale "old settings page" copy. The real team UI is at `/team`.
- **`/team` Edit Role/Remove buttons are presentational only.**
- **No `middleware.ts`** — auth gate is `proxy.ts` (Next.js 16 convention), with coverage in `__tests__/proxy.test.ts`.
- **`app/symphony/page.tsx` uses `useSearchParams`** (for the `?zoom=` param), which requires the `<Suspense>` boundary.
- **All 8 API routes are POST-only** — a deliberate consequence of "agent action" model.
