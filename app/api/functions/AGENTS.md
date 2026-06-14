# app/api/functions/ — JWT-Authed Route Handlers

**Always loaded** for any work on an agent-facing API endpoint.

## OVERVIEW
7 Next.js Route Handlers. All `POST`, all JWT-authed via `_auth.ts`, all use the `insforgeAdmin` (service role) client. These are the "agent action" surface — frontend mutations all flow through here.

## THE 7 ROUTES
| Route | InsForge tables touched | Audit log |
|---|---|---|
| `POST /api/functions/send-reply` | `conversations` (read), `messages` (insert outbound), `webchat_threads` (read for broadcast) | — |
| `POST /api/functions/approve-ai-draft` | `ai_decisions` (read), `conversations` (update `ai_state=idle`), `messages` (insert ai-sender), `webchat_threads` (read), `audit_logs` (insert) | `ai_draft_approved` |
| `POST /api/functions/regenerate-ai-draft` | `conversations` (update `ai_state=thinking`), `support_jobs` (insert `process_ai_message`); fires `${FUNCTIONS_URL}/process-jobs` | — |
| `POST /api/functions/escalate-conversation` | `conversations` (update `status=escalated, ai_state=needs_human`) | — |
| `POST /api/functions/resolve-conversation` | `conversations` (update `status=resolved, ai_state=idle`) | — |
| `POST /api/functions/reopen-conversation` | `conversations` (update `status=open, ai_state=idle`) | — |
| `POST /api/functions/test-channel-connection` | `sms_provider_accounts` or `email_provider_accounts` (read) | — |

## SHARED AUTH (`_auth.ts`)
- `getUserFromToken(req)` — extracts Bearer token or `insforge_access_token` cookie, calls `${baseUrl}/api/auth/sessions/current` to verify. Returns `{id}` or `null`. **This is the real auth boundary** (proxy.ts is presence-only).
- `userHasOrgPermission(userId, orgId, perm)` — looks up `organization_members` for the user, returns `hasPermission(role, perm)` from `@support-core/services/rbac`.

## WHERE TO LOOK
- **Add a new agent action** → `app/api/functions/<name>/route.ts`. Pattern:
  1. `getUserFromToken(req)` → 401 if null
  2. Resolve `organization_id` from the target row → `userHasOrgPermission(...)` → 403
  3. Use `insforgeAdmin` (service role) — `insforgeAdmin.database.from(...).update/insert(...)` — bypasses RLS
  4. For webchat replies, broadcast via `POST /realtime/v1/api/broadcast` (fire-and-forget)
  5. Return `NextResponse.json(...)` with the new row / status

## CONVENTIONS
- **Every route is `export async function POST(req: NextRequest)`.** No GET/PUT/DELETE.
- **Always use `insforgeAdmin`** (from `lib/insforge-admin.ts`) — never the browser `insforge` client.
- **All responses are JSON** via `NextResponse.json({...}, { status })`.
- **All errors return a clear shape:** `{ error: 'unauthorized' }` / `{ error: 'forbidden' }` / `{ error: 'missing conversationId' }` / `{ error: '<message>' }`.
- **Webchat broadcast is fire-and-forget** — failures are logged via `console.error`, not thrown (realtime is best-effort).

## ANTI-PATTERNS
- Importing the browser `insforge` client (always use `insforgeAdmin`).
- Adding a `GET`/`PUT`/`DELETE` handler (frontend reads via InsForge).
- Skipping `_auth.ts` (always use `getUserFromToken` + `userHasOrgPermission`).
- Throwing on realtime publish failure.
- Adding a route that needs to bypass `_auth.ts` (always go through it).
- Using the `insforge.admin` client from a `'use client'` file (service role leaks to client).
- Inlining RBAC checks (always use `hasPermission` from `@support-core/services/rbac`).

## UNIQUE
- **All 7 routes are POST-only.** No GET/PUT/DELETE. Consequence: no way to fetch conversation data via the local API — frontend uses the InsForge client.
- **`test-channel-connection` is the only `manage_settings`-permission route** (others need `reply_conversations`).
- **`approve-ai-draft` is the only route that writes to `audit_logs`** from this layer (other audit-log writes happen in Deno functions / services).
- **`regenerate-ai-draft` is the only route that fires a fire-and-forget POST to `${FUNCTIONS_URL}/process-jobs`** to trigger AI re-processing.
- **All routes resolve `orgId` from the target row first** (not from the user session) — multi-org users work transparently.
