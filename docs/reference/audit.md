# Audit Log

> Append-only audit trail of all significant actions. Action strings, sources, and queries.

## Overview

Every significant action writes a row to `audit_logs`. The table is **append-only** — RLS policies exist for `SELECT` and `INSERT` only; no `UPDATE` or `DELETE` policy exists, so RLS denies those operations by default.

| Column | Description |
|---|---|
| `id` | UUID |
| `organization_id` | Tenant scope (RLS) |
| `actor_id` | User ID, contact ID, or system identifier (nullable) |
| `actor_type` | `user` \| `system` \| `ai` |
| `action` | Machine-readable string (see below) |
| `resource_type` | `conversation` \| `message` \| `ai_decision` \| `organization` \| `organization_member` \| `webchat_thread` \| `webchat_widget` \| `knowledge_document` \| `ai_settings` |
| `resource_id` | The affected resource ID |
| `metadata` | Free-form JSON |
| `created_at` | Event timestamp |

## Action catalog

Every `action` string emitted in the codebase, where it originates, and the resource it concerns.

### Conversation / message lifecycle

| `action` | `actor_type` | Emitted by | Resource | When |
|---|---|---|---|---|
| `message_received` | `system` | `InboundMessageService` (SMS, email, webchat) | `message` | A new inbound message has been inserted and an AI job enqueued. |
| `message_sent` | `user` | `OutboundMessageService.sendReply` | `message` | An outbound reply has been sent (channel: sms/email/webchat). |
| `ai_draft_approved` | `user` | `app/api/functions/approve-ai-draft/route.ts` | `ai_decision` | An agent approved an AI-drafted response. |

### AI decisions

`ai_decision_produced` is emitted for every code path in `AiAgentService.processMessage`. The `metadata.decisionType` discriminates between them.

| `action` | `actor_type` | Resource | When | `metadata` discriminates |
|---|---|---|---|---|
| `ai_decision_produced` | `ai` | `ai_decision` | An AI decision was recorded (in every code path of `AiAgentService`) | `decisionType`: `respond` (off mode), `escalate` (rule), `respond` (parse error), `escalate` (low confidence), `respond` (requires_human), `respond` (draft_only), `respond` (auto_reply, sent), `respond` (auto_reply, draft), `respond` (fallback draft), `respond` (LLM error) |

The "off" path also sets `metadata.reason = 'ai_mode_off'`. The "low confidence" path sets `metadata.reason = 'low_confidence'`. The auto-reply-not-sent path sets `metadata.reason = 'confidence_below_threshold'` and `metadata.autoSent = false`.

### Organization / members

| `action` | `actor_type` | Emitted by | Resource | When |
|---|---|---|---|---|
| `organization_created` | `user` (or RPC caller) | `OrganizationService.createOrganization`, and the `create_organization_with_owner` SQL RPC | `organization` | An organization was created and the creator assigned as owner. |
| `member_added` | `user` | `OrganizationService.inviteMember` | `organization_member` | A new member was invited with a non-owner role. |
| `member_role_changed` | `user` | `OrganizationService.changeMemberRole` | `organization_member` | A member's role was changed. `metadata.previousRole` and `metadata.newRole`. |
| `member_removed` | `user` | `OrganizationService.removeMember` | `organization_member` | A member was removed from the org. |

### Settings

| `action` | `actor_type` | Emitted by | Resource | When |
|---|---|---|---|---|
| `settings_created` | `system` | `app/settings/_components/AiSettingsPanel.tsx` (first-time bootstrap) | `ai_settings` | The org's `ai_settings` row did not exist, so the panel auto-creates it on first visit. `metadata.source = 'settings_page_default'`. |
| `settings_changed` | `user` | `app/settings/_components/AiSettingsPanel.tsx` (save handler) | `ai_settings` | The user saved AI settings. `metadata.ai_mode`, `metadata.model`, `metadata.confidence_threshold`, `metadata.context_window_size`, `metadata.escalation_keywords`, `metadata.system_prompt`, `metadata.embedding_model`. |

### Knowledge

| `action` | `actor_type` | Emitted by | Resource | When |
|---|---|---|---|---|
| `knowledge_document_processed` | `system` | `KnowledgeIngestionService.processDocument` (success) | `knowledge_document` | A document finished chunking/embedding successfully. `metadata.chunkCount` and `metadata.status = 'ready'`. |
| `knowledge_document_failed` | `system` | `KnowledgeIngestionService.processDocument` (failure) | `knowledge_document` | A document failed processing. `metadata.error` and `metadata.status = 'failed'`. |

### Web chat

| `action` | `actor_type` | Emitted by | Resource | When |
|---|---|---|---|---|
| `webchat_thread_created` | `system` | `WebchatThreadService.initThread` | `webchat_thread` | A new webchat session was initialized. `metadata.widgetId`, `metadata.conversationId`, `metadata.contactId`, `metadata.identified = !!preChat?.email`. |
| `webchat_thread_identified` | `system` | `WebchatThreadService.identifyThread` | `webchat_thread` | A visitor was identified (provided email). `metadata.email`. |
| `webchat_widget_deleted` | `user` | `WebchatWidgetService.removeWidget` (called from `app/api/functions/delete-widget/route.ts`) | `webchat_widget` | A webchat widget was deleted. The service first asserts the widget's `organizationId` matches the caller's authorized org (cross-tenant guard). FK cascade wipes the widget's `webchat_thread`s; `conversations` and `contacts` are NOT cascade-deleted. The audit log is the only surviving record of the widget. `metadata.name`, `metadata.wasActive`. |

## Known gaps

The following actions are *referenced* in this catalog's intent but **not yet emitted** in code (tracked in [`../plans/refactor.md`](../plans/refactor.md)):

- `ai_draft_regenerated` — `regenerate-ai-draft` route does not write an audit log.
- `conversation_escalated` — `escalate-conversation` route does not write an audit log.
- `conversation_resolved` — `resolve-conversation` route does not write an audit log.
- `conversation_reopened` — `reopen-conversation` route does not write an audit log.

When added, they should be `actor_type: 'user'`, `resource_type: 'conversation'`, with the user as `actor_id` and the conversation as `resource_id`.

## Querying

Useful queries (run via InsForge SQL editor or `insforge.database.from('audit_logs')` from the SDK with appropriate RLS — org members can SELECT their own org's logs):

```sql
-- Recent audit log for an org
SELECT * FROM audit_logs
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT 50;

-- All actions by a user
SELECT * FROM audit_logs
WHERE organization_id = $1 AND actor_id = $2
ORDER BY created_at DESC;

-- All AI decisions for an org in a window
SELECT * FROM audit_logs
WHERE organization_id = $1
  AND action = 'ai_decision_produced'
  AND created_at BETWEEN $2 AND $3
ORDER BY created_at DESC;

-- Conversations escalated today
SELECT * FROM audit_logs
WHERE organization_id = $1
  AND action = 'conversation_escalated' -- when added
  AND created_at::date = CURRENT_DATE;
```

The composite index `idx_audit_logs_org_created` on `(organization_id, created_at DESC)` keeps the chronological-by-org query fast.

## Appending to the log

From the `support-core` services (injected dependency):

```ts
await this.auditLog.create({
  organizationId: '...',
  actorId: userId,
  actorType: 'user',
  action: 'conversation_resolved',
  resourceType: 'conversation',
  resourceId: conversationId,
  metadata: { /* arbitrary */ },
});
```

From the frontend (via the InsForge SDK or the server-side admin client):

```ts
await insforge.database.from('audit_logs').insert([{
  organization_id: '...',
  actor_id: userId,
  actor_type: 'user',
  action: '...',
  resource_type: '...',
  resource_id: '...',
  metadata: {},
}]);
```

> **Important**: do not attempt UPDATE or DELETE on `audit_logs`. RLS will deny it, and the append-only invariant is intentional.
