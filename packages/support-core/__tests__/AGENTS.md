# packages/support-core/__tests__/ — Test Suite for Portable Business Logic

**Always loaded** for any work on support-core tests, mock factory patterns, or property-based correctness properties.

## OVERVIEW
35 test files for the portable business logic. Three categories: **18 unit tests** (mocked interfaces), **11 property-based tests** (fast-check, `numRuns: 100`), and **6 integration stubs** (100% `it.todo` placeholders requiring a real DB). All run via `cd packages/support-core && npm test` or `npm test` from the root.

## STRUCTURE
```
__tests__/
├── unit/                          18 files (*.test.ts, example-based)
│   ├── inbound-message-service.test.ts    canonical mock factory pattern
│   ├── outbound-message-service.test.ts   most extensive vi.mocked() usage
│   ├── ai-agent-service.test.ts           mocks AI + JobQueue + repos
│   ├── conversation-service.test.ts       small, 4 vi.fn refs
│   ├── conversation-repository.test.ts    23 vi.fn refs
│   ├── contact-repository.test.ts         23 vi.fn refs
│   ├── message-repository.test.ts         23 vi.fn refs
│   ├── knowledge-ingestion-service.test.ts
│   ├── escalation-engine.test.ts
│   ├── normalization.test.ts
│   ├── postmark-email-adapter.test.ts
│   ├── twilio-sms-adapter.test.ts
│   ├── telnyx-sms-adapter.test.ts
│   ├── mock-sms-adapter.test.ts           real test double (not mocked)
│   ├── mock-email-adapter.test.ts         real test double (not mocked)
│   ├── sms-stubs.test.ts                  describe.each() over stub adapters
│   └── email-stubs.test.ts
├── properties/                    11 files (*.prop.test.ts, fast-check)
│   ├── ai-decision.prop.test.ts           JSON round-trip
│   ├── audit-log.prop.test.ts             immutability (uses `import * as fc`)
│   ├── auto-reply.prop.test.ts            threshold gating
│   ├── deduplication.prop.test.ts
│   ├── escalation.prop.test.ts
│   ├── job-queue.prop.test.ts             backoff + dead-letter
│   ├── knowledge.prop.test.ts             chunk similarity
│   ├── normalization.prop.test.ts
│   ├── rbac.prop.test.ts                  13 properties
│   ├── state-machine.prop.test.ts
│   └── webhook-roundtrip.prop.test.ts
└── integration/                   6 files, ALL 100% it.todo placeholders
    ├── inbound-email-flow.test.ts         7 it.todo
    ├── inbound-sms-flow.test.ts           7 it.todo
    ├── outbound-message-flow.test.ts      7 it.todo
    ├── realtime-events.test.ts             8 it.todo
    ├── rls-policies.test.ts                9 it.todo
    └── seed-idempotency.test.ts            7 it.todo
```

## WHERE TO LOOK
- **Add a unit test for a service** → `__tests__/unit/<service-name>.test.ts`. Use the canonical mock-factory pattern from `inbound-message-service.test.ts`.
- **Add a property test** → `__tests__/properties/<name>.prop.test.ts`. `numRuns: 100`, `fc.assert(fc.property(...))`.
- **Implement an integration test** → the placeholders describe what to test. Need a real InsForge DB.
- **Test a repository** → `__tests__/unit/<repo>-repository.test.ts` (uses `vi.fn()` chain stubs, not a real DB).
- **Test an adapter** → `__tests__/unit/<adapter>.test.ts` (instantiate the adapter directly, no HTTP-level mocking).

## CRITICAL RULES
1. **fast-check `numRuns: 100`** — uniform across the suite. The exception is at the root `__tests__/properties/design-tokens.property.test.ts:82` (50).
2. **Mock factories inlined per test file** — no shared `test-helpers/`. Each file declares its own `createMock*Repo()` and `SAMPLE_*` constants.
3. **Adapter tests use real instances, not mocks** — `MockSmsAdapter` / `MockEmailAdapter` are real test doubles with deterministic counters.
4. **Stub-adapter tests assert "not implemented"** — `sms-stubs.test.ts` and `email-stubs.test.ts` use `describe.each()` over the 4 SMS / 4 email stubs.
5. **Integration tests are placeholders** — don't run them; they need a real InsForge DB.

## CONVENTIONS
### Mock factory pattern (from `inbound-message-service.test.ts`):
```ts
function createMockContactRepo(): ContactRepository {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_CONTACT),
    update: vi.fn(),
  } as unknown as ContactRepository;
}
```
Used for: ContactRepo, ConversationRepo, MessageRepo, AuditLogRepo, KnowledgeRepo, ProviderAccount × 2, AiSettingsRepo, AiDecisionRepo, JobQueue, AiClient, ProviderRegistry, adapter methods.

### Per-test override:
```ts
vi.mocked(mockOutbound.process).mockResolvedValueOnce({ ok: true });
```

### Property test pattern:
```ts
import fc from 'fast-check';  // or `import * as fc from 'fast-check'`
it('round-trips', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      return parseX(serializeX(s)) === s;
    }),
    { numRuns: 100 }
  );
});
```

## ANTI-PATTERNS
- Sharing mock factories across files (each file inlines; no `test-helpers/`).
- Using `vi.mock()` at the module level in support-core tests (preference: per-test `vi.fn()` factories).
- Setting `numRuns: < 50` (slow tests but correctness matters more).
- Mocking `MockSmsAdapter` / `MockEmailAdapter` (use as real test doubles).
- Implementing the integration test stubs without a real InsForge DB (they stay placeholders).
- Using `vi.spyOn` instead of `vi.fn()` (project prefers the factory pattern).
- `as any` in production code (allowed in tests, but only as `as unknown as X`).

## UNIQUE
- **`audit-log.prop.test.ts` uses `import * as fc`** (the only support-core property test that does — the other 10 use `import fc from 'fast-check'`).
- **45 `it.todo` placeholders across 6 integration files** — pass as "todo" without exercising code. Mark this when adding CI dashboards.
- **`sms-stubs.test.ts` uses `describe.each()`** over the 4 SMS stub adapters — the only file that does so.
- **`twilio-sms-adapter.test.ts` and `telnyx-sms-adapter.test.ts` test webhook signature verification** with constructed inputs (no HTTP-level mocking).
- **No test-helpers, no __mocks__, no fixtures dirs** — entirely inlined per file.
- **The integration test placeholders are executable documentation** of expected integration scenarios — they describe what the tests SHOULD do but can't yet.
