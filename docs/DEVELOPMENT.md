# InboxPilot — Developer Guide

## Local Setup

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **InsForge account** with a project configured (PostgreSQL + Auth + Functions + Realtime)
- **OpenRouter API key** (for AI features)
- Provider accounts (optional): Twilio, Telnyx, Postmark

### Step-by-Step

1. **Clone the repository**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Fill in the values in `.env.local` (see Environment Variables section below).

4. **Apply database migrations**

   Apply the SQL migration files in order via the InsForge SQL editor or migrations API:
   ```
   insforge/migrations/001_initial_schema.sql   # Tables, indexes, constraints
   insforge/migrations/002_rpc_functions.sql     # RPC functions
   insforge/migrations/003_rls_policies.sql      # RLS policies
   ```

5. **Seed development data** (optional)
   ```
   insforge/seed.sql
   ```
   The seed script is idempotent — running it multiple times will not create duplicates.

6. **Start the development server**
   ```bash
   npm run dev
   ```
   The Next.js dev server starts at `http://localhost:3000`.

7. **Deploy serverless functions**

   Deploy the 14 functions from `insforge/functions/` using the InsForge CLI or dashboard.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_INSFORGE_URL` | Yes | InsForge project base URL (e.g., `https://y39ezar3.us-east.insforge.app`) |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | Yes | InsForge anonymous/public API key (safe for browser) |
| `INSFORGE_SERVICE_ROLE_KEY` | Yes | InsForge service role key (server-side only, never expose to browser) |

The `NEXT_PUBLIC_` prefix makes variables available in the browser bundle. Only the InsForge URL and anon key should use this prefix.

---

## Database Migration Workflow

Migrations are plain SQL files in `insforge/migrations/`. They are applied manually via the InsForge SQL editor or migrations API.

### Adding a New Migration

1. Create a new file: `insforge/migrations/004_your_change.sql`
2. Write idempotent SQL (use `IF NOT EXISTS`, `CREATE OR REPLACE`, etc.)
3. Apply via the InsForge SQL editor
4. Update `docs/DATABASE.md` if the schema changes

### Conventions

- Number migrations sequentially: `001_`, `002_`, etc.
- Include a comment header describing the purpose
- Group related changes in a single migration
- Always add RLS policies for new tenant-scoped tables

---

## Running Tests

### All Tests

```bash
npm test
```

Runs all unit tests and property-based tests via Vitest.

### Watch Mode

```bash
npm run test:watch
```

### Specific Test Suites

```bash
# Run only property-based tests
npx vitest run packages/support-core/__tests__/properties/

# Run only unit tests
npx vitest run packages/support-core/__tests__/unit/

# Run a specific test file
npx vitest run packages/support-core/__tests__/properties/normalization.prop.test.ts

# Run tests matching a pattern
npx vitest run -t "normalizePhone"
```

### Test Configuration

Tests are configured in `vitest.config.ts`:
- Environment: `node`
- Globals: enabled (no need to import `describe`, `it`, `expect`)
- Path aliases: `@support-core` → `packages/support-core/src`, `@` → project root

See `docs/TESTING.md` for the full testing guide.

---

## Adding a New SMS/Email Provider Adapter

### SMS Provider

1. **Create the adapter file**: `packages/support-core/src/adapters/your-provider-sms-adapter.ts`

2. **Implement the `SmsProviderAdapter` interface**:
   ```typescript
   import type { SmsProviderAdapter } from '../interfaces/sms-provider-adapter.js';
   import type {
     SendSmsParams, SendSmsResult,
     NormalizedInboundSms, NormalizedDeliveryStatus,
     WebhookVerificationRequest,
   } from '../types/index.js';

   export class YourProviderSmsAdapter implements SmsProviderAdapter {
     async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
       // Call provider API to send SMS
     }

     async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
       // Verify webhook signature
     }

     parseInboundWebhook(body: unknown): NormalizedInboundSms {
       // Normalize provider-specific payload to standard format
     }

     parseStatusWebhook(body: unknown): NormalizedDeliveryStatus {
       // Normalize delivery status payload
     }
   }
   ```

3. **Export from barrel**: Add to `packages/support-core/src/adapters/index.ts`

4. **Register in function entrypoints**: In the relevant function (e.g., `sms-inbound/index.ts`):
   ```typescript
   import { YourProviderSmsAdapter } from '../../../packages/support-core/src/adapters/your-provider-sms-adapter.js';

   registry.registerSmsAdapter('your-provider', new YourProviderSmsAdapter());
   ```

5. **Write tests**:
   - Unit test: `packages/support-core/__tests__/unit/your-provider-sms-adapter.test.ts`
   - Add webhook round-trip cases to `packages/support-core/__tests__/properties/webhook-roundtrip.prop.test.ts`

### Email Provider

Same pattern as SMS, but implement `EmailProviderAdapter` instead. The interface methods are `sendEmail`, `verifyWebhook`, `parseInboundWebhook`, and `parseStatusWebhook`.

---

## Adding a New Escalation Rule

1. **Create the rule** in `packages/support-core/src/services/escalation-rules.ts`:
   ```typescript
   export class YourNewRule implements EscalationRule {
     readonly name = 'YourNewRule';

     evaluate(context: EscalationContext): EscalationResult | null {
       // Return { triggered: true, reason: '...', ruleName: this.name }
       // or null if the rule doesn't trigger
     }
   }
   ```

2. **Register in the factory**: Add to `createDefaultEscalationEngine()`:
   ```typescript
   engine.register(new YourNewRule());
   ```
   Rules are evaluated in registration order — place your rule at the appropriate priority.

3. **Write tests**: Add property-based test cases to `packages/support-core/__tests__/properties/escalation.prop.test.ts`.

---

## Adding a New Frontend Page

1. **Create the page**: `app/your-page/page.tsx`

2. **Use the auth context**:
   ```typescript
   'use client';
   import { useAuth } from '@/lib/auth-context';

   export default function YourPage() {
     const { user, loading } = useAuth();

     if (loading) return <div>Loading...</div>;
     if (!user) return null; // Middleware redirects to /login

     return <div>Your page content</div>;
   }
   ```

3. **Query data with the InsForge SDK**:
   ```typescript
   import { insforge } from '@/lib/insforge';

   // Fetch data
   const { data, error } = await insforge.database
     .from('conversations')
     .select('*')
     .eq('organization_id', orgId)
     .order('last_message_at', { ascending: false });
   ```

4. **Use Tailwind CSS** for styling (v3.4 — do NOT upgrade to v4).

5. **Update middleware** if the page should be public: Add the path to `PUBLIC_PATHS` in `middleware.ts`.

---

## Code Style and Conventions

### TypeScript

- Strict mode enabled (`"strict": true` in `tsconfig.json`)
- Target: ES2022
- Module resolution: bundler
- Use path aliases: `@/*` for project root, `@support-core/*` for business logic

### Naming

- Files: `kebab-case.ts` (e.g., `inbound-message-service.ts`)
- Classes: `PascalCase` (e.g., `InboundMessageService`)
- Interfaces: `PascalCase` (e.g., `DatabaseClient`, not `IDatabaseClient`)
- Types: `PascalCase` (e.g., `ConversationStatus`)
- Functions/variables: `camelCase`
- Database columns: `snake_case`
- Entity types use `camelCase` properties (mapped from `snake_case` in repositories)

### Architecture Rules

1. **support-core MUST NOT import `@insforge/sdk`**. All external dependencies are injected via interfaces.
2. **Layers depend downward only**: entrypoints → services → repositories → interfaces → types.
3. **Every significant action must create an audit log entry**.
4. **All tenant-scoped tables must have RLS policies**.
5. **Use Tailwind CSS v3.4**. Do not upgrade to v4.

### InsForge SDK Patterns

Frontend code uses the InsForge SDK via `lib/insforge.ts`:

```typescript
// Database queries — chainable API
const { data, error } = await insforge.database
  .from('conversations')
  .select('*, contact:contacts(*)')
  .eq('organization_id', orgId)
  .order('last_message_at', { ascending: false });

// Auth
const { data, error } = await insforge.auth.signInWithPassword({ email, password });
const { data, error } = await insforge.auth.signUp({ email, password });
const { data, error } = await insforge.auth.getCurrentUser();
await insforge.auth.signOut();

// Function invocation (from frontend)
const token = getAccessToken();
const res = await fetch(`${INSFORGE_URL}/functions/v1/send-reply`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ conversationId, body: replyText }),
});
```

---

## Debugging Tips

### Common Issues

**"Could not determine organization for receiving phone number"**
- The inbound phone number is not registered in `sms_phone_numbers`. Add it via the InsForge SQL editor or settings page.

**"Webhook signature verification failed"**
- Check that the `x-signing-secret` header matches the provider's configured webhook secret.
- For local development, use the `mock` provider which accepts any signature.

**"AI processing failed"**
- Check the `ai_decisions` table for the `raw_response` column — it contains the full LLM response or error.
- Verify the `OPENROUTER_API_KEY` is set and valid.
- Check the `support_jobs` table for failed/dead jobs.

**RLS blocking queries**
- Ensure the JWT contains the correct user ID (`sub` claim).
- Verify the user has an `organization_members` record for the target organization.
- Use the service role key (bypasses RLS) for debugging, but never in client code.

### Useful Queries

```sql
-- Check pending jobs
SELECT * FROM support_jobs WHERE status = 'pending' ORDER BY created_at;

-- Check dead-lettered jobs
SELECT * FROM support_jobs WHERE status = 'dead' ORDER BY updated_at DESC;

-- Recent audit logs
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;

-- AI decisions for a conversation
SELECT * FROM ai_decisions WHERE conversation_id = 'uuid' ORDER BY created_at DESC;

-- Check RLS: what orgs can a user see?
SELECT * FROM organization_members WHERE user_id = 'user-id';
```

### Logs

Use the InsForge dashboard or `get-container-logs` MCP tool to view function logs:
- `function.logs` — Serverless function execution logs
- `postgREST.logs` — PostgREST API logs
- `postgres.logs` — PostgreSQL logs
