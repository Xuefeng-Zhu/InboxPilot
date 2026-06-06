# InboxPilot — Testing Guide

## Testing Philosophy

InboxPilot uses **property-based testing** as the primary correctness verification strategy. Instead of testing individual examples, property tests generate hundreds of random inputs and verify that invariants (correctness properties) hold for all of them.

This approach catches edge cases that example-based tests miss, particularly around:
- Input normalization (phone numbers, emails)
- State machine transitions
- JSON round-trip serialization
- Permission boundaries
- Threshold-based decisions

The project uses:
- **Vitest** as the test runner
- **fast-check** (v3.19+) for property-based test generation
- Example-based unit tests for service-level logic
- Integration test stubs for database-dependent flows

---

## Test File Organization

```
packages/support-core/__tests__/
├── properties/                          # Property-based tests (fast-check)
│   ├── normalization.prop.test.ts       # Phone/email normalization
│   ├── webhook-roundtrip.prop.test.ts   # Webhook payload round-trip
│   ├── ai-decision.prop.test.ts         # AI decision JSON round-trip
│   ├── escalation.prop.test.ts          # Escalation engine triggers
│   ├── deduplication.prop.test.ts       # Message deduplication
│   ├── job-queue.prop.test.ts           # Job queue backoff/dead-lettering
│   ├── auto-reply.prop.test.ts          # Auto-reply threshold gating
│   ├── state-machine.prop.test.ts       # Conversation state machine
│   ├── rbac.prop.test.ts               # RBAC permission enforcement
│   ├── audit-log.prop.test.ts           # Audit log immutability
│   └── knowledge.prop.test.ts           # Knowledge chunk similarity
├── unit/                                # Example-based unit tests
│   ├── inbound-message-service.test.ts
│   ├── outbound-message-service.test.ts
│   ├── ai-agent-service.test.ts
│   ├── knowledge-ingestion-service.test.ts
│   ├── escalation-engine.test.ts
│   ├── conversation-service.test.ts
│   ├── conversation-repository.test.ts
│   ├── contact-repository.test.ts
│   ├── message-repository.test.ts
│   ├── normalization.test.ts
│   ├── mock-sms-adapter.test.ts
│   ├── mock-email-adapter.test.ts
│   ├── postmark-email-adapter.test.ts
│   ├── sms-stubs.test.ts
│   └── email-stubs.test.ts
├── integration/                         # Integration tests (require database)
│   ├── inbound-sms-flow.test.ts
│   ├── inbound-email-flow.test.ts
│   ├── outbound-message-flow.test.ts
│   ├── rls-policies.test.ts
│   ├── realtime-events.test.ts
│   └── seed-idempotency.test.ts
__tests__/
└── middleware.test.ts                   # Next.js middleware tests
```

---

## How to Run Tests

### All Tests

```bash
npm test
```

### Watch Mode

```bash
npm run test:watch
```

### Specific Suites

```bash
# Property-based tests only
npx vitest run packages/support-core/__tests__/properties/

# Unit tests only
npx vitest run packages/support-core/__tests__/unit/

# Integration tests only
npx vitest run packages/support-core/__tests__/integration/

# Single file
npx vitest run packages/support-core/__tests__/properties/escalation.prop.test.ts

# By test name pattern
npx vitest run -t "normalizePhone"

# Middleware tests
npx vitest run __tests__/middleware.test.ts
```

---

## Correctness Properties

The project defines 17 correctness properties verified by property-based tests. Each property runs 100+ iterations with randomly generated inputs.

### Property 1: Phone Number Normalization Round-Trip

**File**: `properties/normalization.prop.test.ts`

For any valid phone number in any common format, normalizing to E.164 and normalizing again produces the same result (idempotence).

Generates US phone numbers in 10+ formats (parenthesized, dashed, dotted, with/without country code, whitespace-padded) and international numbers with 2-3 digit country codes.

### Property 2: Email Normalization Idempotence

**File**: `properties/normalization.prop.test.ts`

For any valid email with arbitrary casing and whitespace, normalizing twice produces the same result.

Generates emails with random local parts, domain labels, TLDs, mixed casing, and leading/trailing whitespace.

### Property 3: Webhook Payload Round-Trip (SMS)

**File**: `properties/webhook-roundtrip.prop.test.ts`

For any SMS webhook payload, parsing via the adapter and re-serializing preserves all essential fields (`from`, `to`, `body`, `externalMessageId`).

### Property 4: Webhook Payload Round-Trip (Email)

**File**: `properties/webhook-roundtrip.prop.test.ts`

For any email webhook payload, parsing via the adapter preserves `from`, `to`, `subject`, `bodyText`, and `externalMessageId`.

### Property 5: AI Decision JSON Round-Trip

**File**: `properties/ai-decision.prop.test.ts`

For any valid AI decision object, serializing to JSON and parsing back via `parseAiDecision` produces the same structured result. Tests all `decision_type` values, confidence ranges, and tag arrays.

### Property 6: Escalation — Human Request Detection

**File**: `properties/escalation.prop.test.ts`

For any message containing a human-request phrase (e.g., "speak to a human", "real person"), the `HumanRequestRule` triggers escalation regardless of surrounding text.

### Property 7: Escalation — Profanity/Anger Detection

**File**: `properties/escalation.prop.test.ts`

For any message containing profanity or anger indicators, the `ProfanityAngerRule` triggers escalation.

### Property 8: Escalation — Sensitive Topic Detection

**File**: `properties/escalation.prop.test.ts`

For any message containing sensitive topic phrases (legal, chargeback, refund, cancellation), the `SensitiveTopicRule` triggers.

### Property 9: Message Deduplication

**File**: `properties/deduplication.prop.test.ts`

For any `(provider, external_message_id)` pair, attempting to insert two messages with the same pair results in only one record (enforced by the partial unique index).

### Property 10: Job Queue Exponential Backoff

**File**: `properties/job-queue.prop.test.ts`

For any job that fails, the `run_after` delay follows `2^attempts` seconds. After `max_attempts` failures, the job status becomes `dead`.

### Property 11: Job Queue Dead-Lettering

**File**: `properties/job-queue.prop.test.ts`

For any job where `attempts >= max_attempts`, the status is set to `dead` and the job is never re-claimed.

### Property 12: Auto-Reply Threshold Gating

**File**: `properties/auto-reply.prop.test.ts`

In `auto_reply` mode, messages are only auto-sent when `confidence >= threshold`. Below-threshold responses are stored as drafts.

### Property 13: Conversation State Machine

**File**: `properties/state-machine.prop.test.ts`

Conversation status transitions follow the defined state machine. Invalid transitions (e.g., `resolved` → `escalated` without reopening) are rejected.

### Property 14: RBAC Permission Enforcement

**File**: `properties/rbac.prop.test.ts`

For any `(role, permission)` pair, `hasPermission` returns `true` only if the permission is in the role's allowed set. Verifies the complete permission matrix:
- `owner`: all 10 permissions
- `admin`: all except `delete_org`
- `agent`: `view_conversations`, `reply_conversations`, `view_knowledge`, `view_settings`
- `viewer`: `view_conversations`, `view_knowledge`

### Property 15: Audit Log Immutability

**File**: `properties/audit-log.prop.test.ts`

Audit log entries can be created and read but never updated or deleted. The RLS policy enforces append-only semantics.

### Property 16: Knowledge Chunk Similarity

**File**: `properties/knowledge.prop.test.ts`

For any query embedding and set of knowledge chunks, `match_knowledge_chunks` returns results ordered by descending similarity, all above the configured threshold.

### Property 17: Escalation — Safety Concern Detection

**File**: `properties/escalation.prop.test.ts`

For any message containing safety concern phrases (security breach, medical emergency, etc.), the `SafetyConcernRule` triggers escalation.

---

## Writing New Property Tests

### Template

```typescript
import { describe, it } from 'vitest';
import fc from 'fast-check';

describe('Your feature property tests', () => {
  it('Property N: description of the invariant', () => {
    // 1. Define an arbitrary (random input generator)
    const inputArbitrary = fc.record({
      field1: fc.string({ minLength: 1 }),
      field2: fc.integer({ min: 0, max: 100 }),
    });

    // 2. Assert the property holds for all generated inputs
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const result = yourFunction(input);

        // Return true if the property holds, false if violated
        return result.someInvariant === true;
      }),
      { numRuns: 100 }  // Run 100+ iterations
    );
  });
});
```

### Guidelines

1. **Name the property clearly**: "Property N: [invariant description]"
2. **Generate realistic inputs**: Use `fc.oneof`, `fc.constantFrom`, and custom arbitraries to cover the input space
3. **Test invariants, not examples**: Properties should hold for ALL valid inputs, not just specific cases
4. **Use 100+ runs**: Set `{ numRuns: 100 }` minimum for meaningful coverage
5. **Place in `properties/` directory**: Use the `.prop.test.ts` suffix
6. **Document the requirement**: Add a JSDoc comment linking to the requirement being validated

### Common Arbitraries

```typescript
// UUID
const uuidArb = fc.uuid();

// Organization ID
const orgIdArb = fc.uuid();

// Phone number (E.164)
const phoneArb = fc.tuple(
  fc.integer({ min: 1, max: 999 }),
  fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 6, maxLength: 11 })
).map(([cc, sub]) => `+${cc}${sub}`);

// Email
const emailArb = fc.emailAddress();

// Member role
const roleArb = fc.constantFrom('owner', 'admin', 'agent', 'viewer');

// Conversation status
const statusArb = fc.constantFrom('open', 'pending', 'resolved', 'escalated');

// AI mode
const aiModeArb = fc.constantFrom('off', 'draft_only', 'auto_reply');

// Confidence score
const confidenceArb = fc.float({ min: 0, max: 1, noNaN: true });
```

---

## Writing New Unit Tests

### Template

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('YourService', () => {
  it('should do something specific', async () => {
    // 1. Create mock dependencies
    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue({ data: { id: '123' }, error: null }),
      }),
    };

    // 2. Create the service with mocked dependencies
    const service = new YourService(mockDb as any);

    // 3. Call the method
    const result = await service.doSomething('input');

    // 4. Assert the result
    expect(result).toBeDefined();
    expect(result.id).toBe('123');
  });
});
```

### Guidelines

1. **Mock all external dependencies**: Use `vi.fn()` for database clients, adapters, etc.
2. **Test one behavior per test**: Keep tests focused and descriptive
3. **Place in `unit/` directory**: Use the `.test.ts` suffix
4. **Follow existing patterns**: Look at `inbound-message-service.test.ts` for service test examples

---

## Integration Test Approach

Integration tests in `packages/support-core/__tests__/integration/` test full flows against a real database. They are currently stubs that document the expected behavior.

### Running Integration Tests

Integration tests require a running InsForge database. They are not included in the default `npm test` run.

```bash
# Run integration tests (requires database connection)
npx vitest run packages/support-core/__tests__/integration/
```

### Available Integration Tests

| Test | What It Verifies |
|------|-----------------|
| `inbound-sms-flow.test.ts` | Full SMS inbound → contact → conversation → message → job flow |
| `inbound-email-flow.test.ts` | Full email inbound flow |
| `outbound-message-flow.test.ts` | Reply → provider send → message record → delivery tracking |
| `rls-policies.test.ts` | RLS policies enforce tenant isolation |
| `realtime-events.test.ts` | Realtime events are published correctly |
| `seed-idempotency.test.ts` | Seed script can be run multiple times without duplicates |
