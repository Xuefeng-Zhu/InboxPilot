# packages/support-core/src/interfaces/ — DI Contracts

## OVERVIEW
Provider-neutral contracts. Everything outside `support-core/` (Deno functions, Next.js API routes, tests) depends on these types — never on the concrete classes from `repositories/`, `services/`, or `adapters/`.

## THE 8 INTERFACES
| Interface | Concrete impl in support-core | Implemented at entrypoint layer by |
|---|---|---|
| `DatabaseClient` | (none — pure type) | `insforge/functions/_shared/create-db-client.ts` (PostgREST query builder) |
| `QueryBuilder`, `QueryResult`, `QueryError` | (none — pure types) | same PostgREST builder |
| `SmsProviderAdapter` | `MockSmsAdapter`, `TwilioSmsAdapter`, `TelnyxSmsAdapter` + 4 stubs | `insforge/functions/*-inbound/index.ts` (via `ProviderRegistry`) |
| `EmailProviderAdapter` | `MockEmailAdapter`, `PostmarkEmailAdapter` + 4 stubs | same |
| `JobQueue` | `PostgresJobQueue` (in `services/`) | Used directly by inbound functions and `process-jobs` with the injected `DatabaseClient` |
| `AiClient` | (none in support-core) | OpenRouter via OpenAI-compatible client (constructed at function entrypoints) |
| `RealtimePublisher` | (none in support-core) | `insforge/functions/_shared/create-realtime-publisher.ts` (REST broadcast) |
| `ProviderRegistry` | (concrete class — runtime DI for adapters) | populated at each function entrypoint that needs SMS/email |
| `EscalationRule` / `EscalationEngine` | `EscalationEngine` (concrete class) + 8 rules in `services/escalation-rules.ts` | constructed by `createDefaultEscalationEngine()` |

## WHERE TO LOOK
- **Add a new external dependency** (e.g., a payments provider) → define a new interface here first. Then implementations in `adapters/` (or `services/`), and a binding in the entrypoint.
- **Bind a real SDK to an interface** → done in `insforge/functions/_shared/` (e.g., `create-db-client.ts` is the `DatabaseClient` binding to InsForge PostgREST).
- **Add a new escalation rule** → implement `EscalationRule` from `escalation.ts`; register in `createDefaultEscalationEngine()`.

## CONVENTIONS
- **Interfaces are types-only except `ProviderRegistry` and `EscalationEngine`** (the latter two are runtime DI registries).
- **No method should have implementation logic** in the interface file. Types, signatures, JSDoc — that's it.
- **Concrete classes that implement these interfaces live in `adapters/`, `services/`, or `repositories/`** — not here.
- **Adding a new method to an interface is a breaking change** for every mock that implements it. Plan accordingly.

## ANTI-PATTERNS
- Importing from `@insforge/*` inside an interface file (breaks portability — the whole point).
- Adding a default method implementation to an interface.
- Conflating "interface" with "abstract class" (no shared state, no inheritance — pure shape).
- Putting concrete types in the same file as the interface (separate them).

## UNIQUE
- **The `ProviderRegistry` is the only mutable runtime registry in support-core.** It maps `providerId` → adapter. Populated once at function startup, then read-only.
- **`EscalationEngine` short-circuits on first match** — rule order matters. `LowConfidenceRule` has a separate `evaluateConfidence()` called post-LLM by `AiAgentService`, not the engine chain.
- **`PostgresJobQueue` is the single production `JobQueue` implementation.** Tests use small in-memory/mock implementations of the same interface.
- **Real `AiClient` impl is NOT in support-core** — it's constructed at the function entrypoint using OpenRouter's OpenAI-compatible API. `AiAgentService` depends only on the `AiClient` interface.
