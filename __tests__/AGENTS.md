# __tests__/ — Frontend Test Suite

**Always loaded** for any work on frontend tests, component tests, or property-based UI tests.

## OVERVIEW
16 test files at the repo root for frontend code. **3 test naming conventions** coexist:
- `*.test.ts` / `*.test.tsx` — example-based (api-auth, inbox, proxy/middleware, symphony, ui)
- `*.property.test.ts` / `*.property.test.tsx` — property-based (component properties, design tokens, sort stability)

Support-core has its own `__tests__/` (unit, properties, integration) — see `packages/support-core/__tests__/AGENTS.md`.

## STRUCTURE
```
__tests__/
├── api-auth.test.ts                       API route JWT auth (401/403 paths)
├── inbox-infinite-loading.test.tsx        Inbox pagination + scroll behavior
├── proxy.test.ts                          Next.js 16 root proxy routing/auth behavior
├── properties/                            Property-based component tests
│   ├── button.property.test.tsx
│   ├── conversation-item.property.test.tsx
│   ├── conversation-sort.property.test.ts
│   ├── design-tokens.property.test.ts     ⚠ Line 82 uses numRuns: 50 (only outlier)
│   ├── form-elements.property.test.tsx
│   ├── input-error.property.test.tsx
│   ├── message-bubble.property.test.tsx
│   ├── message-pagination.property.test.ts
│   └── status-badge.property.test.tsx
├── symphony/                              Symphony view component tests
│   ├── MiniMap.test.tsx
│   ├── River.test.tsx
│   └── RiverCard.test.tsx
└── ui/
    └── StatusBadge.test.tsx
```

## WHERE TO LOOK
- **Add a component test** → co-locate under `__tests__/<feature>/` or `__tests__/ui/` for primitives.
- **Add a property test** → `__tests__/properties/<name>.property.test.tsx`. Use `numRuns: 100` (one outlier at 50 in `design-tokens.property.test.ts:82`).
- **Test a Next.js API route** → `__tests__/api-auth.test.ts` shows the mock pattern for `_auth.ts`.

## CRITICAL RULES
- **Use `numRuns: 100`** for fast-check properties. (One outlier at 50 in `design-tokens.property.test.ts:82` — that's the exception, not the rule.)
- **Use `import * as fc from 'fast-check'`** at root tests (support-core mixes `import fc` and `import * as fc`).
- **Module-level `vi.mock()`** is acceptable at root; support-core prefers per-test `vi.fn()` factories.
- **Do not use `any` or TypeScript suppression directives.** Model narrow test doubles or cast through `unknown` to the exact framework type.

## CONVENTIONS
- **Module-level `vi.mock(...)` for Next.js hooks** — `inbox-infinite-loading.test.tsx` mocks `@/lib/auth-context`, `@/lib/queries`, `@/lib/use-realtime`, and stubs `cancelAnimationFrame` via `vi.stubGlobal`.
- **Property tests assert design invariants** (button always clickable, sort always stable, message bubble always renders sender correctly).
- **Component tests are user-facing** — they use `@testing-library/react` (not present in the explore but the patterns indicate it).
- **No shared `test-helpers/`** — every test file inlines its own setup.

## ANTI-PATTERNS
- `numRuns` < 50 (slow tests but the project prefers correctness).
- `console.log` in test files (use `expect` + assertions).
- Skipping the `<AppShell>` wrapper in component tests that depend on auth.
- Using `real timers` (use `vi.useFakeTimers` if you need to test debouncing).
- Importing from `packages/support-core/src/...` directly (use `@support-core/*` alias).

## UNIQUE
- **`design-tokens.property.test.ts:82` is the only file with `numRuns: 50`** — every other property test uses 100.
- **No `__mocks__/`, no `test-helpers/`, no `fixtures/` dirs** — every test inlines its own setup.
- **The 3 symphony tests cover only `River`, `MiniMap`, `RiverCard`** — not `SymphonyView`, `SymphonyControls`, `TimeAxis`, or `RiverExpandedPanel`. Gap.
- **`conversation-item.property.test.tsx` mocks `next/link`** — the only test that does so.
