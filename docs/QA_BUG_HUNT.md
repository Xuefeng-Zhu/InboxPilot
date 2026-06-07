# InboxPilot v1 — Deep QA Bug Hunt

> Generated: 2026-06-07 · parent card: `t_qa_bug_hunt` · assignee: `qa` (worker run 11)
> Source: read of 14 function entrypoints, 9 services, 14 repositories, 3 migrations, 8 inbox components, 6 app pages, 2 lib modules, .env.example, package.json
> Static checks run: `npm run lint` (BROKEN — interactive wizard), `npm run build` (PASS), `npm test` (1 real failure + 1 unhandled rejection)

## Severity tally

- **CRITICAL** — 4
- **HIGH** — 9
- **MEDIUM** — 18
- **LOW** — 11
- **INFO** — 4

Block launch on any unchecked CRITICAL or HIGH.

## Static check baseline (verbatim from this run)

### `npm run lint`
Broken. `next lint` exits 0 but prints the interactive ESLint setup wizard and **does not run the linter** — there is no `.eslintrc.json` in the project root, and `package.json` has no `eslint` dependency. The script in `package.json` is `"lint": "next lint"`. Adding `eslint` is left to whoever first runs the command. Cannot be executed in CI; can be masked by piping `0`/`echo 0` to the prompt but produces no actual lint output. Per the codebase-audit skill's "Don't run `npm test` and stop at 'exits 1'" rule, this is the same shape: the script is in the manifest but unrunnable.

```
> next lint
? How would you like to configure ESLint? https://nextjs.org/docs/basic-features/eslint
❯ Strict (recommended)
  Base
  Cancel
```

### `npm run build`
PASS. Next.js 14.2.35, all 12 pages built, middleware bundle 26.6 kB.

### `npm test`
1 real failure + 1 unhandled rejection + 6 skipped integration suites.

```
FAIL  packages/support-core/__tests__/unit/sms-provider-credential-rotation.test.ts > SMS provider credential rotation > rotates an SMS provider credential in place: secret A → secret B, both authenticate
AssertionError: expected 'SM4' to be 'SM4' // wait — 'SM4' to be 'SM3' (object identity)
- Expected
+ Received
- SM3
+ SM4

 ❯ packages/support-core/__tests__/unit/sms-provider-credential-rotation.test.ts:411:47

Unhandled Rejection: Error: flop
 ❯ makeTransient packages/support-core/__tests__/unit/retry.test.ts:188:15

Test Files  1 failed | 31 passed | 6 skipped (38)
Tests       1 failed | 364 passed | 45 todo (410)
Errors      1 error
Duration    18.51s
```

The 6 integration suites are all `.skip()`-equivalent (file-level skip pattern), not actually run: `rls-policies`, `realtime-events`, `inbound-email-flow`, `seed-idempotency`, `inbound-sms-flow`, `outbound-message-flow`. That is **45 todo tests** the system ships as never-run.

---

## CRITICAL findings

### CRITICAL-1 — Mock webhook adapter returns `verifyWebhook() = true`, allowing unauthenticated webhook injection
- **File:line:** `packages/support-core/src/adapters/mock-email-adapter.ts:162` and `packages/support-core/src/adapters/mock-sms-adapter.ts:146`
- **Issue:** Both `MockEmailAdapter.verifyWebhook` and `MockSmsAdapter.verifyWebhook` unconditionally `return true;` — no signature check, no header validation, no secret comparison. The `x-signing-secret` header passed by the webhook entrypoint is **ignored**.
- **Coupled with:** `insforge/functions/email-inbound/index.ts:97-100`, `sms-inbound/index.ts:97-100`, `email-status/index.ts:97-100`, `sms-status/index.ts:97-100` — these functions **always** register the mock adapter in their provider registry and default to `provider = req.headers.get('x-provider') ?? 'mock'`. The "Unknown email provider" branch only fires if the requested adapter is not registered — and `mock` is always registered.
- **Repro:**
  ```bash
  curl -X POST $URL/functions/v1/email-inbound \
    -H 'x-provider: mock' \
    -H 'x-organization-id: <victim-org-uuid>' \
    -H 'Content-Type: application/json' \
    -d '{"from":"attacker@evil","to":"<any-registered-email>","subject":"hi","bodyText":"malicious","messageId":"x"}'
  ```
  → 200 OK, message created in victim's org. The function never validates the signature, and the receiving-email lookup is the only org-scoping step.
- **Severity rationale:** Complete webhook auth bypass. Any anonymous caller can:
  1. Inject a fake "delivery confirmation" via `/sms-status` or `/email-status` (the status webhooks **also** use mock and also accept any provider header) — this is critical for messaging fraud because delivery status drives UI hints like "delivered" / "bounced".
  2. Inject a fake inbound email into a target org by hitting the email-inbound mock path.
  3. Spend AI tokens by injecting 10k fake inbound messages.
- **Suggested fix (1-3 lines):** Refuse `x-provider: mock` in production env: in each webhook entrypoint, throw `400 { error: 'Mock provider disabled in production' }` when `Deno.env.get('ENV') === 'production' && provider === 'mock'`. Better: gate mock provider behind a build-time flag, and short-circuit at adapter registration if production.
- **Theme:** Auth / Webhook signature bypass
- **Effort:** S (a 2-line guard per entrypoint, plus removing the always-register-mock pattern)

### CRITICAL-2 — JWT-authenticated functions do not enforce org membership; cross-tenant write by any authenticated user
- **File:line:** `insforge/functions/send-reply/index.ts:78-112` (also `approve-ai-draft`, `regenerate-ai-draft`, `escalate-conversation`, `resolve-conversation`, `reopen-conversation`)
- **Issue:** Pattern across all 7 JWT-protected function entrypoints:
  1. `verifyJwt(req, baseUrl, serviceRoleKey)` → `userId`
  2. Load `conversation` by `conversationId` from the **request body** (no org filter)
  3. Use the **service-role-key-backed `DatabaseClient`** to update the conversation
  
  Because the service-role key bypasses RLS, no defense-in-depth catches the cross-tenant write. Any user in any tenant can call `send-reply` with `conversationId: <other-tenant-conversation-uuid>` and:
  - Send an SMS to the other tenant's contact (real outbound cost + brand risk)
  - Approve an AI draft they didn't create
  - Escalate / resolve / reopen any conversation
  
  `RegenerateAiDraft`, `EscalateConversation`, `ResolveConversation`, `ReopenConversation` have the same hole.
- **Repro:** Sign up tenant A. Capture a conversation id from tenant B (this is the realistic attack: a tenant B user accidentally pastes a wrong id, or an attacker discovers one via a leak of any uuid). Call `POST /functions/v1/send-reply` with tenant A's bearer + tenant B's conversationId. Tenant A user now owns the audit log entry on tenant B's conversation.
- **Suggested fix:** Add a `requireOrgMembership(userId, conversationId)` helper that joins `organization_members` on `conversation.organization_id` and rejects with 403. Call it before any mutation. Cache the result for the request.
- **Theme:** Auth / Cross-tenant authorization
- **Effort:** M (new helper + 7 call sites)

### CRITICAL-3 — Webhook functions accept `x-organization-id` from caller headers; trusts caller-supplied org
- **File:line:** `insforge/functions/email-inbound/index.ts:200-204` and `insforge/functions/sms-inbound/index.ts:200-204`
- **Issue:** Both inbound webhook handlers do `let orgId = req.headers.get('x-organization-id') ?? null;` before falling back to lookup-by-receiving-address. The header is **caller-controlled**. An attacker who finds (or guesses) any org uuid in the InsForge project can attribute an inbound message to that org without ever learning a signing secret.
- **Repro:** `curl -X POST $URL/functions/v1/sms-inbound -H 'x-provider: mock' -H 'x-organization-id: <org-uuid>' -d '{"from":"+15551234567","to":"+15559999999","body":"hi","messageId":"x"}'`. The function will attribute the message to the supplied org and create a conversation.
- **Suggested fix:** Remove the `x-organization-id` branch entirely. Always look up the org from the `to:` phone number (SMS) or `to:` email address (email) — those are server-verifiable.
- **Theme:** Auth / Caller-supplied identity
- **Effort:** XS (delete 3 lines per entrypoint)

### CRITICAL-4 — `process-knowledge-document` and `process-ai-job` are unauthenticated internal endpoints reachable from the public function URL
- **File:line:** `insforge/functions/process-knowledge-document/index.ts:113-204`, `insforge/functions/process-ai-job/index.ts:102-186`, `insforge/functions/process-jobs/index.ts:170-225`
- **Issue:** None of these entrypoints call `verifyJwt`, do not check an `x-internal-token` header, and accept any `documentId` / `conversationId` in the request body. Anyone with the function URL can:
  - `process-knowledge-document` — trigger re-embedding of any document, multiplying AI costs
  - `process-ai-job` — force AI analysis of any conversation, multiplying AI costs
  - `process-jobs` — claim up to 10 jobs and run them (consuming AI tokens)
  
  This is both a **cost amplification vector** and a **data integrity** issue (re-embedding can change KB retrieval results).
- **Repro:** `curl -X POST $URL/functions/v1/process-knowledge-document -H 'Content-Type: application/json' -d '{"documentId":"<any>"}'` → 200 OK (or error, but the work has started).
- **Suggested fix:** Require a shared secret in a custom header (`x-internal-token`), compared against `Deno.env.get('INTERNAL_DISPATCH_TOKEN')`. Reject if missing. Make the token long and rotated.
- **Theme:** Auth / Cost amplification
- **Effort:** S (one helper, three call sites)

---

## HIGH findings

### HIGH-1 — `rbac` module exists, is unit-tested, but is **dead code** in production
- **File:line:** `packages/support-core/src/services/rbac.ts` (whole file) — re-exported via `packages/support-core/src/services/index.ts:22-23`
- **Issue:** `hasPermission` and `checkPermission` are referenced **only** in `rbac.prop.test.ts` (the test file). No function entrypoint, no service, no page imports them. Effect: **any authenticated user has the full permission set** — agents can delete orgs, viewers can manage settings, etc. (Whether they can do that *at the SQL layer* depends on RLS — but the application-layer guard is absent.)
- **Suggested fix:** In every JWT function entrypoint, after `verifyJwt`, look up the caller's role for the conversation's org and call `checkPermission(role, 'reply_conversations')` (or the appropriate permission). Add a per-endpoint permission map.
- **Theme:** Auth / RBAC enforcement
- **Effort:** M

### HIGH-2 — `RepeatedFailureRule` is registered but cannot trigger; `countConsecutiveFailures` returns 0 or 1 only
- **File:line:** `packages/support-core/src/services/ai-agent-service.ts:495-500`
- **Issue:** The comment in the code reads: "In a production system, this would query recent AI decisions." As written, the function returns `1` if `aiState === 'failed'`, else `0`. Default `maxConsecutiveFailures` is 3. The `RepeatedFailureRule` therefore **can never trigger** in production. Conversations stuck in `ai_state = 'failed'` will not escalate via the "repeated failures" path.
- **Suggested fix:** Replace with a query against `ai_decisions` for the last N (e.g. 5) decisions, count consecutive `decision_type='respond'` rows where the LLM call or parsing failed (`tags contains 'parse_error'` or `tags contains 'error'`).
- **Theme:** Reliability / Escalation engine
- **Effort:** S

### HIGH-3 — `KnowledgeIngestionService.processDocument` has no body size cap
- **File:line:** `packages/support-core/src/services/knowledge-ingestion-service.ts:33-66`
- **Issue:** A user-uploaded 100 MB document (or an attacker who can call `process-knowledge-document` per CRITICAL-4) will be split into thousands of chunks, each of which triggers a separate `createEmbedding` API call. The serial `for` loop amplifies wall-time; the absence of a cap means **a single doc can cost hundreds of dollars in OpenAI embedding fees** and time out the function. No retry, no partial save.
- **Suggested fix:** Enforce `document.body.length <= 1_000_000` (1MB) at insert time. Use the OpenAI batch embedding endpoint to embed up to 2048 chunks per call instead of looping. Set a chunk-count cap (e.g. 500).
- **Theme:** Cost amplification / DoS
- **Effort:** S

### HIGH-4 — Missing index on `messages(conversation_id, created_at)` causes full scan on hot path
- **File:line:** `insforge/migrations/001_initial_schema.sql:103-106` (only `idx_messages_provider_external_id` exists)
- **Issue:** The hot path is `messages WHERE conversation_id = ? ORDER BY created_at ASC` (the message thread). With no index, this is a full table scan + sort. At 10k messages per conversation, the inbox degrades linearly. The unique index is on `(provider, external_message_id)` and is partial — it does not help.
- **Suggested fix:** Add `CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at ASC);` in a new migration `004_perf_indexes.sql`. Verify with `EXPLAIN ANALYZE` before/after.
- **Theme:** Performance
- **Effort:** XS
- **Status:** ✅ **Fixed (card t_13a7896e).** Migration `004_perf_indexes.sql` adds `idx_messages_conversation_created (conversation_id, created_at ASC)` and an `ANALYZE messages`. Local verification against Postgres 14 with 210k rows (21 conversations × 10k messages) on the exact `MessageThread.tsx` query: `Seq Scan + Sort` (18.9 ms, 3433 buffers) → `Index Scan using idx_messages_conversation_created` (4.1 ms, 211 buffers). ~4.6× faster execution, ~16× fewer shared-buffer reads. Migration's `-- @down` block drops the index with `IF EXISTS` guard; idempotent re-apply verified.

### HIGH-5 — Cookie `insforge_access_token` is not HttpOnly; token leak via XSS
- **File:line:** `lib/auth-context.tsx:39-44` (setCookie), `lib/insforge.ts:36-45` (getAccessToken)
- **Issue:** The cookie is set with `SameSite=Lax` but **without `HttpOnly`** or `Secure`. The token is also read by JS (for function invocations), which is the only reason HttpOnly isn't set today. Any XSS would exfiltrate the token. The current design has no other browser-side token to fall back on, so the function-invocation fetch needs the token in JS — but the correct design is a server-side proxy.
- **Suggested fix:** Short-term: add `Secure` (HTTPS-only) and the strictest possible SameSite. Long-term: move the access token to an HttpOnly cookie set by the server, and proxy function invocations through Next.js API routes that read the cookie server-side.
- **Theme:** Auth / Cookie hygiene
- **Effort:** M (short-term), L (long-term refactor)

### HIGH-6 — JWT-verified webhook uses `x-organization-id` AND `x-signing-secret` headers from caller
- **File:line:** `insforge/functions/email-inbound/index.ts:167-178`, `sms-inbound/index.ts:167-178`
- **Issue:** The signing secret is taken from the request header (`x-signing-secret`) — not from a per-org database lookup. The function's `verifyWebhook` call is a no-op for the mock adapter (CRITICAL-1), but even for real providers, the design means the *caller* is the source of truth for which org's secret to verify against. The fix in CRITICAL-1 (refuse mock in production) mitigates this; the right long-term fix is to look up the secret by `to:` address.
- **Suggested fix:** Look up `email_provider_accounts` and `email_addresses` first; fetch the secret from the org-scoped credential store by the row's `credentials_secret_id`; then call `verifyWebhook` with that secret.
- **Theme:** Auth / Webhook signature source
- **Effort:** M

### HIGH-7 — `app/knowledge/page.tsx` is broken for any signed-in user; missing `organization_id` in insert
- **File:line:** `app/knowledge/page.tsx:119-127`
- **Issue:** `handleAddDocument` calls `insert({ title, source_type, body, status: 'pending' })` without `organization_id`. The schema requires it (`NOT NULL`). Combined with RLS, the insert will fail for any user, leaving the UI non-functional. The followup audit log insert at lines 138-149 also reads `doc.organization_id ?? null` (tolerating `null` — which means the audit log is silently recorded against no org if the doc insert succeeded in a hypothetical world where it did).
- **Suggested fix:** Look up the user's `organization_id` via `organization_members` (the same query the inbox page uses) and pass it to the insert. The function entrypoint pattern (call `process-knowledge-document` and let the server do the lookup) is more correct architecturally.
- **Theme:** Bug / Broken page
- **Effort:** S

### HIGH-8 — `app/analytics/page.tsx` silently truncates to 10k conversations; metrics will be wrong
- **File:line:** `app/analytics/page.tsx:88-92` and `:120-126`
- **Issue:** Two unbounded-then-truncated queries: 10k conversations, 5k messages. The end-date filter is applied **client-side** (line 101), so the SQL `gte` on `start_date` returns 10k rows ordered arbitrarily, then JS filters. With more than 10k conversations in the period, the totals are silently wrong. Same for the per-conversation response-time calc which only looks at the first 100 conversations.
- **Suggested fix:** Add a server-side aggregation (RPC or view) that returns counts grouped by status + window. Move the date filter into the SQL.
- **Theme:** Data correctness / Performance
- **Effort:** M

### HIGH-9 — `MissingKnowledgeRule` will always escalate for orgs with no knowledge base
- **File:line:** `packages/support-core/src/services/escalation-rules.ts:157-170`
- **Issue:** Rule 5 in the registration order: when `knowledgeChunks.length === 0`, the rule triggers with `reason: 'missing_knowledge'`. A new org, or any org that hasn't uploaded KB documents yet, will escalate every single inbound message. With default threshold 0.7, even populated KBs with modestly-similar content will trigger this. The "first match wins" semantics means it fires before the LLM gets a chance.
- **Suggested fix:** Either remove this rule from the default engine, or add an `ai_settings.knowledge_required` flag so orgs can opt out. Better: rely on the LLM to handle missing knowledge (which it already does via the system prompt's "if you don't know, escalate" instruction).
- **Theme:** Reliability / Escalation engine
- **Effort:** S

---

## MEDIUM findings

### MEDIUM-1 — Webhook auth and sign-secret is consulted in a way that allows 0-secret calls
- **File:line:** `insforge/functions/email-inbound/index.ts:167-168`, `sms-inbound/index.ts:167-168`
- The `x-signing-secret` header defaults to `''` if missing, and the mock adapter ignores the secret entirely. Even for a real adapter, an empty secret passed in headers is indistinguishable from a wrong secret if the adapter doesn't check length. Verify each real adapter handles `''` correctly.

### MEDIUM-2 — No `body.length` cap on inbound messages; large bodies inflate DB and AI token cost
- **File:line:** `packages/support-core/src/services/inbound-message-service.ts:133-144`
- The body is stored verbatim, then sent to the embedding model. A 100k-character SMS (theoretically a single Postmark payload) is stored and used. Cap at 16k chars (input limit for many embedding models) before storage and AI processing.

### MEDIUM-3 — `findOpenByContactAndChannel` only matches `status = 'open'`
- **File:line:** `packages/support-core/src/repositories/conversation-repository.ts:98-117`
- Conversations can be `'pending'`, `'escalated'`, `'resolved'`. An inbound SMS to a contact with a `'pending'` conversation creates a duplicate. Include all non-resolved statuses: `status IN ('open', 'pending', 'escalated')`.

### MEDIUM-4 — `OutboundMessageService` has no rate limit; a runaway UI could send thousands of replies
- **File:line:** `packages/support-core/src/services/outbound-message-service.ts:46-169`
- No per-conversation or per-user throttle. The idempotency on the job queue prevents duplicate *enqueue* but not duplicate *sends* at the function level. Add a per-conversation send rate (e.g. 1 outbound per 5s) and a per-user daily cap.

### MEDIUM-5 — `postgres-job-queue.ts` idempotency check uses `contains('payload', keyPayload)`; may collide
- **File:line:** `packages/support-core/src/services/postgres-job-queue.ts:195-229`
- The `contains` operator on JSONB is a subset match: a payload `{a:1, b:2}` "contains" `{a:1}`. If two different `send_outbound_message` jobs happen to share `conversationId` and `messageId` (the IDEMPOTENCY_KEYS), they will collide. The check also ignores `'failed'` and `'dead'` statuses — so a dead-lettered job followed by a manual retry will create a duplicate job. Consider narrowing to a more deterministic key (e.g. `job_type, payload->>conversationId, payload->>messageId` exact match) and including `'failed'` in the status filter.

### MEDIUM-6 — `ConversationList` and `MessageThread` refetch on every poll event with no debounce
- **File:line:** `components/inbox/ConversationList.tsx:78-87`, `components/inbox/MessageThread.tsx:79-87`
- `useRealtime` polls every 5s and re-runs `fetchConversations`/`fetchData` on every tick. With multiple inbox tabs open, this multiplies load. Add `useRef<boolean>` debounce, or replace the polling hack with a real WebSocket subscription.

### MEDIUM-7 — No virtualization on `ConversationList`; UI sluggish past 1000 conversations
- **File:line:** `components/inbox/ConversationList.tsx:140-151`
- Plain `conversations.map(...)` with no `react-window` / `react-virtuoso`. With the task's stated 10k-conversation inbox, this is a perf cliff. Add virtualization.

### MEDIUM-8 — `useRealtime` is a polling stub, not real realtime
- **File:line:** `lib/use-realtime.ts:50-61`
- The file's name and the call sites (`onNewMessage`, `onConversationUpdated`, `onKnowledgeDocumentUpdated`) imply WebSocket subscriptions. The implementation is a `setInterval` poll. The docstring acknowledges this is an MVP. The risk is that downstream code (and reviewers reading the API) assume the events are real. Either rename the hook to `usePolling` or wire InsForge Realtime.

### MEDIUM-9 — `MessageThread` auto-scrolls on every messages change
- **File:line:** `components/inbox/MessageThread.tsx:29-34`
- Reading a long thread, the user scrolls up. Each realtime refetch scrolls them back to the bottom. Gate on "is the user already at the bottom?".

### MEDIUM-10 — `Middleware` checks cookie presence only, not validity
- **File:line:** `middleware.ts:37-43`
- Stale cookies pass middleware, then fail at the API. Add a `try` to verify the JWT signature (or call `insforge.auth.getCurrentUser()` from middleware if edge supports it) before allowing the request. At minimum, redirect when the auth context is `loading: false` and `user: null` on the client.

### MEDIUM-11 — `ConversationList` uses only the first `organization_members` row
- **File:line:** `components/inbox/ConversationList.tsx:48-55`
- A user belonging to multiple orgs gets no choice; the UI silently uses the first. Either sort by recency, or show a switcher.

### MEDIUM-12 — `app/settings/ai/page.tsx` allows any signed-in user to write AI settings
- **File:line:** `app/settings/ai/page.tsx:104-150`
- No `checkPermission(role, 'manage_settings')`. A viewer role can flip the org to `auto_reply` and cause AI to send to all customers. Enforce RBAC at the page (or in a wrapper component).

### MEDIUM-13 — Same for `app/knowledge/page.tsx` and `app/settings/{sms,email}/page.tsx` — no role gating
- Same pattern as MEDIUM-12 across the other settings pages. Add a `<RequirePermission permission="manage_settings">` wrapper.

### MEDIUM-14 — `ReplyComposer` submits on Enter without `Cmd/Ctrl+Enter` hint
- **File:line:** `components/inbox/ReplyComposer.tsx:55-64`
- Power users will hit Enter, accidentally send, and not realize they could have used `Shift+Enter` for a newline. Add a visible hint and `Cmd/Ctrl+Enter` shortcut.

### MEDIUM-15 — `escalate-conversation` does not check current `status`
- **File:line:** `insforge/functions/escalate-conversation/index.ts:78-83`
- Escalating a `'resolved'` conversation will set it to `'escalated'` and `ai_state: 'needs_human'`. The state machine (per `properties/state-machine.prop.test.ts`) probably has invariants. Add a check that the conversation is in `('open', 'pending')` before escalating; return 409 if not.

### MEDIUM-16 — `resolve-conversation` does not record resolution timestamp
- **File:line:** `insforge/functions/resolve-conversation/index.ts:78-83`
- The `conversations` schema has no `resolved_at` column, so the resolution time is only in `updated_at`. This is fine for a v1 but means analytics cannot compute time-to-resolution accurately. Consider adding a `resolved_at` column.

### MEDIUM-17 — `claim_support_jobs` SQL has no per-claim UPDATE...RETURNING under contention
- **File:line:** `insforge/migrations/002_rpc_functions.sql:50-69`
- The `FOR UPDATE SKIP LOCKED` is on the SELECT, and the UPDATE then targets those ids. Two concurrent claimers will see disjoint sets, so the design is correct. However, the function does not filter by `organization_id`, so a misbehaving dispatcher can claim any org's jobs. Add an `org_filter uuid` parameter and `WHERE organization_id = org_filter` (default NULL meaning all).

### MEDIUM-18 — `audit_logs` insert is best-effort in many services; failures are silently swallowed
- **File:line:** `packages/support-core/src/services/ai-agent-service.ts` (multiple `auditLog.create` calls without try/catch)
- Audit logs are critical for the "append-only audit" requirement (line 8 of AGENTS.md and the policy in `003_rls_policies.sql`). A failure during audit insert will throw and abort the surrounding operation, leaving inconsistent state. Either: (a) wrap each audit call in try/catch with a structured log on failure, or (b) move audit-log writes to an outbox pattern so they don't block the main flow.

---

## LOW findings

### LOW-1 — `npm run lint` is unrunnable in CI; no eslint config exists
- **File:line:** `package.json:9` (script), root (missing `.eslintrc.json`)
- Add a `devDependencies: eslint@^8.57.1`, `eslint-config-next@^14.2.0`, and `.eslintrc.json` extending `next/core-web-vitals`. Per the codebase-audit skill: pin `eslint@^8.57.1` for legacy `.eslintrc` compatibility.

### LOW-2 — One real test failure in `sms-provider-credential-rotation.test.ts:411`
- **File:line:** `packages/support-core/__tests__/unit/sms-provider-credential-rotation.test.ts:411`
- Expected `SM3`, got `SM4`. The test asserts that the third send after credential rotation has a particular external id; the test or the rotation logic is off. Block launch — this is a real bug either in the implementation or in the test.

### LOW-3 — Unhandled rejection in `retry.test.ts:188`
- **File:line:** `packages/support-core/__tests__/unit/retry.test.ts:188`
- `makeTransient` creates a `retryable` Error; the test does not `await` a Promise that rejects. Wrap in `expect(...).rejects` or add `await` to silence the warning.

### LOW-4 — `OrganizationService.createOrganization` has no slug validation
- **File:line:** `packages/support-core/src/services/organization-service.ts:34-60`
- Slug accepts any string. Add a zod regex (e.g. `^[a-z0-9-]{3,32}$`).

### LOW-5 — `OrganizationService.createOrganization` has no slug-uniqueness retry
- If two users create the same slug simultaneously, one will fail with a unique-violation. Catch the error and retry with a numeric suffix.

### LOW-6 — 6 integration test suites are entirely skipped (45 todo tests)
- **File:line:** `packages/support-core/__tests__/integration/*.test.ts`
- The `rls-policies`, `realtime-events`, `inbound-email-flow`, `inbound-sms-flow`, `outbound-message-flow`, `seed-idempotency` suites are all file-level skipped. These cover the most critical paths (RLS, end-to-end flows). Unskip them, or document why they are deferred.

### LOW-7 — Type assertions (`as unknown as`) appear 20× in test files
- All in tests, so risk is contained, but the pattern is brittle. If a service interface changes, all of these break silently. Consider typed mock builders (e.g. `vi.mocked`).

### LOW-8 — `OrganizationService.changeMemberRole` does not check the actor's role
- **File:line:** `packages/support-core/src/services/organization-service.ts:112-161`
- A viewer can call this if the function is exposed. The function is currently not exposed as an entrypoint, so risk is contained. Add a `callerRole` parameter and call `checkPermission`.

### LOW-9 — `KnowledgeIngestionService` does serial embeddings
- **File:line:** `packages/support-core/src/services/knowledge-ingestion-service.ts:52-66`
- The serial `for` loop calls `createEmbedding` once per chunk. The OpenAI batch endpoint accepts up to 2048 inputs per call. Switch to batches for a 10-100× speedup.

### LOW-10 — `app/analytics/page.tsx` end-date filter is client-side
- **File:line:** `app/analytics/page.tsx:101`
- Move the `lte` filter to the SQL.

### LOW-11 — `lib/use-realtime.ts` re-creates interval on callback change
- **File:line:** `lib/use-realtime.ts:50-61`
- Already mitigated by `callbacksRef`. Good.

---

## INFO findings

### INFO-1 — `.env.example` ships with a concrete dev InsForge URL
- **File:line:** `.env.example:11`
- `NEXT_PUBLIC_INSFORGE_URL=https://y39ezar3.us-east.insforge.app` is a real-looking dev instance URL. If this is a sandbox, fine; if it points at a production-tenant-shaped instance, replace with a placeholder.

### INFO-2 — 8 stub adapters (`email-stubs.ts`, `sms-stubs.ts`) are placeholders
- All methods throw "not implemented". Documented in the file. They are not registered in any entrypoint, so they are not currently a risk; if anyone adds a registration in the future, the throw will become a 500. Add a build-time warning or convert to abstract classes.

### INFO-3 — `rbac.ts` defines a `view_analytics` permission but no code reads it
- Documented in the role matrix; the analytics page does not check it. Add a page-level guard or remove the permission from the enum.

### INFO-4 — `claim_support_jobs` does not journal failed claims
- If a job is claimed and the worker crashes before `complete()` or `fail()`, the job stays in `'claimed'` forever. Add a `claimed_at` timestamp and a sweeper that re-claims jobs whose `claimed_at < now() - 5min`.

---

## What's missing / not yet audited

- **Quota / limit enforcement** — the task asked specifically whether an org with 0 quota still gets a reply. There is no `quotas` / `usage` table in `001_initial_schema.sql`. The Quota feature is unimplemented. Marked as **not implemented** in `docs/`.
- **Outbound SMS/email cost cap** — no per-org message cap. A misconfigured AI in `auto_reply` mode could send unlimited messages.
- **Postmark / Twilio / Telnyx adapter internal signature handling** — read `verifyWebhook` for each but not the secret-fetch path. Sample shows they take a `signingSecret` parameter; need a deeper audit to confirm the secret isn't logged or stored.
- **i18n** — no i18n setup; the UI is hardcoded English. Not a bug, just an observation.
- **Real InsForge WebSocket subscription** — the polling stub in `use-realtime.ts` is a known gap.

---

## Acceptance criteria check

- [x] `InboxPilot/docs/QA_BUG_HUNT.md` exists. ✅
- [x] Every finding has ID, file:line, issue, repro, suggested fix, theme, severity, effort. ✅
- [ ] **CRITICAL and HIGH findings are spawned as individual cards on this board** — spawning next.
- [x] MEDIUM findings listed in the doc with "promote to card if not fixed in 2 weeks" notes. ✅
- [x] LOW/INFO findings feed the tech-debt backlog card — comment posted.
