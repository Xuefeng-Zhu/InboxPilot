# packages/support-core/src/repositories/ — Data Access Layer

## OVERVIEW
15 `*Repository` classes. One per DB table or table group. **All follow the identical constructor pattern** and `toEntity()` / `toRow()` hand-rolled row mapping. No ORM, no `class-transformer`.

## THE 15 REPOS
| Repository | Tables | Notes |
|---|---|---|
| `ContactRepository` | `contacts` | |
| `ConversationRepository` | `conversations` | |
| `MessageRepository` | `messages` | |
| `OrganizationRepository` | `organizations` | |
| `MemberRepository` | `organization_members` | |
| `AiSettingsRepository` | `ai_settings` | |
| `AiDecisionRepository` | `ai_decisions` | |
| `JobRepository` | `support_jobs` | Low-level CRUD; the orchestrator is `services/postgres-job-queue.ts` |
| `KnowledgeRepository` | `knowledge_documents` + `knowledge_chunks` | Also calls `match_knowledge_chunks` RPC for RAG |
| `AuditLogRepository` | `audit_logs` | **Append-only** — no update/delete methods |
| `SmsProviderAccountRepository` | `sms_provider_accounts` + `sms_phone_numbers` | |
| `EmailProviderAccountRepository` | `email_provider_accounts` + `email_addresses` | |
| `DeliveryEventRepository` | `sms_delivery_events` + `email_delivery_events` | Unified by `channel` |
| `WebchatWidgetRepository` | `webchat_widgets` | |
| `WebchatThreadRepository` | `webchat_threads` | |

## CANONICAL PATTERN
```ts
export class ContactRepository {
  constructor(private db: DatabaseClient) {}

  // Reads: this.db.from('contacts').select('*').eq('id', id).single()...
  // Writes: this.db.from('contacts').insert([row]).select()...
  // Errors: if (error) throw new Error('Contact lookup failed: ' + error.message)

  private toEntity(row: ContactRow): Contact { /* snake_case → camelCase */ }
  private toRow(entity: Contact): ContactRow { /* camelCase → snake_case */ }
}
```

## WHERE TO LOOK
- **Add a new table** → write migration in `insforge/migrations/`, then copy `contact-repository.ts`, rename, write the two row mappers, add methods.
- **Add a method to an existing repo** → check the canonical `ContactRepository` for the established chainable-query + throw-on-error pattern.
- **Test a repo** → `__tests__/unit/contact-repository.test.ts` is the template (it does NOT use `createMockXxxRepo()` — repos are tested against a real `DatabaseClient` mock via `vi.fn()` chain stubs).

## CONVENTIONS
- **Constructor takes `DatabaseClient` only.** Never inject `insforge`, `fetch`, or anything specific.
- **All query errors throw `new Error('…: ' + error.message)`.** No custom error class.
- **Return typed entities** (`Contact`, `Conversation`, etc. from `src/types/index.ts`), not raw rows.
- **Single-row queries use `.single()`; multi-row queries return arrays.**
- **Audit log repo is the only one with no `update`/`delete` methods** (append-only contract).

## ANTI-PATTERNS
- Returning raw DB rows (always map via `toEntity()`).
- Catching and swallowing errors (services depend on thrown errors to abort).
- Injecting anything besides `DatabaseClient`.
- Adding repository methods that cross table boundaries (use two repos + a service).
- `as any` (use `unknown` + `Record<string, unknown>`).

## UNIQUE
- Docs say "16 repositories" — that's wrong. The 16th data-access role is `PostgresJobQueue` (lives in `services/`, implements `JobQueue`, carries orchestration logic — idempotency, backoff, dead-lettering — not table CRUD).
- `KnowledgeRepository` is the only repo that calls an RPC (`match_knowledge_chunks`).
- `DeliveryEventRepository` unifies two channel-specific tables behind a single class.
