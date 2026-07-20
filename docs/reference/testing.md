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
__tests__/                                  # Frontend, route, and function tests
  ├── api/                                  # Direct coverage for all 12 privileged routes
  ├── auth/                                 # Password-recovery flows
  ├── hooks/                                # React Query and state hooks
  ├── inbox/                                # Inbox and Kanban components
  ├── insforge/                             # Function/runtime contracts
  ├── knowledge/                            # Knowledge UI, mutations, and storage
  ├── properties/                           # Frontend property tests (fast-check)
  │   ├── button.property.test.tsx
  │   ├── conversation-item.property.test.tsx
  │   ├── conversation-sort.property.test.ts
  │   ├── design-tokens.property.test.ts
  │   ├── form-elements.property.test.tsx
  │   ├── format-response-time.property.test.ts
  │   ├── input-error.property.test.tsx
  │   ├── lane-filters.prop.test.ts
  │   ├── message-bubble.property.test.tsx
  │   ├── message-pagination.property.test.ts
  │   ├── status-badge.property.test.tsx
  │   └── symphony-window.property.test.ts
  ├── proxy.test.ts                         # Exercises root proxy.ts
  ├── symphony/                             # Symphony components and hook behavior
  ├── ui/                                   # Shared UI example tests
  └── wchat/                                # Widget and iframe flows

packages/support-core/__tests__/            # support-core tests (vitest, node env)
  ├── properties/                           # support-core property-based tests
  │   ├── ai-decision.prop.test.ts
  │   ├── audit-log.prop.test.ts
  │   ├── auto-reply.prop.test.ts
  │   ├── chat-model-passthrough.prop.test.ts
  │   ├── deduplication.prop.test.ts
  │   ├── escalation.prop.test.ts
  │   ├── job-queue.prop.test.ts
  │   ├── knowledge.prop.test.ts
  │   ├── normalization.prop.test.ts
  │   ├── rbac.prop.test.ts
  │   ├── state-machine.prop.test.ts
  │   └── webhook-roundtrip.prop.test.ts
  ├── unit/                                 # Services, repositories, adapters, utilities
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

Runs the `packages/support-core/__tests__` path directly. Run this when you only want to iterate on portable business logic.

### Static checks

```bash
npm run lint
```

Runs TypeScript with `tsc --noEmit`, the Deno safety scan, and `deno check` over all 9 InsForge function entrypoints.

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

# Next.js proxy test (legacy test filename)
npx vitest run __tests__/proxy.test.ts
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

The support-core suite preserves the original 17 numbered correctness properties. Most use 100+ generated inputs; a few structural properties validate a class or repository's public shape directly. Additional unnumbered property suites, such as chat-model passthrough, extend that baseline.

| # | Property | File | What it verifies |
|---|---|---|---|
| 1 | Phone normalization idempotence | `normalization.prop.test.ts` | `normalizePhone(normalizePhone(x)) === normalizePhone(x)` for all input formats |
| 2 | Email normalization idempotence | `normalization.prop.test.ts` | Same, for email addresses |
| 3 | Webhook normalization round-trip | `webhook-roundtrip.prop.test.ts` | Mock, Twilio, Telnyx, and Postmark normalization preserves channel-specific payload fields |
| 4 | Valid AI decision JSON round-trip | `ai-decision.prop.test.ts` | `parseAiDecision(JSON.stringify(decision))` returns the same decision |
| 5 | Invalid AI decision rejection | `ai-decision.prop.test.ts` | Invalid JSON and non-conforming objects always fail parsing |
| 6 | Escalation rules | `escalation.prop.test.ts` | Trigger phrases, repeated failures, configured keywords, and clean messages follow deterministic rules |
| 7 | Message deduplication | `deduplication.prop.test.ts` | Replaying a `(provider, externalMessageId)` creates one message |
| 8 | Job backoff and dead-lettering | `job-queue.prop.test.ts` | Failure applies exponential backoff or moves exhausted jobs to `dead` |
| 9 | Job enqueue idempotency | `job-queue.prop.test.ts` | Equivalent jobs reuse the existing active or completed work item |
| 10 | Job claim limit | `job-queue.prop.test.ts` | `claim(N)` returns at most N claimable jobs |
| 11 | Auto-reply threshold gating | `auto-reply.prop.test.ts` | Auto-send occurs only in `auto_reply` mode above threshold without human escalation |
| 12 | Conversation state contract | `state-machine.prop.test.ts` | Valid status/AI-state values survive repository updates and round trips |
| 13 | Organization owner invariant | `rbac.prop.test.ts` | Organization operations preserve exactly one owner |
| 14 | RBAC permission enforcement | `rbac.prop.test.ts` | Role permission sets and hierarchy match the canonical matrix |
| 15 | Audit log immutability | `audit-log.prop.test.ts` | The repository exposes append-only creation, not update/delete operations |
| 16 | Knowledge chunk similarity | `knowledge.prop.test.ts` | `matchChunks` results remain above threshold and ordered by descending similarity |
| 17 | Document chunking coverage | `knowledge.prop.test.ts` | Chunking produces output and preserves the source text content |

Generated properties use `numRuns: 100` by default. Structural contract checks do not invoke fast-check.

---

## UI property tests

The `__tests__/properties/` directory contains 12 fast-check-driven property files for frontend components and pure presentation/state helpers.

| File | Component(s) |
|---|---|
| `button.property.test.tsx` | Button |
| `conversation-item.property.test.tsx` | ConversationItem |
| `conversation-sort.property.test.ts` | Conversation activity sorting |
| `design-tokens.property.test.ts` | (design-token constants) |
| `form-elements.property.test.tsx` | Input, Select, Textarea |
| `format-response-time.property.test.ts` | Analytics response-time formatting |
| `input-error.property.test.tsx` | Input with error state |
| `lane-filters.prop.test.ts` | Kanban lane routing and filtering |
| `message-bubble.property.test.tsx` | MessageBubble |
| `message-pagination.property.test.ts` | Message page flattening and offsets |
| `status-badge.property.test.tsx` | StatusBadge |
| `symphony-window.property.test.ts` | Symphony time windows and axis ticks |

Component `.tsx` properties opt into jsdom with a per-file directive; pure `.ts` helper properties use Vitest's default Node environment.

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
    interface RecordLoader {
      load(id: string): Promise<{ id: string }>;
    }
    const loader: RecordLoader = {
      load: vi.fn().mockResolvedValue({ id: '123' }),
    };

    const service = new MyService(loader);
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
