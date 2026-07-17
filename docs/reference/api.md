# API Reference

> Two parallel surfaces: **9 InsForge Deno Functions** (webhooks + scheduled jobs) and **12 Next.js API Routes** under `/api/functions/*` (InsForge-verified, RBAC-checked frontend actions).

## Overview

InboxPilot exposes two distinct HTTP surfaces. The split is deliberate: webhook receivers and scheduled jobs run as Deno Functions on InsForge; user-initiated actions that need fast iteration live as Next.js Route Handlers alongside the frontend.

| Surface | Where | Count | Auth |
|---|---|---|---|
| **InsForge Deno Functions** | `insforge/functions/*/index.ts` | 9 | Webhook signature, Visitor JWT, or none (internal) |
| **Next.js API Routes** | `app/api/functions/*/route.ts` | 12 | InsForge session verification + org RBAC |

All response bodies are JSON. Errors use this shape:

```json
{ "error": "Human-readable error message", "message": "Detailed description (on 500 errors)" }
```

| Status | Meaning |
|---|---|
| `200` | Success (or `200 + { message: "..." }` for acknowledged-but-no-op cases like `sms-status` with unknown message ID) |
| `400` | Bad request (missing/invalid parameters, invalid JSON) |
| `401` | Unauthorized (invalid JWT or webhook signature) |
| `403` | Forbidden (origin not allowed, widget inactive) |
| `404` | Resource not found |
| `405` | Method not allowed |
| `429` | Rate limited |
| `500` | Internal server error |

### Auth shared helpers

- **InsForge user JWT** (Deno functions) — `insforge/functions/_shared/verify-jwt.ts` (used by webhook handlers that the frontend invokes indirectly, though currently no Deno function is JWT-authed; the JWT-authed actions live in the Next.js routes).
- **Visitor JWT** (webchat) — `insforge/functions/_shared/verify-visitor-jwt.ts`. HS256 signed with the widget's `hmac_secret`. Claims: `sub` (contactId), `org`, `widget`, `thread`, `jti`, `iat`, `exp`. Verification also checks the thread's current `visitor_token_jti` matches the JWT's `jti` (rotation enforcement).
- **Same-origin JWT** (Next.js API routes) — `app/api/functions/_auth.ts` sends the cookie/header bearer token to InsForge session verification before returning a user id. Routes that mutate org resources also check membership permissions before using the service-role client.

---

## InsForge Deno Functions (9)

These live in `insforge/functions/<name>/index.ts` and are deployed as Deno Functions on InsForge. Path: `/functions/v1/<name>`.

### sms-inbound

Handles inbound SMS webhooks from providers.

- **Auth**: Webhook signature verification via the provider adapter.
- **Headers required**: `x-provider`. The receiving number must resolve to an active account for the same provider; the function derives the organization from that route and never trusts a caller-supplied organization. Real providers resolve the signing secret through the route's `credentials_secret_id`. The mock adapter is available only with explicit opt-in and loopback request/base URLs, never on a deployed endpoint.

**Request body** (provider-shaped; normalized by the adapter):

```json
{
  "From": "+15551234567",
  "To": "+15559876543",
  "Body": "Hello, I need help",
  "MessageSid": "SM1234567890"
}
```

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "conversationId": "uuid",
    "senderType": "contact",
    "direction": "inbound",
    "channel": "sms",
    "body": "Hello, I need help",
    "deliveryStatus": "delivered",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Side effects**: Creates/updates contact, creates/updates conversation, inserts message, enqueues `process_ai_message` job, writes `audit_logs` row (`action: 'message_received'`), publishes `new_message` on `org:{orgId}`. AI processing is picked up by the scheduled `process-jobs` worker.

**Error responses**: `400` (invalid webhook body, unknown provider), `401` (provider account not found or signature verification failed), `404` (could not determine org for receiving phone number), `500`.

### sms-status

Tracks SMS delivery status updates from providers.

- **Auth**: Webhook signature verification.
- **Headers**: `x-provider`. The handler resolves the provider account from the stored outbound message before verifying the callback. Missing providers fail closed; the mock adapter is allowed only under the explicit loopback development guard used by inbound handlers.

**Request body** (provider-shaped; normalized by the adapter):

```json
{ "MessageSid": "SM1234567890", "MessageStatus": "delivered" }
```

**Response (200, found):**

```json
{ "status": "ok", "data": { "messageId": "uuid", "deliveryStatus": "delivered" } }
```

**Response (200, not found):**

```json
{ "status": "ok", "message": "Message not found, status ignored" }
```

**Side effects (found)**: Inserts `sms_delivery_events` row, updates `messages.delivery_status`.

### email-inbound

Handles inbound email webhooks from providers.

- **Auth**: Webhook signature verification.
- **Headers required**: `x-provider`. The receiving address must resolve to an active account for the same provider; the function derives the organization from that route and never trusts a caller-supplied organization. Real providers resolve the signing secret through the route's `credentials_secret_id`. The mock adapter is local-only under the same explicit loopback guard as `sms-inbound`.

**Request body** (Postmark-shaped):

```json
{
  "From": "customer@example.com",
  "To": "support@company.com",
  "Subject": "Order issue",
  "TextBody": "I have a problem with my order",
  "MessageID": "msg-abc-123"
}
```

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "conversationId": "uuid",
    "senderType": "contact",
    "direction": "inbound",
    "channel": "email",
    "body": "I have a problem with my order",
    "subject": "Order issue",
    "deliveryStatus": "delivered",
    "createdAt": "..."
  }
}
```

**Side effects**: Same as `sms-inbound` but for email channel. Org lookup uses `email_addresses.email_address`.

### email-status

Same pattern as `sms-status`, including its explicit-provider and local-only mock rules, but for email delivery events (`email_delivery_events`).

### process-jobs

Claims and processes pending jobs from the queue. Designed to be called on a schedule or manually.

- **Auth**: None (uses service role key from env).
- **Trigger**: Cron / scheduler / manual HTTP call.
- **Method**: POST (no body required).
- **Path**: `/functions/v1/process-jobs` (invoked by the scheduler or manually; inbound functions only enqueue jobs).

**Response (200):**

```json
{
  "status": "ok",
  "claimed": 3,
  "results": [
    { "jobId": "uuid", "jobType": "process_ai_message", "status": "completed" },
    { "jobId": "uuid", "jobType": "send_outbound_message", "status": "completed" }
  ]
}
```

Quarantined or persistence-failure results use HTTP 500 with
`"status": "reconciliation_required"` so operators are alerted without
automatically replaying customer-facing side effects.

**Behaviour**: Claims up to **10 jobs per invocation** via `claim_support_jobs(10)`. Routes each to a handler by `job_type`. Implemented handlers are `process_ai_message` (full AI pipeline), `process_knowledge_document` (chunk + embed), `send_outbound_message` (AI auto-reply fallback through `OutboundMessageService`), and `record_chunk_refs` (persist grounding citations). `process_delivery_status` and `retry_failed_jobs` remain explicit unsupported retry paths. Handler failures are retried with exponential backoff via `PostgresJobQueue.fail()`. Non-retryable outcomes and completion-write failures are quarantined rather than replayed; persistence failures make the worker return HTTP 500 with `status='reconciliation_required'`. See [`jobs.md`](jobs.md).

### webchat-thread-init

Initializes a webchat session for a visitor. Returns a visitor JWT.

- **Auth**: Widget token via `x-widget-token` header. **Origin** verified against `widget.allowed_domains` (empty = allow all; supports `*.example.com` wildcards).
- **CORS**: Handles `OPTIONS` preflight; CORS headers on response.
- **Method**: POST.

**Request body (optional):**

```json
{
  "page_url": "https://example.com/landing",
  "referrer": "https://google.com/",
  "user_agent": "Mozilla/5.0 ...",
  "pre_chat": { "name": "Alice", "email": "alice@example.com" }
}
```

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "visitorToken": "eyJhbGciOiJIUzI1NiJ9...",
    "threadId": "uuid",
    "conversationId": "uuid",
    "contactId": "uuid",
    "preChatEnabled": false,
    "history": [
      { "id": "uuid", "body": "...", "sender_type": "contact", "created_at": "..." }
    ]
  }
}
```

**Side effects**: If `pre_chat.email` is present, reuses an existing contact by email (and updates name if missing). Creates a new contact otherwise. Creates a `conversations` row with `channel='webchat'`, creates a `webchat_threads` row with a fresh `visitor_token_jti`, signs the visitor JWT using the widget's `hmac_secret`, and inserts the greeting as a system message if configured. Writes `audit_logs` row (`action: 'webchat_thread_created'`).

**Error responses**: `400` (missing widget token), `403` (origin not allowed), `404` (invalid or inactive widget), `405`.

### webchat-inbound

Handles inbound webchat messages from visitors.

- **Auth**: Visitor JWT via `Authorization: Bearer` header. Verified against the widget's `hmac_secret` and the thread's current `visitor_token_jti`.
- **CORS**: Handled.
- **Anti-flood**: 10 messages/minute per thread (in-memory, per worker).
- **Method**: POST.

**Request body:**

```json
{ "text": "Hello, I need help with my order", "page_url": "https://example.com/landing" }
```

**Response (200):**

```json
{ "status": "ok", "data": { "message": { /* message row */ }, "conversationId": "uuid" } }
```

**Side effects**: Updates `webchat_threads.last_seen_at` (and `page_url` if provided), inserts inbound message (`channel='webchat'`), enqueues `process_ai_message`, publishes `new_message` on `org:{orgId}`, writes `audit_logs` row (`action: 'message_received'`). AI processing is picked up by the scheduled `process-jobs` worker.

**Error responses**: `400` (missing `text`), `401` (invalid visitor JWT), `403` (widget inactive), `429` (rate limited), `405`.

### webchat-identify

Identifies a visitor by email/name. Rotates the visitor token JTI (invalidates the old JWT).

- **Auth**: Visitor JWT.
- **Method**: POST.

**Request body:**

```json
{ "email": "alice@example.com", "name": "Alice" }
```

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "visitorToken": "eyJ... (new)",
    "contact": { "id": "uuid", "name": "Alice", "email": "alice@example.com" }
  }
}
```

**Side effects**: Updates contact with email/name, rotates `webchat_threads.visitor_token_jti`, sets `identified_at`, writes `audit_logs` row (`action: 'webchat_thread_identified'`).

### webchat-session-info

Returns the current thread state and message history for thread resumption (e.g. on iframe reload).

- **Auth**: Visitor JWT.
- **Method**: GET.

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "thread": {
      "id": "uuid",
      "conversationId": "uuid",
      "pageUrl": "https://...",
      "identifiedAt": "2024-01-01T00:00:00.000Z" /* or null */
    },
    "contact": { "id": "uuid", "name": "...", "email": "...", "phone": "..." },
    "history": [
      { "id": "uuid", "body": "...", "sender_type": "user", "direction": "outbound", "created_at": "..." }
    ]
  }
}
```

Limits to 100 most recent messages.

---

## Next.js API Routes (12)

These live in `app/api/functions/<name>/route.ts` and are served from the same Next.js app as the frontend. Path: `/api/functions/<name>`. Auth: same-origin JWT (cookie or `Authorization: Bearer`), validated by `_auth.ts`.

Routes authenticate the InsForge session and check the required organization permission before using trusted server-side database access. Conversation mutations require `reply_conversations`; team mutations require `manage_members`; provider/widget mutations require `manage_settings`. Ownership promotion, demotion, or removal also requires the owner-only `delete_org` permission.

| Route | Purpose |
|---|---|
| `send-reply` | Dispatch an agent reply through SMS, email, or webchat |
| `approve-ai-draft` | Dispatch an approved or edited AI draft |
| `regenerate-ai-draft` | Queue a replacement draft |
| `escalate-conversation` | Escalate a conversation |
| `resolve-conversation` | Resolve a conversation |
| `reopen-conversation` | Reopen a conversation |
| `test-channel-connection` | Run the configured provider adapter health check |
| `invite-member` | Add an existing InsForge user to the organization |
| `change-member-role` | Change a member role or transfer ownership |
| `remove-member` | Remove an organization member |
| `team-member-info` | Enrich member rows with safe auth-profile fields |
| `delete-widget` | Delete a webchat widget through the audited service path |

### POST /api/functions/send-reply

Sends a reply message on an existing conversation.

**Request body:**

```json
{ "conversationId": "uuid", "body": "Thanks for reaching out!" }
```

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "conversationId": "uuid",
    "senderType": "user",
    "direction": "outbound",
    "channel": "sms|email|webchat",
    "body": "...",
    "deliveryStatus": "queued|sent",
    "createdAt": "..."
  }
}
```

**Behaviour by channel**:
- **SMS / email** — loads the organization's configured default route and provider secret, dispatches through `OutboundMessageService`, then records the real provider id/status. Provider failures reject the request instead of creating a false sent message.
- **Webchat** — `provider = 'webchat'`, `delivery_status = 'sent'`. Publishes `new_message` on the visitor's `widget:{widgetId}:{visitorTokenJti}` channel via InsForge Realtime.

Updates `conversations.last_message_at`.

If a provider accepts the request but local finalization fails—or the network
closes before the adapter can determine the provider outcome—the route returns
`202 accepted`, records reconciliation metadata when possible, and suppresses
automatic retry to avoid a duplicate customer reply.

**Errors**: `400` (missing fields), `401` (no user), `404` (conversation not found), `500` for failures known to be pre-dispatch/retryable.

### POST /api/functions/approve-ai-draft

Approves and sends an AI-drafted response.

**Request body:**

```json
{
  "conversationId": "uuid",
  "aiDecisionId": "uuid",
  "body": "Optional edited response"
}
```

**Response (200):**

```json
{ "status": "ok", "data": { "message": { /* outbound message row */ } } }
```

**Behaviour**: Loads the matching `ai_decision`; an optional non-empty `body` overrides the generated text for edit-before-send. It dispatches through `OutboundMessageService` with AI actor attribution. Only after provider delivery and message persistence succeed does it clear `conversation.ai_state`; a provider failure leaves the draft available to retry. Webchat replies publish on the visitor's realtime channel. Writes `audit_logs` row (`action: 'ai_draft_approved'`).

Post-dispatch finalization failures and unknown provider outcomes clear the
claimed draft, return `202 accepted`, and write reconciliation metadata rather
than exposing a retryable response.

**Errors**: `400`, `401`, `404` (decision missing or no response text), `500`.

### POST /api/functions/regenerate-ai-draft

Regenerates an AI draft by enqueuing a new `process_ai_message` job.

**Request body:**

```json
{ "conversationId": "uuid" }
```

**Response (202):**

```json
{ "status": "queued" }
```

**Behaviour**: Loads the conversation's `organization_id`. Durably inserts an idempotent `support_jobs` row with `job_type = 'process_ai_message'`, `payload = { conversationId }`, then best-effort sets `conversations.ai_state = 'thinking'`; the worker repeats that transition after it claims the job. The route then POSTs to the InsForge `process-jobs` function with a 1.5-second timeout; state/trigger failures leave the queued job for the scheduler and are returned or logged as non-retryable warnings. **No audit log entry** (an `ai_draft_regenerated` action would be a useful follow-up; tracked in [`../plans/refactor.md`](../plans/refactor.md)).

**Errors**: `400`, `401`, `404` (conversation not found), `500`.

### POST /api/functions/escalate-conversation

Manually escalates a conversation to human agents.

**Request body:**

```json
{ "conversationId": "uuid" }
```

**Response (200):**

```json
{ "status": "ok" }
```

**Behaviour**: Updates `conversations` to `status = 'escalated'`, `ai_state = 'needs_human'`, `updated_at = now()`. **No audit log entry** — also a known gap.

**Errors**: `400`, `401`, `500`.

### POST /api/functions/resolve-conversation

Marks a conversation as resolved.

**Request body:**

```json
{ "conversationId": "uuid" }
```

**Response (200):**

```json
{ "status": "ok" }
```

**Behaviour**: Updates `conversations.status = 'resolved'`, `ai_state = 'idle'`. **No audit log entry.**

**Errors**: `400`, `401`, `500`.

### POST /api/functions/reopen-conversation

Reopens a resolved conversation.

**Request body:**

```json
{ "conversationId": "uuid" }
```

**Response (200):**

```json
{ "status": "ok" }
```

**Behaviour**: Updates `conversations.status = 'open'`, `ai_state = 'idle'`. **No audit log entry.**

**Errors**: `400`, `401`, `500`.

### POST /api/functions/test-channel-connection

Verifies a provider account is configured and active.

**Request body:**

```json
{ "channelType": "sms|email", "providerAccountId": "uuid" }
```

**Response (200):**

```json
{
  "status": "ok",
  "data": {
    "ok": true,
    "message": "Provider is reachable",
    "provider": "twilio",
    "active": true
  }
}
```

**Behaviour**: Loads the account and secret, resolves the configured adapter, and calls its health check. The HTTP request succeeds when the check runs; callers must inspect `data.ok` (and `data.reason` when present) to distinguish a reachable provider from a failed check. Mock accounts return a local no-remote-ping result.

**Errors**: `400`, `401`, `403`, `404`, `422` (referenced secret missing), `500`.

### Team and widget routes

- `POST /api/functions/invite-member` — `{ organizationId, email, role }`; `manage_members`; invited users must already have an InsForge account, and `owner` is not an invite role.
- `POST /api/functions/change-member-role` — `{ organizationId, memberId, newRole }`; `manage_members`; only the current owner can transfer or change ownership.
- `POST /api/functions/remove-member` — `{ organizationId, memberId }`; `manage_members`; removing the owner is owner-only and the last-owner invariant is enforced.
- `POST /api/functions/team-member-info` — `{ organizationId }`; available to organization members; returns only id, email, name, and avatar fields for members of that organization.
- `POST /api/functions/delete-widget` — `{ organizationId, widgetId }`; `manage_settings`; validates ownership and records an audit event through `WebchatWidgetService`.

---

## Realtime events

Functions and routes publish to InsForge Realtime. The frontend subscribes via `lib/use-realtime.ts`.

| Event | Channel | Payload |
|---|---|---|
| `new_message` | `org:{orgId}` | `{ message, conversationId }` |
| `conversation_updated` | `org:{orgId}` | `{ conversationId, aiDecisionId, decisionType }` |
| `knowledge_document_updated` | `org:{orgId}` | `{ documentId, status }` |
| `new_message` (webchat visitor delivery) | `widget:{widgetId}:{visitorTokenJti}` | `{ message, conversationId }` |

The widget iframe receives events via `postMessage` from the parent page; the agent inbox receives them via the Socket.IO connection.

---

## Function summary table

| Endpoint | Type | Auth | Method | Key parameters |
|---|---|---|---|---|
| `/functions/v1/sms-inbound` | Deno | Webhook signature | POST | Provider payload |
| `/functions/v1/sms-status` | Deno | Webhook signature | POST | Provider status payload |
| `/functions/v1/email-inbound` | Deno | Webhook signature | POST | Provider payload |
| `/functions/v1/email-status` | Deno | Webhook signature | POST | Provider status payload |
| `/functions/v1/process-jobs` | Deno | None | POST | (none) |
| `/functions/v1/webchat-thread-init` | Deno | Widget token | POST | (optional body) |
| `/functions/v1/webchat-inbound` | Deno | Visitor JWT | POST | `{ text, page_url }` |
| `/functions/v1/webchat-identify` | Deno | Visitor JWT | POST | `{ email, name }` |
| `/functions/v1/webchat-session-info` | Deno | Visitor JWT | GET | — |
| `/api/functions/send-reply` | Next.js | Same-origin JWT | POST | `{ conversationId, body }` |
| `/api/functions/approve-ai-draft` | Next.js | Same-origin JWT | POST | `{ conversationId, aiDecisionId }` |
| `/api/functions/regenerate-ai-draft` | Next.js | Same-origin JWT | POST | `{ conversationId }` |
| `/api/functions/escalate-conversation` | Next.js | Same-origin JWT | POST | `{ conversationId }` |
| `/api/functions/resolve-conversation` | Next.js | Same-origin JWT | POST | `{ conversationId }` |
| `/api/functions/reopen-conversation` | Next.js | Same-origin JWT | POST | `{ conversationId }` |
| `/api/functions/test-channel-connection` | Next.js | Same-origin JWT | POST | `{ channelType, providerAccountId }` |
| `/api/functions/invite-member` | Next.js | Same-origin JWT | POST | `{ organizationId, email, role }` |
| `/api/functions/change-member-role` | Next.js | Same-origin JWT | POST | `{ organizationId, memberId, newRole }` |
| `/api/functions/remove-member` | Next.js | Same-origin JWT | POST | `{ organizationId, memberId }` |
| `/api/functions/team-member-info` | Next.js | Same-origin JWT | POST | `{ organizationId }` |
| `/api/functions/delete-widget` | Next.js | Same-origin JWT | POST | `{ organizationId, widgetId }` |
