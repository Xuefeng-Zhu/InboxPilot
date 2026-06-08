# InboxPilot Refactor Plan

> Generated from a thorough codebase exploration. ~1,450 LOC of duplication identified across the `app/` and `lib/` layers. Recent commits `70490d5` and `acb9f02` (React Query adoption and auth-guard centralization) were **incomplete** — this plan finishes them and removes the worst copy-paste.

## Executive Summary

| Refactor | LOC saved | Priority |
|---|---:|---|
| Finish React Query migration: `AiDraftPanel` + `AnalyticsPage` | ~115 | High |
| Unify `EmailSettingsPanel` + `SmsSettingsPanel` into one `ProviderAccountsPanel<TAcct,TChild>` | ~700 | High |
| Extract `withAuth()` HOF for the 7 `/api/functions/*/route.ts` files | ~120 | High |
| Add `logAudit()` + `enqueueJob()` + `callFunction()` helpers | ~155 | High |
| Unify `StatusBadge`, create `Alert` component, create `lib/format.ts` | ~170 | Medium |
| Convert raw `fetch()` call sites to `useApiMutation` | ~40 | Medium |
| Row-type unification, `useAuthReady` export, `use client` removal, misc | ~30 | Low |
| **Total** | **~1,330** | |

---

## Phase 0 — Foundational utilities

- [ ] **1. Create `lib/format.ts`** (~60 LOC)
  - [ ] `formatDate(input: string | Date | number): string`
  - [ ] `formatRelativeDate(input): string` — "2 hours ago"
  - [ ] `channelLabel(channel): string` — single source for "Email" / "SMS" mapping
  - [ ] `formatDuration(ms: number | null): string` — moved from `app/analytics/page.tsx:42`
  - [ ] `formatPercent(rate: number | null): string` — moved from `app/analytics/page.tsx:53`
  - [ ] `formatCsat(score: number | null): string` — moved from `app/analytics/page.tsx:58`
- [ ] **2. Create `lib/to-rows.ts`** (~5 LOC)
  - [ ] `toRows<T>(data: T | T[] | null | undefined): T[]`
- [ ] **3. Create `lib/auto-dismiss.ts`** (~12 LOC)
  - [ ] `useAutoDismiss(setter, ms = 3000)` — setTimeout + cleanup
- [ ] **4. Create `lib/audit.ts`** (~25 LOC, server-side)
  - [ ] `logAudit({ insforge, organizationId, actorId, action, resourceType, resourceId, metadata })`
- [ ] **5. Create `lib/jobs.ts`** (~25 LOC, server-side)
  - [ ] `enqueueJob({ insforge, organizationId, jobType, payload, maxAttempts? })`
- [ ] **6. Create `lib/with-auth.ts`** (~30 LOC, server-side)
  - [ ] `withAuth<TBody>(handler)` HOF for `/api/functions/*/route.ts`
- [ ] **7. Create `lib/api-functions.ts`** (~35 LOC, client-side)
  - [ ] `callFunction<TReq, TRes>(name, payload)` — token + fetch + error parsing
  - [ ] `useApiMutation<TVars, TRes>(name, options?)` — wraps `useMutation` with `callFunction`
- [ ] **8. Create `components/ui/Alert.tsx`** (~30 LOC)
  - [ ] `<Alert variant="error" | "success">{children}</Alert>` — replaces 9 copy-pasted banners
- [ ] **9. Export `useAuthReady` from `lib/queries.ts`** (one-line change)

### Phase 0 tests
- [ ] `__tests__/lib/format.property.test.ts` — idempotent, monotone, null-safe
- [ ] `__tests__/lib/to-rows.property.test.ts` — round-trips single ↔ array, null safety
- [ ] `__tests__/lib/with-auth.test.ts` — 401 / passes body / 500 wraps
- [ ] `__tests__/lib/log-audit.test.ts` — inserts with all required fields (mock insforge)
- [ ] `__tests__/lib/enqueue-job.test.ts` — same pattern
- [ ] `__tests__/lib/api-functions.test.ts` — Authorization header, throws on non-ok, parses error

### Phase 0 verification
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

---

## Phase 1 — React Query migration (closes the gap from commit `70490d5`)

- [ ] **10. `components/inbox/AiDraftPanel.tsx`** — drop lines 36–73
  - [ ] Delete `useState`/`useCallback`/`useEffect` for `fetchDecision`
  - [ ] Replace with `useAiDecision(enabled ? conversationId : undefined)` from `lib/queries.ts:175`
  - [ ] Preserve `aiState === 'drafted' || 'needs_human'` guard via `enabled:` flag
  - [ ] Convert `approve` handler → `useApiMutation` (invalidate `queryKeys.aiDecision` + `queryKeys.conversation`)
  - [ ] Convert `regenerate` handler → `useApiMutation`
  - [ ] `useAiDecision` returns typed `AiDecisionRow` directly
- [ ] **11. `app/analytics/page.tsx`** — extract `useAnalyticsMetrics`
  - [ ] Move `computeMetrics` into `lib/queries.ts` as `useAnalyticsMetrics(orgId, startDate, endDate)`
  - [ ] Move `formatDuration`/`formatCsat`/`formatPercent`/`getDefaultDateRange` to `lib/format.ts`
  - [ ] Page becomes ~100 LOC (header + MetricCard grid + date inputs + hook call)
- [ ] **12. `lib/queries.ts`** — generic row typing (H5)
  - [ ] Each hook gets `<TRow>` generic
  - [ ] Export row types: `MessageRow`, `ConversationRow`, `ContactRow`, `AiDecisionRow`, `KnowledgeDocRow`, `TeamMemberRow`
  - [ ] Delete duplicates in `MessageBubble.tsx:10`, `ConversationItem.tsx:11,27` and re-import
  - [ ] Add `useAnalyticsMetrics` (Phase 1 #11)

### Phase 1 tests
- [ ] `__tests__/ui/ai-draft-panel.property.test.tsx` — spinner for `thinking`, banner for `needs_human`, draft UI for `drafted`, null for `idle`/`failed`
- [ ] `__tests__/lib/use-analytics-metrics.test.tsx` — pure `computeMetrics` on random data
- [ ] `__tests__/lib/queries.test.tsx` — `useAiDecision` returns null when disabled, returns row when enabled, throws on db error

### Phase 1 verification
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

---

## Phase 2 — Settings panel unification (~700 LOC, biggest single win)

- [ ] **13. Create `app/settings/_components/ProviderAccountsPanel.tsx`** (~250 LOC)
  - [ ] Generic `ProviderAccountsPanel<TAcct extends ProviderAccount, TChild extends ProviderChild>(config)`
  - [ ] `ProviderConfig` interface with `title`, `resourceType`, `accountTable`, `childTable`, `childKeyLabel`, `childKeyExtractor`, `providerOptions`, `useMonoFont?`, `addFormTitle`, `removeConfirmMessage`
  - [ ] All handlers (add/edit/remove/test) live inside the component, parameterized by `config`
  - [ ] Uses `useAuth` (gated), `useApiMutation` for test connection, `toRows` helper
  - [ ] Re-exports `ProviderAccount` and `ProviderChild` base interfaces
- [ ] **14. `app/settings/_components/EmailSettingsPanel.tsx`** — becomes a 30-LOC wrapper
  - [ ] Imports `ProviderAccountsPanel` and exports a configured instance with the email config
- [ ] **15. `app/settings/_components/SmsSettingsPanel.tsx`** — becomes a 30-LOC wrapper
  - [ ] Same pattern with the SMS config
- [ ] **16. `app/settings/_components/AiSettingsPanel.tsx`** — refactor with `useAuthReady` (M2)
  - [ ] Replace `useAuth`+`useEffect` boilerplate with `useAuthenticatedData('ai-settings', fetcher)` helper in `lib/queries.ts`
  - [ ] Use `logAudit` helper (M3) for its 2 audit inserts (lines 153, 208)
  - [ ] Add `useAuthenticatedData` hook in `lib/queries.ts`

### Phase 2 tests
- [ ] `__tests__/ui/provider-accounts-panel.property.test.tsx` — correct title/label per config, extractor used, `useMonoFont` toggles class
- [ ] `__tests__/ui/ai-settings-panel.test.tsx` — `applySettingsToForm` mapping (pure function, lines 42–61)
- [ ] `__tests__/lib/use-authenticated-data.test.tsx` — gates fetch on `authReady`, refetches when user changes

### Phase 2 verification
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

---

## Phase 3 — API route HOF

- [ ] **17. `app/api/functions/_with-auth.ts`** (new) — exports `withAuth`
  - [ ] Auth failure → 401
  - [ ] Body parse error → 400
  - [ ] Thrown → 500
  - [ ] Typed `handler(user, body)` signature
- [ ] **18. Refactor all 7 route files** to ~10 LOC each:
  - [ ] `approve-ai-draft/route.ts` — also use `logAudit`
  - [ ] `escalate-conversation/route.ts`
  - [ ] `regenerate-ai-draft/route.ts` — also use `enqueueJob`
  - [ ] `reopen-conversation/route.ts`
  - [ ] `resolve-conversation/route.ts`
  - [ ] `send-reply/route.ts`
  - [ ] `test-channel-connection/route.ts`

### Phase 3 tests
- [ ] `__tests__/lib/with-auth.test.ts` (covered in Phase 0)
- [ ] `__tests__/api/approve-ai-draft.test.ts` — uses mocked `insforgeAdmin`, asserts inserts/updates
- [ ] `__tests__/api/test-channel-connection.test.ts` — happy path + 401 + 500

### Phase 3 verification
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

---

## Phase 4 — UI unification & bundle cleanups

- [ ] **19. Delete `components/inbox/StatusBadge.tsx`** (84 LOC)
  - [ ] `StatusBadge` here is a subset of `components/ui/StatusBadge.tsx`
  - [ ] `AiStateIndicator` stays (it's unique)
  - [ ] Switch all consumers of the inbox `StatusBadge` to `components/ui/StatusBadge`
  - [ ] Remove `mapStatusToBadge` in `components/knowledge/types.ts:20-35`
- [ ] **20. `components/ui/StatusBadge.tsx`** — extend the `Status` union
  - [ ] Add: `ai_draft`, `auto_replied`, `needs_human`, `thinking`
  - [ ] Keep `ai_draft`/`connected` color logic unchanged
- [ ] **21. Remove `'use client'` from**:
  - [ ] `components/ui/Button.tsx`
  - [ ] `components/ui/Select.tsx`
  - [ ] Keep `Input.tsx`/`Textarea.tsx` (they use `useId`)
  - [ ] Keep `Tooltip.tsx` (Radix)
- [ ] **22. Replace 9 copy-pasted error/success banners with `<Alert>`**:
  - [ ] `app/analytics/page.tsx`
  - [ ] `app/team/page.tsx`
  - [ ] `app/knowledge/page.tsx`
  - [ ] `app/customers/page.tsx`
  - [ ] `app/knowledge/[id]/page.tsx`
  - [ ] 2 banner sites inside `EmailSettingsPanel`/`SmsSettingsPanel` (folded into Phase 2)
- [ ] **23. Replace `setTimeout(() => setX(null), 3000)`** in 9 spots with `useAutoDismiss(setX)`
- [ ] **24. Replace `formatDate`/`channelLabel` duplicates** — update imports in:
  - [ ] `components/inbox/ContactDetails.tsx`
  - [ ] `app/team/page.tsx`
  - [ ] `components/knowledge/types.ts` (and re-importers `DocumentHeader.tsx`, `KnowledgeTable.tsx`)
  - [ ] `components/inbox/ConversationItem.tsx`
- [ ] **25. `proxy.ts`** — remove the redundant `pathname === '/'` short-circuit

### Phase 4 tests
- [ ] `__tests__/ui/alert.property.test.tsx` — variant classes match expected colors
- [ ] `__tests__/lib/auto-dismiss.test.tsx` — fires after delay, cleans up on unmount
- [ ] `__tests__/ui/status-badge.property.test.tsx` — extend existing one to cover new union members

### Phase 4 verification
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

---

## Order of operations

```
Phase 0  (utilities + tests)        ─ no behavior change
   ↓
Phase 1  (React Query migration)    ─ AiDraftPanel, AnalyticsPage, queries.ts
   ↓
Phase 2  (Settings unification)     ─ ProviderAccountsPanel, AiSettingsPanel cleanup
   ↓
Phase 3  (API route HOF)            ─ 7 routes + helpers
   ↓
Phase 4  (UI cleanup)               ─ StatusBadge merge, Alert, use client removal
```

Each phase is independently testable and committable.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `useAiDecision` was guarded by `aiState` short-circuit in `AiDraftPanel` | Preserve guard with `enabled:` option on the hook |
| `ProviderAccountsPanel` generic might lose some prop ergonomics | Keep thin `EmailSettingsPanel`/`SmsSettingsPanel` wrappers so call sites unchanged |
| `withAuth` changes return-type signatures of route handlers | Type the HOF precisely; the 7 routes become 7-10 LOC each so review burden is low |
| Removing `'use client'` from Button/Select could break consumers that rely on client-side features | Verify with `next build` after the change; revert per-file if any consumer breaks |
| `formatDate` signature differences across the 3 dupes | Audit each call site before consolidation; signature in `lib/format.ts` will accept `string \| Date \| number` |

## Out of scope

- `packages/support-core/` (the portability rule in AGENTS.md rule 1)
- Any InsForge migration / SQL files
- Tests in `__tests__/properties/` (already cover `support-core`; only **add** tests in `__tests__/lib/` and `__tests__/ui/`)
- L3 (`toSnake` for repositories) — speculative type-level work, deferred

## Final verification

- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes
- [ ] No regressions in manual inbox / settings / knowledge flows

## Estimated diff size

- ~25–30 files changed
- ~+900 LOC (Phase 0 utilities, ProviderAccountsPanel, tests, Alert component)
- ~−1,330 LOC (deleted duplication in panels, routes, queries, formats, banners)
- **Net: −430 LOC**, plus 12 new test files
