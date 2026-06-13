# Getting Started

> Set up InboxPilot locally in about 15 minutes.

## Prerequisites

- **Node.js** 18+ (LTS recommended; project tested on Node 20).
- **npm** 9+.
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

# Optional: enables the demo chat widget on the landing page
NEXT_PUBLIC_DEMO_WIDGET_ID=
```

| Variable | Required | Where it's used |
|---|---|---|
| `NEXT_PUBLIC_INSFORGE_URL` | yes | Browser SDK, server-side SDK, realtime |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | yes | Browser SDK (anon, safe to expose) |
| `INSFORGE_SERVICE_ROLE_KEY` | yes | Server-side only (bypasses RLS) |
| `NEXT_PUBLIC_DEMO_WIDGET_ID` | no | Landing page demo chat widget |

## 3. Apply database migrations

Apply the SQL files in order to your InsForge project (via the InsForge SQL editor or migrations API):

```bash
insforge/migrations/001_initial_schema.sql      # 17 tables, indexes, extensions
insforge/migrations/002_rpc_functions.sql        # match_knowledge_chunks, claim_support_jobs
insforge/migrations/003_rls_policies.sql         # RLS, user_org_ids(), credential revocations
insforge/migrations/004_create_organization_onboarding_rpc.sql  # create_organization_with_owner
insforge/migrations/005_webchat.sql              # webchat_widgets, webchat_threads
insforge/migrations/006_backfill_conversation_activity.sql  # conversation activity backfill
```

All files are idempotent — `CREATE OR REPLACE`, `IF NOT EXISTS` — so re-running is safe.

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

The InsForge Deno Functions live in `insforge/functions/`. Deploy them with the InsForge CLI or dashboard:

```bash
insforge functions deploy --all
```

There are 9 Deno functions. See [`../reference/api.md`](../reference/api.md#insforge-deno-functions-9) for the full list and auth requirements.

## 7. (Optional) Configure providers

In Settings → Channels, add an SMS provider account (Twilio or Telnyx) and an email provider account (Postmark). Each account needs:

- **SMS** — Account SID / Auth Token, a phone number (added to `sms_phone_numbers`).
- **Email** — Server token, an email address (added to `email_addresses`).

For local development, the `mock` provider requires no credentials. The `sms-inbound` and `email-inbound` functions default to `x-provider: mock` if no header is sent.

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
