# InboxPilot — API Reference

## Overview

InboxPilot exposes 14 serverless function entrypoints deployed as InsForge Deno Functions. Each function is a single HTTP endpoint (no subpaths).

All functions are located in `insforge/functions/` and share utilities from `insforge/functions/_shared/`:
- `create-db-client.ts` — Creates a `DatabaseClient` backed by the InsForge PostgREST API
- `verify-jwt.ts` — Verifies JWT Bearer tokens via the InsForge auth endpoint
- `create-realtime-publisher.ts` — Creates a `RealtimePublisher` for broadcasting events

### Authentication Methods

| Method | Description | Used By |
|--------|-------------|---------|
| **Webhook** | Provider-specific signature verification via adapter | Inbound/status webhooks |
| **JWT** | Bearer token in `Authorization` header, verified via InsForge auth | Frontend-initiated actions |
| **Internal** | No auth required — called by job queue or cron | Job processing functions |

### Error Response Format

All functions return errors in a consistent JSON format:

```json
{
  "error": "Human-readable error message",
  "message": "Detailed error description (on 500 errors)"
}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request (missing/invalid parameters) |
| `401` | Unauthorized (invalid JWT or webhook signature) |
| `404` | Resource not found |
| `500` | Internal server error |

---

## Webhook Handlers

These functions receive webhooks from SMS and email providers. Authentication is via provider-specific webhook signature verification.

### sms-inbound

Processes inbound SMS messages from providers.

- **File**: `insforge/functions/sms-inbound/index.ts`
- **Auth**: Webhook signature verification
- **Headers**: `x-provider` (provider name, default: `mock`), `x-signing-secret` (webhook secret), `x-organization-id` (optional org override)

**Request**:
```json
POST /functions/v1/sms-inbound
Content-Type: application/json
x-provider: twilio

{
  "From": "+15551234567",
  "To": "+15559876543",
  "Body": "Hello, I need help",
  "MessageSid": "SM1234567890"
}
```

**Response** (200):
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
    "deliveryStatus": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Side effects**: Creates/updates contact, creates/updates conversation, creates message, enqueues `process_ai_message` job, publishes `new_message` realtime event.

---

### sms-status

Tracks SMS delivery status updates from providers.

- **File**: `insforge/functions/sms-status/index.ts`
- **Auth**: Webhook signature verification
- **Headers**: `x-provider`, `x-signing-secret`

**Request**:
```json
POST /functions/v1/sms-status
Content-Type: application/json
x-provider: twilio

{
  "MessageSid": "SM1234567890",
  "MessageStatus": "delivered"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "messageId": "uuid",
    "deliveryStatus": "delivered"
  }
}
```

If the message is not found, returns `200` with `"message": "Message not found, status ignored"`.

---

### email-inbound

Processes inbound email messages from providers.

- **File**: `insforge/functions/email-inbound/index.ts`
- **Auth**: Webhook signature verification
- **Headers**: `x-provider` (default: `mock`), `x-signing-secret`, `x-organization-id` (optional)

**Request**:
```json
POST /functions/v1/email-inbound
Content-Type: application/json
x-provider: postmark

{
  "From": "customer@example.com",
  "To": "support@company.com",
  "Subject": "Order issue",
  "TextBody": "I have a problem with my order",
  "MessageID": "msg-abc-123"
}
```

**Response** (200):
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
    "deliveryStatus": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Side effects**: Same as `sms-inbound` but for email channel. Org lookup uses `email_addresses` table.

---

### email-status

Tracks email delivery status updates from providers.

- **File**: `insforge/functions/email-status/index.ts`
- **Auth**: Webhook signature verification
- **Headers**: `x-provider`, `x-signing-secret`

**Request**:
```json
POST /functions/v1/email-status
Content-Type: application/json
x-provider: postmark

{
  "MessageID": "msg-abc-123",
  "RecordType": "Delivery",
  "DeliveredAt": "2024-01-01T00:00:00Z"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "messageId": "uuid",
    "deliveryStatus": "delivered"
  }
}
```

---

## JWT-Authenticated Functions

These functions are called from the frontend. They require a valid JWT Bearer token in the `Authorization` header.

### send-reply

Sends a reply message on an existing conversation.

- **File**: `insforge/functions/send-reply/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/send-reply
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "conversationId": "uuid",
  "body": "Thanks for reaching out! Let me help you with that."
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "conversationId": "uuid",
    "senderType": "user",
    "direction": "outbound",
    "body": "Thanks for reaching out! Let me help you with that.",
    "deliveryStatus": "queued",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Side effects**: Sends message via provider adapter, creates message record, creates audit log, publishes `new_message` realtime event.

---

### approve-ai-draft

Approves and sends an AI-drafted response.

- **File**: `insforge/functions/approve-ai-draft/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/approve-ai-draft
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "conversationId": "uuid",
  "aiDecisionId": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "message": { "id": "uuid", "body": "AI-drafted response text", "..." : "..." },
    "conversation": { "id": "uuid", "aiState": "idle", "..." : "..." }
  }
}
```

**Side effects**: Sends the AI draft via provider adapter, sets `ai_state` to `idle`, creates audit log (`ai_draft_approved`), publishes `new_message` and `conversation_updated` events.

---

### regenerate-ai-draft

Regenerates an AI draft for a conversation by enqueuing a new AI processing job.

- **File**: `insforge/functions/regenerate-ai-draft/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/regenerate-ai-draft
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "conversationId": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "conversation": { "id": "uuid", "aiState": "thinking", "..." : "..." },
    "jobId": "uuid"
  }
}
```

**Side effects**: Enqueues `process_ai_message` job, sets `ai_state` to `thinking`, creates audit log (`ai_draft_regenerated`), publishes `conversation_updated` event.

---

### escalate-conversation

Escalates a conversation to human agents.

- **File**: `insforge/functions/escalate-conversation/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/escalate-conversation
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "conversationId": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "status": "escalated",
    "aiState": "needs_human",
    "..." : "..."
  }
}
```

**Side effects**: Sets `status` to `escalated` and `ai_state` to `needs_human`, creates audit log (`conversation_escalated`), publishes `conversation_updated` event.

---

### resolve-conversation

Resolves a conversation.

- **File**: `insforge/functions/resolve-conversation/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/resolve-conversation
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "conversationId": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "status": "resolved",
    "aiState": "idle",
    "..." : "..."
  }
}
```

**Side effects**: Sets `status` to `resolved` and `ai_state` to `idle`, creates audit log (`conversation_resolved`), publishes `conversation_updated` event.

---

### reopen-conversation

Reopens a resolved conversation.

- **File**: `insforge/functions/reopen-conversation/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/reopen-conversation
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "conversationId": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "data": {
    "id": "uuid",
    "status": "open",
    "..." : "..."
  }
}
```

**Side effects**: Sets `status` to `open`, creates audit log (`conversation_reopened`), publishes `conversation_updated` event.

---

### test-channel-connection

Tests a provider account connection by verifying the account exists and is active.

- **File**: `insforge/functions/test-channel-connection/index.ts`
- **Auth**: JWT (Bearer token)

**Request**:
```json
POST /functions/v1/test-channel-connection
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "channelType": "sms",
  "providerAccountId": "uuid"
}
```

**Response** (200 — success):
```json
{
  "status": "ok",
  "provider": "twilio",
  "label": "Main Twilio Account",
  "message": "Connection to twilio account \"Main Twilio Account\" is active"
}
```

**Response** (200 — inactive):
```json
{
  "status": "error",
  "error": "Provider account is inactive",
  "provider": "twilio",
  "label": "Main Twilio Account"
}
```

---

## Internal / Job Queue Functions

These functions are triggered internally by the job queue or cron scheduler. They do not require JWT authentication.

### process-jobs

Claims and processes pending jobs from the queue. Designed to be called on a schedule (cron) or manually.

- **File**: `insforge/functions/process-jobs/index.ts`
- **Auth**: None (internal)
- **Trigger**: Cron/scheduler or manual HTTP call

**Request**:
```
POST /functions/v1/process-jobs
```

No request body required.

**Response** (200):
```json
{
  "status": "ok",
  "claimed": 3,
  "results": [
    { "jobId": "uuid", "jobType": "process_ai_message", "status": "completed" },
    { "jobId": "uuid", "jobType": "send_outbound_message", "status": "completed" },
    { "jobId": "uuid", "jobType": "process_ai_message", "status": "failed", "error": "..." }
  ]
}
```

Claims up to 10 jobs per invocation. Routes each job to the appropriate handler by `job_type`. Failed jobs are retried with exponential backoff.

---

### process-ai-job

Processes an AI message analysis job. Called by `process-jobs` when a `process_ai_message` job is claimed.

- **File**: `insforge/functions/process-ai-job/index.ts`
- **Auth**: None (internal)

**Request**:
```json
POST /functions/v1/process-ai-job
Content-Type: application/json

{
  "conversation_id": "uuid",
  "organization_id": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "decision": {
    "id": "uuid",
    "decisionType": "respond",
    "confidence": 0.92,
    "requiresHuman": false
  }
}
```

**Side effects**: Runs the full AI pipeline (escalation check → LLM call → decision parsing → mode gating), creates `ai_decisions` record, updates conversation `ai_state`, creates audit log, publishes `conversation_updated` event.

---

### process-knowledge-document

Chunks and embeds a knowledge document for RAG.

- **File**: `insforge/functions/process-knowledge-document/index.ts`
- **Auth**: None (internal)

**Request**:
```json
POST /functions/v1/process-knowledge-document
Content-Type: application/json

{
  "documentId": "uuid"
}
```

**Response** (200):
```json
{
  "status": "ok",
  "documentId": "uuid"
}
```

**Side effects**: Chunks the document text, generates embeddings via AI Gateway, stores chunks in `knowledge_chunks`, updates document `status` to `ready`, publishes `knowledge_document_updated` event.

---

## Function Summary Table

| Function | Auth | Method | Key Parameters |
|----------|------|--------|----------------|
| `sms-inbound` | Webhook | POST | Provider payload |
| `sms-status` | Webhook | POST | Provider status payload |
| `email-inbound` | Webhook | POST | Provider payload |
| `email-status` | Webhook | POST | Provider status payload |
| `send-reply` | JWT | POST | `conversationId`, `body` |
| `approve-ai-draft` | JWT | POST | `conversationId`, `aiDecisionId` |
| `regenerate-ai-draft` | JWT | POST | `conversationId` |
| `escalate-conversation` | JWT | POST | `conversationId` |
| `resolve-conversation` | JWT | POST | `conversationId` |
| `reopen-conversation` | JWT | POST | `conversationId` |
| `test-channel-connection` | JWT | POST | `channelType`, `providerAccountId` |
| `process-jobs` | None | POST | (none) |
| `process-ai-job` | None | POST | `conversation_id`, `organization_id` |
| `process-knowledge-document` | None | POST | `documentId` |
