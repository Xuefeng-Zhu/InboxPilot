# packages/support-core/__tests__/ — Test Suite for Portable Business Logic

**Always loaded** for any work on support-core tests, mock factory patterns, or property-based correctness properties.

## OVERVIEW
39 test files for the portable business logic. Three categories: **24 unit tests** (mocked interfaces), **14 property-based tests** (fast-check, normally `numRuns: 100`), and **1 opt-in live seed integration suite** requiring a disposable InsForge branch. All local tests run via `npm test` from the root; live suites use the dedicated `npm run test:integration:*` commands.

## STRUCTURE
```
__tests__/
├── unit/                          24 files (*.test.ts, example-based)
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
├── properties/                    14 files (*.prop.test.ts, fast-check)
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
└── integration/                   1 opt-in live suite
    └── seed-idempotency.test.ts           guarded destructive seed replay
```

## WHERE TO LOOK
- **Add a unit test for a service** → `__tests__/unit/<service-name>.test.ts`. Use the canonical mock-factory pattern from `inbound-message-service.test.ts`.
- **Add a property test** → `__tests__/properties/<name>.prop.test.ts`. `numRuns: 100`, `fc.assert(fc.property(...))`.
- **Add an integration test** → put backend-facing live coverage under root `__tests__/insforge/`, guard it with `INBOXPILOT_LIVE_INTEGRATION=1`, and refuse production/non-`qa-*` projects before mutation.
- **Test a repository** → `__tests__/unit/<repo>-repository.test.ts` (uses `vi.fn()` chain stubs, not a real DB).
- **Test an adapter** → `__tests__/unit/<adapter>.test.ts` (instantiate the adapter directly, no HTTP-level mocking).

## CRITICAL RULES
1. **fast-check `numRuns: 100`** — uniform across the suite. The exception is at the root `__tests__/properties/design-tokens.property.test.ts:82` (50).
2. **Mock factories inlined per test file** — no shared `test-helpers/`. Each file declares its own `createMock*Repo()` and `SAMPLE_*` constants.
3. **Adapter tests use real instances, not mocks** — `MockSmsAdapter` / `MockEmailAdapter` are real test doubles with deterministic counters.
4. **Stub-adapter tests assert "not implemented"** — `sms-stubs.test.ts` and `email-stubs.test.ts` use `describe.each()` over the 4 SMS / 4 email stubs.
5. **Live integration tests are opt-in** — normal `npm test` skips remote mutation. Use only a linked disposable `qa-*` InsForge branch and the dedicated package script.

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
- Running live integration tests against production or an unbranched project.
- Using `vi.spyOn` instead of `vi.fn()` (project prefers the factory pattern).
- `as any` in production code (allowed in tests, but only as `as unknown as X`).

## UNIQUE
- **`audit-log.prop.test.ts` uses `import * as fc`** (the only support-core property test that does — the other 10 use `import fc from 'fast-check'`).
- **No integration placeholders remain.** Seed idempotency lives here; inbound/outbound, RLS, and realtime live suites live under root `__tests__/insforge/`.
- **`sms-stubs.test.ts` uses `describe.each()`** over the 4 SMS stub adapters — the only file that does so.
- **`twilio-sms-adapter.test.ts` and `telnyx-sms-adapter.test.ts` test webhook signature verification** with constructed inputs (no HTTP-level mocking).
- **No test-helpers, no __mocks__, no fixtures dirs** — entirely inlined per file.
- **Live integration suites are production-guarded** and clean up temporary organization fixtures; the seed suite recreates only the fixed seed organization on a disposable branch.
