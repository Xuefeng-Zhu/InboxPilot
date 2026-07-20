# Local Development

> Day-to-day workflow for working on the InboxPilot codebase.

## Dev server

```bash
npm run dev
```

This starts the Next.js dev server at `http://localhost:3000`. Hot reload is enabled. The first request to a page may be slow because the App Router compiles routes on demand.

## Build commands

| Command | Effect |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Run `build:widget` then `next build` for production |
| `npm run install:widget` | Install the widget's locked development dependencies |
| `npm run build:widget` | Build the embeddable widget JS bundle to `public/widget.js` |
| `npm run start` | Start a production Next.js server (requires `build` first) |
| `npm run lint` | Run `tsc --noEmit`, the Deno safety scan, and `deno check` for all 9 function entrypoints |
| `npm run deploy:functions` | Freshly bundle and deploy all 9 function entrypoints from the checked-in manifest |

## Deploying Deno functions

The InsForge Deno functions live in `insforge/functions/`. To redeploy after a change:

```bash
npm run deploy:functions
```

The deployment script at `scripts/deploy-insforge-functions.mjs` enumerates all nine source entrypoints explicitly so a release cannot silently omit a function. It bundles every current entrypoint into a disposable directory before any deployment begins, then deploys the fresh self-contained files and cleans them up. The checked-in bundles in `insforge/functions/_bundled/` are generated artifacts that may be stale — don't edit or deploy them directly.

### Local function testing

There is no local emulator for Deno functions. The `scripts/mock-sms.mjs` script can simulate the full inbound/outbound SMS flow against a real (or remote) InsForge backend:

```bash
node scripts/mock-sms.mjs inbound "Help me with my order"
node scripts/mock-sms.mjs status <messageId> delivered
node scripts/mock-sms.mjs reply <conversationId> "On it!"
node scripts/mock-sms.mjs conversation "Billing question"
```

It reads `.env.local` automatically.

## Database migrations

### Adding a new migration

1. Create `insforge/migrations/00N_your_change.sql` (next sequential number).
2. Write idempotent SQL (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP IF EXISTS` for constraints).
3. Apply it via the InsForge SQL editor.
4. Update [`../reference/database.md`](../reference/database.md) and the schema references throughout the docs.
5. If the migration adds tables, add RLS policies in the same file or a follow-up migration.

### Conventions

- **Number sequentially**: `001_`, `002_`, … (use leading zeros).
- **Comment header** describing the purpose and any requirements being satisfied.
- **Group related changes** in a single migration.
- **Always add RLS policies** for new tenant-scoped tables.
- **Update seed data** if your migration affects existing fixtures.

## Project conventions

### TypeScript

- **Strict mode** enabled (`"strict": true` in `tsconfig.json`).
- **Target**: ES2022.
- **Module resolution**: bundler.
- **Path aliases**:
  - `@/*` → repo root (e.g. `@/lib/insforge`)
  - `@support-core/*` → `packages/support-core/src/*` (test alias only — production code uses relative imports for portability)

### Naming

- **Files**: `kebab-case.ts` (e.g. `inbound-message-service.ts`).
- **Classes**: `PascalCase` (e.g. `InboundMessageService`).
- **Interfaces**: `PascalCase` (e.g. `DatabaseClient` — no `I` prefix).
- **Types**: `PascalCase` (e.g. `ConversationStatus`).
- **Functions and variables**: `camelCase`.
- **Database columns**: `snake_case`.
- **Entity types**: `camelCase` properties, mapped from `snake_case` rows in repositories.

### Architecture rules (see AGENTS.md for the canonical list)

1. **`packages/support-core/` MUST NOT import `@insforge/sdk`** or any InsForge-specific code. External dependencies are injected via interfaces.
2. **Layers depend downward only**: `entrypoints → services → repositories → interfaces → types`. Adapters depend only on interfaces and types.
3. **Every significant action must write an `audit_logs` row.** See [`../reference/audit.md`](../reference/audit.md).
4. **All tenant-scoped tables must have RLS policies.**
5. **Use Tailwind CSS v3.4** — do not upgrade to v4. Locked in `package.json`.

## Testing workflow

```bash
# Write a new test
npm run test:watch

# When satisfied
npm test

# Pre-commit
npm run lint
npm test
```

Tests live in `__tests__/` (UI / middleware) and `packages/support-core/__tests__/` (business logic). See [`../reference/testing.md`](../reference/testing.md) for property-based test patterns and the full list of correctness properties.

## Useful queries during development

```sql
-- Check pending jobs
SELECT * FROM support_jobs WHERE status = 'pending' ORDER BY created_at;

-- Check dead-lettered jobs
SELECT * FROM support_jobs WHERE status = 'dead' ORDER BY updated_at DESC;

-- Recent audit logs
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;

-- AI decisions for a conversation
SELECT * FROM ai_decisions WHERE conversation_id = 'uuid' ORDER BY created_at DESC;

-- Check what orgs a user can see (RLS preview)
SELECT * FROM organization_members WHERE user_id = 'user-id';

-- Stuck conversations (ai_state = 'thinking' for a while)
SELECT id, ai_state, last_message_at FROM conversations
WHERE ai_state = 'thinking' AND last_message_at < now() - interval '5 minutes';
```

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "Could not determine organization for receiving phone number" | The receiving phone isn't in `sms_phone_numbers` | Add the number in Settings → SMS, or insert into `sms_phone_numbers` directly |
| "Webhook signature verification failed" | The request signature doesn't match the stored provider credentials resolved for that webhook | Use the `mock` provider for local dev (`x-provider: mock`); the mock accepts any signature |
| AI processing fails immediately | OpenRouter key is missing or invalid | Set the key in the InsForge project's AI settings; check `ai_settings.model` is valid |
| RLS blocks a query | The JWT doesn't have the right `sub` claim, or the user isn't a member of the target org | Verify the user's `organization_members` rows; the service role key bypasses RLS — use it for debugging, never in client code |
| `claim_support_jobs` returns 0 jobs | All jobs are already `claimed` or `dead`, or `run_after` is in the future | The scheduler normally calls `/process-jobs`; if a job is stuck, manually POST `{}` to `/functions/v1/process-jobs` to flush |

See [`debugging.md`](debugging.md) for more.
