# Testing

> Property-based testing as the primary correctness verification strategy, plus example-based unit tests, plus integration test stubs.

## Philosophy

InboxPilot uses **property-based testing** as the primary correctness strategy. Instead of testing individual examples, property tests generate hundreds of random inputs and verify that invariants (correctness properties) hold for all of them. This catches edge cases that example-based tests miss — particularly around input normalization, state machine transitions, JSON round-trips, permission boundaries, and threshold-based decisions.

### Tooling

- **Vitest** as the test runner.
- **fast-check** (v3.19+) for property generation.
- **React Testing Library** for UI component tests.
- **jsdom** for browser-like test environment.
- **Example-based unit tests** for service-level logic with mocks.
- **Integration test stubs** for database-dependent flows (require a real DB to run).

### Test file patterns

- `*.test.ts` — example-based unit tests.
- `*.prop.test.ts` — property-based tests (fast-check).
- `*.property.test.ts` / `*.property.test.tsx` — UI property tests (also fast-check).

---

## Test organization

```
__tests__/                                  # Top-level UI tests (vitest, jsdom env)
  ├── middleware.test.ts
  ├── properties/                           # UI property-based tests (fast-check)
  │   ├── button.property.test.tsx
  │   ├── conversation-item.property.test.tsx
  │   ├── design-tokens.property.test.ts
  │   ├── form-elements.property.test.tsx
  │   ├── input-error.property.test.tsx
  │   ├── message-bubble.property.test.tsx
  │   ├── metric-card.property.test.tsx
  │   ├── navigation.property.test.tsx
  │   └── status-badge.property.test.tsx
  └── ui/                                   # UI example-based tests
      └── StatusBadge.test.tsx

packages/support-core/__tests__/            # support-core tests (vitest, node env)
  ├── properties/                           # support-core property-based tests
  │   ├── ai-decision.prop.test.ts
  │   ├── audit-log.prop.test.ts
  │   ├── auto-reply.prop.test.ts
  │   ├── deduplication.prop.test.ts
  │   ├── escalation.prop.test.ts
  │   ├── job-queue.prop.test.ts
  │   ├── knowledge.prop.test.ts
  │   ├── normalization.prop.test.ts
  │   ├── rbac.prop.test.ts
  │   ├── state-machine.prop.test.ts
  │   └── webhook-roundtrip.prop.test.ts
  ├── unit/                                 # support-core unit tests
  │   ├── ai-agent-service.test.ts
  │   ├── contact-repository.test.ts
  │   ├── conversation-repository.test.ts
  │   ├── conversation-service.test.ts
  │   ├── email-stubs.test.ts
  │   ├── escalation-engine.test.ts
  │   ├── inbound-message-service.test.ts
  │   ├── knowledge-ingestion-service.test.ts
  │   ├── message-repository.test.ts
  │   ├── mock-email-adapter.test.ts
  │   ├── mock-sms-adapter.test.ts
  │   ├── normalization.test.ts
  │   ├── outbound-message-service.test.ts
  │   ├── postmark-email-adapter.test.ts
  │   ├── sms-stubs.test.ts
  │   ├── telnyx-sms-adapter.test.ts
  │   └── twilio-sms-adapter.test.ts
  └── integration/                          # Integration test stubs (require real DB)
      ├── inbound-email-flow.test.ts
      ├── inbound-sms-flow.test.ts
      ├── outbound-message-flow.test.ts
      ├── realtime-events.test.ts
      ├── rls-policies.test.ts
      └── seed-idempotency.test.ts
```

The test runner is configured in `vitest.config.ts` to pick up both `__tests__/**` and `packages/support-core/__tests__/**`, with both `.test.ts(x)` and `.prop.test.ts` / `.property.test.ts(x)` patterns.

---

## Running tests

### All tests

```bash
npm test
```

Runs every test file (Vitest with `run` mode, single pass, then exits).

### Watch mode

```bash
npm run test:watch
```

Useful while writing a new test.

### support-core tests only

```bash
npm run test:core
```

Uses Vitest's `--project support-core` (if configured) or a path filter. Run this when you only want to iterate on business logic.

### By directory

```bash
# Property-based tests
npx vitest run packages/support-core/__tests__/properties/
npx vitest run __tests__/properties/

# Unit tests
npx vitest run packages/support-core/__tests__/unit/
npx vitest run __tests__/ui/

# Integration tests
npx vitest run packages/support-core/__tests__/integration/

# Middleware test
npx vitest run __tests__/middleware.test.ts
```

### By file or pattern

```bash
# Single file
npx vitest run packages/support-core/__tests__/properties/escalation.prop.test.ts

# By test name
npx vitest run -t "normalizePhone"
```

### Test config

`vitest.config.ts`:
- Environment: `node` (default; UI tests use jsdom via per-file directive or may need a separate project)
- Globals: enabled (no need to `import { describe, it, expect } from 'vitest'`)
- Path aliases: `@support-core` → `packages/support-core/src`, `@` → repo root

---

## Correctness properties

The support-core test suite defines 17 correctness properties (each runs 100+ iterations with randomly generated inputs). They cover every meaningful invariant the system relies on.

| # | Property | File | What it verifies |
|---|---|---|---|
| 1 | Phone normalization idempotence | `normalization.prop.test.ts` | `normalizePhone(normalizePhone(x)) === normalizePhone(x)` for all input formats |
| 2 | Email normalization idempotence | `normalization.prop.test.ts` | Same, for email addresses |
| 3 | SMS webhook round-trip | `webhook-roundtrip.prop.test.ts` | Parsing an SMS payload via the adapter preserves `from`, `to`, `body`, `externalMessageId` |
| 4 | Email webhook round-trip | `webhook-roundtrip.prop.test.ts` | Same for email (adds `subject`, `bodyText`) |
| 5 | AI decision JSON round-trip | `ai-decision.prop.test.ts` | `parseAiDecision(JSON.stringify(decision))` returns the same decision |
| 6 | Escalation: human request | `escalation.prop.test.ts` | `HumanRequestRule` triggers for any message containing a human-request phrase |
| 7 | Escalation: profanity/anger | `escalation.prop.test.ts` | `ProfanityAngerRule` triggers for messages with profanity or anger indicators |
| 8 | Escalation: sensitive topic | `escalation.prop.test.ts` | `SensitiveTopicRule` triggers for legal/chargeback/refund/cancellation phrases |
| 9 | Message deduplication | `deduplication.prop.test.ts` | Inserting two messages with the same `(provider, external_message_id)` results in one record (DB-level) |
| 10 | Job queue exponential backoff | `job-queue.prop.test.ts` | After failure, `run_after = now() + 2^attempts seconds` |
| 11 | Job queue dead-lettering | `job-queue.prop.test.ts` | `attempts >= max_attempts` → status `dead`, never re-claimed |
| 12 | Auto-reply threshold gating | `auto-reply.prop.test.ts` | In `auto_reply` mode, high-confidence responses send; low-confidence become drafts |
| 13 | Conversation state machine | `state-machine.prop.test.ts` | Invalid status transitions (e.g. `resolved → escalated` without reopen) are rejected |
| 14 | RBAC permission enforcement | `rbac.prop.test.ts` | `hasPermission(role, p)` returns `true` only if the role's allow-set contains `p`. Verifies the complete matrix. |
| 15 | Audit log immutability | `audit-log.prop.test.ts` | Audit log rows can be inserted and read, but UPDATE/DELETE are denied (RLS) |
| 16 | Knowledge chunk similarity | `knowledge.prop.test.ts` | `match_knowledge_chunks` returns rows ordered by descending similarity above the threshold |
| 17 | Escalation: safety concern | `escalation.prop.test.ts` | `SafetyConcernRule` triggers for security/medical/legal/safety phrases |

Each property test runs `numRuns: 100` by default. The fast-check arbitrary is documented at the top of each test file.

---

## UI property tests

The `__tests__/properties/` directory contains 9 fast-check-driven property tests for UI components. These verify component invariants against arbitrary prop shapes (e.g. "the StatusBadge never renders an empty label", "the MessageBubble always renders a body", "the navigation component never has two items with the same path").

| File | Component(s) |
|---|---|
| `button.property.test.tsx` | Button |
| `conversation-item.property.test.tsx` | ConversationItem |
| `design-tokens.property.test.ts` | (design-token constants) |
| `form-elements.property.test.tsx` | Input, Select, Textarea |
| `input-error.property.test.tsx` | Input with error state |
| `message-bubble.property.test.tsx` | MessageBubble |
| `metric-card.property.test.tsx` | MetricCard |
| `navigation.property.test.tsx` | Sidebar / NavItem |
| `status-badge.property.test.tsx` | StatusBadge |

These run in jsdom (Vitest's default `environment: 'node'` is overridden per-file with `// @vitest-environment jsdom` at the top, or via test config).

---

## Writing new property tests

### Template (support-core)

```typescript
import { describe, it } from 'vitest';
import fc from 'fast-check';

describe('MyFeature property tests', () => {
  it('Property N: description of the invariant', () => {
    const inputArb = fc.record({
      field1: fc.string({ minLength: 1 }),
      field2: fc.integer({ min: 0, max: 100 }),
    });

    fc.assert(
      fc.property(inputArb, (input) => {
        const result = myFunction(input);
        return result.someInvariant === true;
      }),
      { numRuns: 100 },
    );
  });
});
```

### Template (UI)

```tsx
/** @vitest-environment jsdom */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import { MyComponent } from '@/components/MyComponent';

describe('MyComponent property tests', () => {
  it('Property N: description', () => {
    const propsArb = fc.record({ /* ... */ });
    fc.assert(
      fc.property(propsArb, (props) => {
        const { container } = render(<MyComponent {...props} />);
        // assert some invariant on container
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
```

### Common arbitraries

```typescript
// UUIDs
const uuidArb = fc.uuid();

// Phone (E.164)
const phoneArb = fc.tuple(
  fc.integer({ min: 1, max: 999 }),
  fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 6, maxLength: 11 }),
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

### Guidelines

1. **Name the property clearly** — "Property N: <invariant description>".
2. **Generate realistic inputs** — use `fc.oneof`, `fc.constantFrom`, and custom arbitraries to cover the input space.
3. **Test invariants, not examples** — properties should hold for ALL valid inputs.
4. **Use 100+ runs** — set `{ numRuns: 100 }` minimum. Increase for properties that are slow or rarely fail.
5. **Document the requirement** — add a JSDoc comment linking to the requirement being validated.
6. **Place in `properties/`** with `.prop.test.ts` suffix for support-core, `.property.test.tsx` for UI.

---

## Writing new unit tests

### Template

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MyService', () => {
  it('does X when given Y', async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue({ data: { id: '123' }, error: null }),
      }),
    };

    const service = new MyService(mockDb as any);
    const result = await service.doSomething('input');

    expect(result).toBeDefined();
    expect(result.id).toBe('123');
  });
});
```

### Guidelines

- **Mock all external dependencies** — DB clients, adapters, AI clients, etc.
- **Test one behavior per `it`** — keep tests focused and descriptive.
- **Use `vi.fn()` not Jest-style** — Vitest doesn't auto-mock.
- **Match existing patterns** — see `inbound-message-service.test.ts` for the canonical service test.

---

## Integration tests

Integration tests live in `packages/support-core/__tests__/integration/`. They are stubs — the test names and descriptions are present, but the bodies are placeholders. To run them you need a real InsForge database.

| Stub | What it would verify |
|---|---|
| `inbound-sms-flow.test.ts` | Full SMS inbound → contact → conversation → message → job flow |
| `inbound-email-flow.test.ts` | Full email inbound flow |
| `outbound-message-flow.test.ts` | Reply → provider send → message record → delivery tracking |
| `rls-policies.test.ts` | RLS policies enforce tenant isolation |
| `realtime-events.test.ts` | Realtime events are published correctly |
| `seed-idempotency.test.ts` | Seed script can be run multiple times without duplicates |

To enable: implement each test using the same `DatabaseClient` interface that the services use, and run `npx vitest run packages/support-core/__tests__/integration/`.
