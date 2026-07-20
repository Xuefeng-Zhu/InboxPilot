# Getting Started

> Set up InboxPilot locally in about 15 minutes.

## Prerequisites

- **Node.js** 20.9+ (required by the installed Next.js 16 release).
- **npm** 9+.
- **Deno** 2+ (required by `npm run lint` to type-check the function entrypoints).
- An **InsForge project** (PostgreSQL + Auth + Functions + Realtime + AI Gateway). Sign up at [insforge.dev](https://insforge.dev).
- An **OpenRouter API key** for AI features. Add it in your InsForge project's AI settings.
- (Optional) Provider accounts: Twilio and/or Telnyx for SMS; Postmark for email.

## 1. Clone and install

```bash
git clone <your-fork-url> inboxpilot
cd inboxpilot
npm install
```

The first install also installs the widget subpackage. To rebuild the widget bundle on every build, see [`deploying.md`](deploying.md).

## 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```ini
NEXT_PUBLIC_INSFORGE_URL=https://<your-app>.us-east.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=<your-anon-key>
INSFORGE_SERVICE_ROLE_KEY=<your-service-role-key>
PROCESS_JOBS_SECRET=<long-random-server-secret>

# Optional: enables the demo chat widget on the landing page
NEXT_PUBLIC_DEMO_WIDGET_ID=
```

| Variable | Required | Where it's used |
|---|---|---|
| `NEXT_PUBLIC_INSFORGE_URL` | yes | Browser SDK, server-side SDK, realtime |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | yes | Browser SDK (anon, safe to expose) |
| `INSFORGE_SERVICE_ROLE_KEY` | yes | Server-side only (bypasses RLS) |
| `PROCESS_JOBS_SECRET` | yes | Server-only authentication for `process-jobs` scheduler and manual triggers |
| `NEXT_PUBLIC_DEMO_WIDGET_ID` | no | Landing page demo chat widget |

## 3. Apply database migrations

Apply the SQL files in order to your InsForge project (via the InsForge SQL editor or migrations API):

| File | Purpose |
|---|---|
| `insforge/migrations/001_initial_schema.sql` | 17 core tables, indexes, CHECK constraints, `pgcrypto` + `vector` extensions |
| `insforge/migrations/002_rpc_functions.sql` | `match_knowledge_chunks` (RAG); initial `claim_support_jobs` (superseded by 008) |
| `insforge/migrations/003_rls_policies.sql` | RLS policies, `user_org_ids()` helper, `credentials_secret_id` column revocations |
| `insforge/migrations/004_create_organization_onboarding_rpc.sql` | `create_organization_with_owner(name, slug)` — atomic signup RPC |
| `insforge/migrations/005_webchat.sql` | Loosens `channel` CHECK for `'webchat'`; `webchat_widgets`, `webchat_threads` tables + RLS |
| `insforge/migrations/006_backfill_conversation_activity.sql` | Backfills `last_message_at` / `last_customer_message_at` on conversations |
| `insforge/migrations/007_ai_decision_chunks.sql` | `ai_decision_chunks` table; `ai_decision_chunks_validate()` trigger; `insert_ai_decision_chunks()` RPC |
| `insforge/migrations/008_claim_failed_jobs.sql` | Drops old `idx_support_jobs_pending`; new `idx_support_jobs_claimable` index; replaces `claim_support_jobs` with overload using `claim_limit` that also claims failed jobs |
| `insforge/migrations/009_org_sla_thresholds.sql` | Adds `organizations.sla_thresholds jsonb`; `conversations.last_message_direction text`; backfill from `messages.direction` |
| `insforge/migrations/010_drop_pending_status.sql` | Drops `'pending'` from `conversations.status` CHECK (was in 001 but never assigned by code) |
| `insforge/migrations/011_ai_settings_embedding_model.sql` | Adds the independent knowledge embedding model setting and updates the default chat model |
| `insforge/migrations/012_replace_knowledge_chunks.sql` | Adds transactional replacement of a document's knowledge chunks |
| `insforge/migrations/013_webchat_realtime_widget_channel.sql` | Registers org/widget realtime channels and adds the server-only realtime publish RPC |
| `insforge/migrations/20260615074718_trigger-process-jobs-on-insert.sql` | Adds an HTTP job trigger (superseded by the next migration after the extension proved unreliable) |
| `insforge/migrations/20260615080500_drop-broken-trigger.sql` | Removes the unreliable HTTP job trigger; scheduled processing remains the active path |
| `insforge/migrations/014_role_aware_rls_and_knowledge_storage.sql` | Enforces role-aware settings/knowledge RLS, hides provider and widget secrets, records knowledge object keys, and adds organization-scoped storage policies |
| `insforge/migrations/015_bind_knowledge_jobs_to_documents.sql` | Restricts browser-enqueued knowledge jobs to documents owned by the caller's organization |
| `insforge/migrations/016_job_and_ai_decision_idempotency.sql` | Adds job and AI-decision idempotency, stale-claim quarantine, revision-safe knowledge indexing, and atomic inbound-audit repair |
| `insforge/migrations/017_lock_down_legacy_webchat_access.sql` | Removes orphan public webchat policies/grants and the legacy `debug_auth_info()` helper |

Apply all 19 files in the order shown, through migration `017`. Migration `016` must be applied before deploying the current application routes or functions because the current code depends on its columns and RPCs; migration `017` closes legacy public webchat access and is also required for a secure deployment. Do not assume the full migration set is safe to replay against an initialized schema; use your environment's migration history to apply only pending files.

After applying migration `014`, mark the existing `knowledge-files` storage bucket **private** in the InsForge dashboard. The SQL intentionally does not modify bucket configuration. Uploaded object keys must begin with `<organization-id>/documents/` so the organization-scoped storage policies can authorize them.

## 4. (Optional) Seed dev data

`insforge/seed.sql` is an idempotent seed script. Apply it once for a working dev environment with:

- 1 organization ("Acme Support") with 1 owner member
- 3 contacts (mix of SMS and email)
- 5 conversations with 10 messages
- 2 knowledge documents with chunks and embeddings
- Sample AI settings

## 5. Start the dev server

```bash
npm run dev
```

Open `http://localhost:3000`. Sign up creates a new organization and assigns you as owner (via the `create_organization_with_owner` RPC).

## 6. (Optional) Deploy serverless functions

The InsForge Deno Functions live in `insforge/functions/`. Deploy them with the checked-in deployment script:

```bash
npm run deploy:functions
```

The checked-in deployment manifest enumerates all 9 Deno functions. See [`../reference/api.md`](../reference/api.md#insforge-deno-functions-9) for the full list and auth requirements.

## 7. (Optional) Configure providers

In Settings → Channels, add an SMS provider account (Twilio or Telnyx) and an email provider account (Postmark). Each account needs:

- **SMS** — Account SID / Auth Token, a phone number (added to `sms_phone_numbers`).
- **Email** — Server token, an email address (added to `email_addresses`).

For local development, the `mock` provider requires no provider credentials, but inbound mock webhooks are disabled by default. They require `x-provider: mock`, `INBOXPILOT_ALLOW_LOCAL_MOCK_WEBHOOKS=true`, and loopback request and InsForge base URLs. Deployed endpoints always reject the mock adapter; real inbound webhooks must send an explicit provider header and match a configured receiving number/address and provider account.

## 8. (Optional) Build the web chat widget

```bash
npm run build:widget
```

This produces `public/widget.js`, the embeddable JS snippet. See [`../reference/webchat.md`](../reference/webchat.md).

## 9. Run tests

```bash
npm test          # all tests
npm run test:core # support-core tests only
```

See [`../reference/testing.md`](../reference/testing.md).

## Where to go next

- **Understand the system** → [`../reference/architecture.md`](../reference/architecture.md)
- **Make your first change** → [`adding-a-channel.md`](adding-a-channel.md) or [`adding-an-escalation-rule.md`](adding-an-escalation-rule.md)
- **Hit a wall** → [`debugging.md`](debugging.md)
- **Deploy** → [`deploying.md`](deploying.md)
