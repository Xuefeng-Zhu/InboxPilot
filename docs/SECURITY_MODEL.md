# InboxPilot — Security Model

> One-pager for a customer's CISO or compliance lead. The technical controls already live in the code; this document explains how they compose.
> Owner: PM · Reviewer: ENG-LEAD · Last updated: 2026-06-07
> Pair with: [`docs/LAUNCH_CHECKLIST.md` §6 Compliance](./LAUNCH_CHECKLIST.md#section-6--compliance) · [`docs/SECRET_ROTATION.md`](./SECRET_ROTATION.md) · [`docs/INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) · [`legal/DPA.md`](../legal/DPA.md) · [`legal/AUP.md`](../legal/AUP.md)

## Data classification

| Class | Examples | Storage | Encryption |
|---|---|---|---|
| Account & auth | email, password hash, JWT session | InsForge `auth.users` | TLS in transit (InsForge default); Postgres at-rest encryption managed by InsForge |
| PII | contact name, phone, email | `contacts`, `conversations`, `messages` | TLS in transit; Postgres at-rest encryption managed by InsForge |
| Message content | SMS / email bodies in/out | `messages`, `sms_delivery_events`, `email_delivery_events` | Same as PII |
| Embeddings | KB chunk vectors | `knowledge_chunks` (pgvector) | Same as PII |
| Provider credentials | Twilio auth token, Postmark server token, OpenRouter API key | InsForge secrets endpoint, referenced by opaque id | Provider-side at rest; never sent to client |
| Audit | action, actor, resource, timestamp | `audit_logs` (append-only) | Same as PII |
| Metadata | org settings, AI settings | `organizations`, `ai_settings` | Same as PII |

We do not store payment-card data, government identifiers, or special-category data (health, biometrics). End-to-end encryption between us and the customer is not provided; customers are responsible for client-side device security.

## 1. Tenant isolation

Every tenant-scoped table has Row Level Security enabled. `insforge/migrations/003_rls_policies.sql:40-56` enables RLS on 17 tables. Every policy is `org_id IN (SELECT user_org_ids())`; the helper resolves the caller's memberships from `auth.uid()`. Because RLS is enforced by Postgres, an application bug — a missing `.eq('organization_id', ...)` — cannot leak across tenants. Cross-tenant denial is property-tested at `packages/support-core/__tests__/integration/rls-policies.test.ts`.

## 2. Credential storage

`sms_provider_accounts` and `email_provider_accounts` carry only an opaque `credentials_secret_id`. Auth tokens resolve at send time through the `SecretStore` interface (`packages/support-core/src/interfaces/secret-store.ts:24-32` — `get / put / remove`). `REVOKE SELECT (credentials_secret_id) ... FROM anon, authenticated` (`003_rls_policies.sql:418-423`) means PostgREST cannot return the secret id to a browser. Rotation: [`docs/SECRET_ROTATION.md`](./SECRET_ROTATION.md), tested by `npm run test:rotation`.

## 3. Authentication

The 7 user-action functions (`send-reply`, `approve-ai-draft`, `regenerate-ai-draft`, `escalate-conversation`, `resolve-conversation`, `reopen-conversation`, `test-channel-connection`) call `verifyJwt(req, baseUrl, serviceRoleKey)` from `insforge/functions/_shared/verify-jwt.ts:26-75`, extracting the `Authorization: Bearer ***` header and verifying it against the InsForge auth endpoint; missing / invalid tokens return `null` → caller maps to 401. The 4 inbound / status webhook functions (`sms-inbound`, `sms-status`, `email-inbound`, `email-status`) verify per-provider signatures via each adapter's `verifyWebhook(...)` (e.g. `insforge/functions/sms-inbound/index.ts:217`) and return 401 on failure.

## 4. Audit trail

Every significant action — `message_sent`, `message_received`, `ai_decision_produced`, `conversation_escalated`, `settings_changed`, `provider_account_modified`, etc. — writes a row to `audit_logs` through `AuditLogRepository.create(...)`. The repository exposes **only** `create`; the property test `packages/support-core/__tests__/properties/audit-log.prop.test.ts:58-87` asserts the prototype has no `update` / `delete` / `remove` / `destroy` / `patch` method (100 random samples). At the schema layer, `003_rls_policies.sql:402-408` defines only `SELECT` and `INSERT` policies — no `UPDATE` or `DELETE` policy is created, so RLS denies those operations by default. Append-only by both code and schema.

## 5. AI safety

The escalation engine runs **before** any LLM call. `packages/support-core/src/services/escalation-rules.ts:256-269` registers 8 deterministic rules in `createDefaultEscalationEngine()`: `HumanRequestRule` (L45), `ProfanityAngerRule` (L74), `SensitiveTopicRule` — legal / chargeback / refund / cancellation (L113), `SafetyConcernRule` — security / medical / safety / emergency (L140), `MissingKnowledgeRule` (L157), `LowConfidenceRule` (L182), `RepeatedFailureRule` (L210), `KeywordRule` — per-org custom (L230). First match wins; the message is handed to a human agent, so the LLM never sees profanity, legal threats, or safety concerns unfiltered. Adversarial coverage: commit `c5f47cc` — 62 boundary cases.

## 6. Threat model

**Addressed:** cross-tenant access (RLS on 17 tables, property-tested); credential leak via DB query (column-level `REVOKE SELECT` on `credentials_secret_id`, secrets in a separate store); unauthenticated function invocation (JWT on 7 user functions, provider signatures on 4 webhooks — CRITICAL-1/2/3/4 from `QA_BUG_HUNT.md` shipped in `821b132`, `97d0dba`, `8407aa1`, `650cd06`); application-layer RBAC enforcement (HIGH-1 — the `rbac` permission matrix is now actually enforced in every conversation-mutating function via `insforge/functions/_shared/require-permission.ts`; `rbac.ts` was previously 100% unit-tested but never imported by any entrypoint); prompt injection / AI misuse (pre-LLM escalation rules); audit tampering (append-only at code and schema layers).

**Not addressed:** DDoS at the edge (we rely on InsForge platform protections; no app-layer rate limiting yet); customer-side key compromise — MFA / SSO are on the roadmap; external pen-test (separate card `t_sec_pentest_scope`); SOC 2 (separate workstream).

## 7. Incident response

Three scenarios — *AI sent a wrong / harmful reply*, *cross-tenant data leak*, *provider credential leak* — each with a 5-minute, 1-hour, 24-hour, and post-mortem phase, are documented in [`docs/INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) (gated by card `t_sec_incident_response`, parent of this work).

## Reporting a vulnerability

Email `security@inboxpilot.example` (placeholder — replace before publishing) with a description, reproduction steps, and impact. We commit to acknowledging within 2 business days and providing a triage assessment within 5. Coordinated disclosure: 90 days, or sooner at the reporter's discretion.

## Compliance status

- DPA + AUP templates: [`legal/DPA.md`](../legal/DPA.md), [`legal/AUP.md`](../legal/AUP.md).
- Data Processing Agreement covers PII, message content, embeddings, KB, account, metadata, sessions.
- SOC 2: not started. Penetration test: scoped, not yet executed.
