# app/api/functions/ — JWT-Authed Route Handlers

**Always loaded** for any work on an agent-facing API endpoint.

## OVERVIEW
12 Next.js Route Handlers. All `POST`, all JWT-authed via `_auth.ts`, all use the `insforgeAdmin` (service role) client. These are the "agent action" surface — frontend mutations all flow through here.

## THE 12 ROUTES
| Route | InsForge tables touched | Audit log | Notes |
|---|---|---|---|
| `POST /api/functions/send-reply` | `conversations` (read), `messages` (insert outbound), `webchat_threads` (read for broadcast) | — | Permission: `reply_conversations` |
| `POST /api/functions/approve-ai-draft` | `ai_decisions` (read), `conversations` (owner-bound claim/restore/finish RPCs), `messages` (insert ai-sender), `webchat_threads` (read), `audit_logs` (insert) | `ai_draft_approved` | Permission: `reply_conversations`; only the exact pending decision can dispatch |
| `POST /api/functions/regenerate-ai-draft` | `conversations` + `support_jobs` through one atomic pending-decision claim/enqueue RPC; triggers `${FUNCTIONS_URL}/process-jobs` with a 1.5s bound | — | Permission: `reply_conversations`; approval/regeneration races return `409` to the loser |
| `POST /api/functions/escalate-conversation` | `conversations` (update `status=escalated, ai_state=needs_human`), `audit_logs` | `conversation_escalated` | Permission: `reply_conversations` |
| `POST /api/functions/resolve-conversation` | `conversations` (update `status=resolved, ai_state=idle`), `audit_logs` | `conversation_resolved` | Permission: `reply_conversations` |
| `POST /api/functions/reopen-conversation` | `conversations` (update `status=open, ai_state=idle`), `audit_logs` | `conversation_reopened` | Permission: `reply_conversations` |
| `POST /api/functions/test-channel-connection` | `sms_provider_accounts` or `email_provider_accounts` (read) | — | Permission: `manage_settings` (the only one). Pings the provider via `health-check.ts`; loads credentials from InsForge secrets API (`getSecret`); returns `{status, data: {ok, message|reason, provider, active}}` |
| `POST /api/functions/change-member-role` | `organization_members`, `audit_logs` | `member_role_changed` | **Uses the support-core service layer.** Permission: `manage_members`, plus an owner-only gate when the target is currently an owner or the new role is `owner` (P1). |
| `POST /api/functions/invite-member` | `organization_members`, `audit_logs` | `member_added` | **Uses the support-core service layer.** Takes an email, looks up the user via the InsForge admin REST endpoint, then calls `OrganizationService.inviteMember`. Permission: `manage_members`. |
| `POST /api/functions/remove-member` | `organization_members`, `audit_logs` | `member_removed` | **Uses the support-core service layer.** Permission: `manage_members`, plus an owner-only gate when the target is an owner (P1). |
| `POST /api/functions/delete-widget` | `webchat_widgets`, `audit_logs` | `webchat_widget_deleted` | **Uses the support-core service layer.** Permission: `manage_settings`. Service enforces that the widget's `organizationId` matches the caller's authorized org (cross-tenant guard — RLS is bypassed by the service-role client). FK cascade wipes `webchat_threads` only; conversations/contacts are not affected. The audit log is the only surviving record of the widget. |
| `POST /api/functions/team-member-info` | `organization_members` (read), admin REST `GET /api/auth/users` | — | **Enrichment read for the team panel.** Returns `{ id, email, name, avatarUrl }` per team member. Permission: `manage_members` (the response includes member emails, so the directory is owner/admin-only). |

## SHARED AUTH (`_auth.ts`)
- `getUserFromToken(req)` — extracts Bearer token or `insforge_access_token` cookie, calls `${baseUrl}/api/auth/sessions/current` to verify. Returns `{id}` or `null`. **This is the real auth boundary** (proxy.ts is presence-only).
- `userHasOrgPermission(userId, orgId, perm)` — looks up `organization_members` for the user, returns `hasPermission(role, perm)` from `@support-core/services/rbac`.

## SHARED ADAPTER (`_insforge-db-adapter.ts`)
- `createInsforgeDbAdapter()` — adapts the InsForge Node SDK (PostgREST chainable) to the support-core `DatabaseClient` interface. Used by the five service-layer routes (`change-member-role`, `invite-member`, `remove-member`, `delete-widget`, and any future support-core-backed route). `rpc()` is not implemented and throws if called.

## WHERE TO LOOK
- **Add a new agent action** → `app/api/functions/<name>/route.ts`. Pattern:
  1. `getUserFromToken(req)` → 401 if null
  2. Resolve `organization_id` from the target row → `userHasOrgPermission(...)` → 403
  3. Use `insforgeAdmin` (service role) — `insforgeAdmin.database.from(...).update/insert(...)` — bypasses RLS
  4. For webchat replies, use `publishRealtimeMessage(...)` and log best-effort failures
  5. Return `NextResponse.json(...)` with the new row / status
- **Add a new team/admin mutation** → prefer routing through `OrganizationService` in support-core (mirrors the 3 existing team routes). The service enforces the audit-log actor and business invariants (single-owner, last-owner guard).

## CONVENTIONS
- **Every route is `export async function POST(req: NextRequest)`.** No GET/PUT/DELETE.
- **Always use `insforgeAdmin`** (from `lib/insforge-admin.ts`) — never the browser `insforge` client.
- **All responses are JSON** via `NextResponse.json({...}, { status })`.
- **All errors return a clear shape:** `{ error: 'unauthorized' }` / `{ error: 'forbidden' }` / `{ error: 'missing conversationId' }` / `{ error: '<message>' }`.
- **Webchat broadcast is awaited but best-effort** — failures are logged and do not fail the reply.
- **Team-mutation routes pass `user.id` as `actorId` to the service** — never let the service infer the actor (the previous bug was that the service wrote the *target's* `userId` to the audit log).
- **Owner transfers are owner-only.** Any route that can promote to or demote from `owner` must check `userHasOrgPermission(..., 'delete_org')` (owner-only) before allowing the change — `manage_members` is not enough since admins have it.

## ANTI-PATTERNS
- Importing the browser `insforge` client (always use `insforgeAdmin`).
- Adding a `GET`/`PUT`/`DELETE` handler (frontend reads via InsForge).
- Skipping `_auth.ts` (always use `getUserFromToken` + `userHasOrgPermission`).
- Throwing on realtime publish failure.
- Adding a route that needs to bypass `_auth.ts` (always go through it).
- Using the `insforge.admin` client from a `'use client'` file (service role leaks to client).
- Inlining RBAC checks (always use `hasPermission` from `@support-core/services/rbac`).
- Letting an admin promote to or demote from `owner` — `manage_members` is not sufficient.

## UNIQUE
- **All 12 routes are POST-only.** No GET/PUT/DELETE. Consequence: no way to fetch conversation data via the local API — frontend uses the InsForge client.
- **The 4 team routes use the support-core service layer** (`OrganizationService.inviteMember` / `changeMemberRole` / `removeMember`). All other routes call `insforgeAdmin.database.from(...)` directly. This is the only place in the app that bridges from a Next.js route handler to support-core.
- **`test-channel-connection` is the only conversation-touching route with `manage_settings`** (others need `reply_conversations`).
- **`team-member-info` is the only read route** — it doesn't mutate state, just enriches the team panel with email/name for display.
- **Conversation state, team, widget deletion, and AI-draft approval routes write to `audit_logs`.** If a conversation state is already persisted and the audit write fails, return an accepted warning instead of a false mutation failure.
- **`regenerate-ai-draft` awaits the `${FUNCTIONS_URL}/process-jobs` trigger for at most 1.5 seconds** after enqueueing; trigger failures are logged and left for the scheduler because the job row is already durable.
- **All routes resolve `orgId` from the request body** (not from the user session) — multi-org users work transparently.
