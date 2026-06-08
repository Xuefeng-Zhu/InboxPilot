# InboxPilot — UI/UX Polish Plan

**Scope:** Full polish pass covering ~150 issues across 8 areas (Tracks A–H).
**Estimated effort:** 4–5 days, 46 small reviewable commits.
**Out of scope:** Dark mode, real product screenshots, i18n, Storybook, real customer logos, full icon-system unification.

---

## Critical bugs (fix first)

1. **Team page renders user UUID as member name** — `app/team/page.tsx:82-83`. Joins missing in `lib/queries.ts` `useTeamMembers`.
2. **`not-found.tsx` sends unauth users to `/inbox` → double redirect** — `app/not-found.tsx:11`. Branch on `useAuth`.
3. **`aria-invalid` is `true` (boolean) but spec requires `"true"` (string)** — `Input.tsx:39`, `Select.tsx:38`, `Textarea.tsx:38`. Screen readers get garbage.
4. **Two `StatusBadge` components with conflicting signatures** — `components/ui/StatusBadge.tsx` vs `components/inbox/StatusBadge.tsx`. Different files resolve to the same import path.
5. **`Edit Draft` button actually calls `regenerate`** — `components/inbox/AiDraftPanel.tsx:268`. Label says one thing, action does another.
6. **Action buttons invisible on touch** — `CustomerTable.tsx:67`, `KnowledgeTable.tsx:128` use `opacity-0 group-hover:opacity-100`. Fails WCAG 1.4.13, broken on mobile/keyboard.
7. **Inbox right pane hidden behind `xl:` breakpoint (1280px)** — `MessageThread.tsx:144`. Customer details are inaccessible on laptops (1024–1279px). "Audit" tab is a placeholder shipping to prod.
8. **Hamburger button overlaps page headers on `<xl`** — `AppShell.tsx:52-65` (`fixed top-3 left-3`). Only `settings/page.tsx:24` compensates with `pl-12`; other pages don't.
9. **Modal pattern: only `AddDocumentForm` is a real modal** — customer modals have no `role`/`aria-modal`/Escape/focus trap. Extract a `<Modal>` primitive.

---

## Phase 1 — Critical bug fixes & foundation (Day 1)

**Goal:** Fix data/UX bugs that block a senior-designer sign-off, without any visual refactor.

| # | Task | Files | Verification |
|---|---|---|---|
| 1.1 | **Team page name bug** — join `users` table in `lib/queries.ts` `useTeamMembers`, expose `name`/`email`, render those | `app/team/page.tsx:82-83`, `lib/queries.ts` | Names render instead of UUIDs |
| 1.2 | **404 redirect bug** — branch CTA on `useAuth`, add `<h1>`, focus ring, render inside AppShell when authenticated | `app/not-found.tsx` | Visit `/foo` logged-in vs logged-out, both work |
| 1.3 | **`aria-invalid` to string** in all form primitives | `Input.tsx:39`, `Select.tsx:38`, `Textarea.tsx:38` | screen-reader test |
| 1.4 | **Collapse two `StatusBadge` components** — pick canonical file, route all callsites through it, use `status.*` tokens | `components/ui/StatusBadge.tsx`, `components/inbox/StatusBadge.tsx`, all imports | One grep result for `from.*StatusBadge` |
| 1.5 | **Fix "Edit Draft" button** — rename to "Regenerate" with correct icon/aria | `components/inbox/AiDraftPanel.tsx:268` | Click button → label and action match |
| 1.6 | **Always-show table action icons** — remove `opacity-0 group-hover:opacity-100` | `CustomerTable.tsx:67`, `KnowledgeTable.tsx:128` | Visible on touch + keyboard tab |
| 1.7 | **Promote Inbox right pane to `lg:flex`**, remove "Audit" placeholder tab, add toggle for `lg` width | `MessageThread.tsx:144-163`, `app/inbox/page.tsx` | Customer details visible at 1024px+ |
| 1.8 | **Fix hamburger overlap** — move into top bar, fix `mobileOpen` resize state, add `aria-expanded`/`aria-controls` | `components/layout/AppShell.tsx`, `settings/page.tsx:24` | No more `pl-12` workaround |
| 1.9 | **Add `<Spinner>` primitive**, replace 7+ duplicate SVGs | `components/ui/Spinner.tsx` (new) + 7 files | Single grep result for `<Spinner` |
| 1.10 | **Fix focus offset to `2` globally** | `Button.tsx`, `Input.tsx`, `Textarea.tsx`, `Select.tsx`, property test | Single value used everywhere |

**Commit cadence:** 10 small commits, one per task.

---

## Phase 2 — Token enforcement (Day 2)

**Goal:** 178 raw `gray-*` + 30+ raw `text-*` + 3 reds → design tokens. Pure mechanical refactor.

| # | Task | Files | Verification |
|---|---|---|---|
| 2.1 | **Add missing tokens** to `tailwind.config.ts`: `error` palette, `text-display-lg`, `text-display-md` | `tailwind.config.ts:12-65, 70-77` | New tokens exist |
| 2.2 | **Color sweep** — `bg-gray-50` → `bg-surface-container`, `bg-gray-100` → `bg-surface-container-high`, `text-gray-500/600` → `text-on-surface-variant`, `border-gray-*` → `border-surface-border`, `text-red-*` → `error.*` | All 178 occurrences in `app/`, `components/` | `grep -r "gray-{50..900}" components/ app/` returns only legitimate base colors |
| 2.3 | **Typography sweep** — `text-sm` → `text-body-sm`, `text-xs` → `text-label-sm`, `text-base` → `text-body-md`, `text-2xl/3xl` → `text-display-sm` (or new `text-display-md`/`-lg`) | All 30+ occurrences | Tokens used uniformly |
| 2.4 | **Status token adoption** — `StatusBadge`, `MetricCard`, error/AI states use `status.open/escalated/resolved/ai_draft.*` instead of raw `orange-50`/`red-50`/`green-50`/`purple-50` | `components/ui/StatusBadge.tsx`, `components/ui/MetricCard.tsx`, `components/inbox/StatusBadge.tsx` | `grep -r "bg-orange-50\|bg-red-50\|bg-green-50\|bg-purple-50"` returns 0 |
| 2.5 | **Update property tests** to assert new token usage | `__tests__/properties/*` | Tests pass |

**Commit cadence:** 5 commits, one per task.

### Token mapping

| Current | New |
|---|---|
| `bg-gray-50` (panels) | `bg-surface-container` |
| `bg-gray-100` (hover) | `bg-surface-container-high` |
| `text-gray-500/600` | `text-on-surface-variant` |
| `text-gray-900` | `text-on-surface` |
| `border-gray-200/300` | `border-surface-border` |
| `text-sm` | `text-body-sm` |
| `text-xs` | `text-label-sm` |
| `text-base` | `text-body-md` |
| `bg-orange-50 text-orange-700` (status pills) | `status.open.*` token |
| `bg-red-50 text-red-700` (status pills) | `status.escalated.*` |
| `bg-green-50 text-green-700` (status pills) | `status.resolved.*` |
| `bg-purple-50 text-purple-700` (status pills) | `status.ai_draft.*` |
| `text-red-500/600/700` (errors) | `error.*` (new palette) |

---

## Phase 3 — UI primitives (Day 3)

**Goal:** Build the missing primitives so we can refactor pages to use them.

| # | Task | New/edited file | Replaces |
|---|---|---|---|
| 3.1 | **`<Button>` API upgrade** — add `loading`, `type` (default `"button"`), `startIcon`/`endIcon`, `fullWidth`, polymorphic `<ButtonLink>` (or `as` prop), variant-aware disabled state | edit `components/ui/Button.tsx` | hand-rolled buttons in `app/page.tsx`, `AiDraftPanel`, `ReplyComposer` |
| 3.2 | **`<Card>` compound component** | edit `components/ui/Card.tsx` → `Card.Header`/`Card.Body`/`Card.Footer` + `padding` variant | hand-rolled card chrome in `EditCustomerModal`, `DeleteCustomerModal`, `app/page.tsx:102` |
| 3.3 | **`<Modal>` primitive** | `components/ui/Modal.tsx` (new) | `AddDocumentForm`, `EditCustomerModal`, `DeleteCustomerModal` |
| 3.4 | **`<Alert>` primitive** | `components/ui/Alert.tsx` (new) | error/success text in login, register, tables, modals |
| 3.5 | **`<PageHeader>` primitive** | `components/ui/PageHeader.tsx` (new) | 5+ page headers (Customers, Knowledge, Analytics, Team, Settings) |
| 3.6 | **`<FilterBar>` + `<FilterPill>` primitives** | `components/ui/FilterBar.tsx` (new) | `InboxFilters`, `CustomerFilters`, `KnowledgeFilters` |
| 3.7 | **`<EmptyState>` primitive** | `components/ui/EmptyState.tsx` (new) | 8+ bespoke empty states |
| 3.8 | **Form field upgrades** — `helperText` + `required` indicator on `Input`/`Select`/`Textarea`; extract `fieldClasses` constant; fix error color contrast | edit 3 files | bespoke label+input markup in `AddDocumentForm`, `InboxFilters` |
| 3.9 | **Lift `<Tooltip>` Provider to root**, allow `ReactNode` content, add `align` prop, use `inverse-surface` token | edit `Tooltip.tsx`, `app/layout.tsx` | per-instance Provider in `Tooltip.tsx:15` |
| 3.10 | **Add `Logo` to `components/ui/index.ts`** | edit `components/ui/index.ts` | 3 deep-path imports in `app/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx` |
| 3.11 | **Add `twMerge` to `cn()`** | edit `components/ui/cn.ts` | conflicting utility classes silent bugs |

**Commit cadence:** 11 commits, one per task.

---

## Phase 4 — Page refactors (Day 4)

**Goal:** Apply primitives to all pages. Visual payoff.

| # | Task | Files |
|---|---|---|
| 4.1 | **Inbox** — remove h1 from `InboxFilters`, use `<PageHeader>` not present, use `<FilterBar>`, fix `AiStateIndicator` to real badge, fix `<Input>` usage in `CustomerSelector`, use real last-message preview in `ConversationItem` | `app/inbox/page.tsx`, `InboxFilters.tsx`, `ConversationItem.tsx`, `CustomerSelector.tsx`, `AiDraftPanel.tsx` |
| 4.2 | **Customers** — use `<PageHeader>`, add primary "Add Customer" button (or document why absent), use `<FilterBar>`, refactor modals to `<Modal>` | `app/customers/page.tsx`, `CustomerFilters.tsx`, `CustomerTable.tsx`, `EditCustomerModal.tsx`, `DeleteCustomerModal.tsx` |
| 4.3 | **Knowledge** — use `<PageHeader>`, use `<FilterBar>`, use `<Input>`/`<Select>` in `AddDocumentForm`, use `<Modal>` | `app/knowledge/page.tsx`, `KnowledgeFilters.tsx`, `KnowledgeTable.tsx`, `AddDocumentForm.tsx` |
| 4.4 | **Analytics** — use `<PageHeader>`, use `<Input type="date">` + `<Button>` for date controls, add helper for date range | `app/analytics/page.tsx` |
| 4.5 | **Team** — use `<PageHeader>`, use `<Modal>` for invite/edit | `app/team/page.tsx` |
| 4.6 | **Settings** — use `<PageHeader>`, fix the `pl-12` workaround (no longer needed after 1.8) | `app/settings/page.tsx` |
| 4.7 | **Auth pages** — match login/register brand title size (`text-display-sm` in both), add Forgot Password link, use `<Alert>` for errors, match Card padding | `app/login/page.tsx`, `app/register/page.tsx` |
| 4.8 | **404** — proper `<h1>`, focus ring, branched CTA, AppShell when authenticated | `app/not-found.tsx` |
| 4.9 | **Layout primitives** — `aria-current` on `NavItem`; focus ring + `<Tooltip>` on `Sidebar` sign-out; fix `startsWith` route match; `<header>` landmark in `AppShell` | `components/layout/*` |
| 4.10 | **Empty/loading states** — sweep all 8+ empty states + 5 page-level loading states to use the new primitives | scattered |

**Commit cadence:** 10 commits, one per task.

---

## Phase 5 — Landing page redesign (Day 5)

**Goal:** Marketing-grade landing page.

| # | Task | Files |
|---|---|---|
| 5.1 | **Migrate hand-rolled CTAs to `<Button>`** (4 sites) | `app/page.tsx:28, 70, 86, 253` |
| 5.2 | **Migrate to design tokens** — typography, spacing, color | entire `app/page.tsx` |
| 5.3 | **Add social proof section** ("Trusted by teams at…") between hero and demo | edit `app/page.tsx:142` |
| 5.4 | **Replace chat mockup with real product screenshot** in browser-chrome frame | edit `app/page.tsx:99-142` |
| 5.5 | **Accessibility** — section `aria-labelledby`, "skip to main content" link, `text-balance` on hero, footer contrast fix (`text-gray-400` → `text-gray-500`), focus rings on Logo/Sign in links | `app/page.tsx` |
| 5.6 | **Delete `Material Symbols Outlined` font link** (loaded, never used) | `app/layout.tsx:30-35` |
| 5.7 | **Standardize focus ring offset** with the rest of the app | `app/page.tsx:28, 70, 86, 253` |
| 5.8 | **Standardize border radius** — `rounded` vs `rounded-lg` vs `rounded-full` | `app/page.tsx` (5+ sites) |
| 5.9 | **Add footer link columns** — Privacy, Terms, Docs (or stubs) | edit `app/page.tsx:273-283` |
| 5.10 | **Extract `<ArrowRight>` icon** (duplicated at lines 73-82 and 256-265) | new `components/icons/ArrowRight.tsx` |

**Commit cadence:** 10 commits, one per task.

---

## Verification

After each phase:
- `npm run lint` (must pass)
- `npm run typecheck` (must pass)
- `npm test` (property tests must pass — many will need updating to match new token names)
- Manual: `npm run dev`, walk through every page on Chrome + Safari + iPhone viewport

After all phases:
- `grep -r "gray-{50..900}" app/ components/` returns only intentionally base-background colors
- `grep -r "text-sm\|text-xs" app/ components/` returns only the auth form labels (replaced in 4.7)
- Lighthouse a11y score target: ≥95 on every authenticated page

---

## Risk notes

- **Property tests will fail** during Phases 2 & 3. Update them in the same commit as the implementation change.
- **CSS variable dead code in `globals.css:6-54`** — leave intact (some are referenced via `body { color: var(--foreground) }` at line 57). Will be a follow-up cleanup if dark mode is added.
- **`<Modal>` focus-trap implementation** — use `focus-trap-react` (small, audited) or implement minimal hand-rolled trap. Prefer the library for the production case.
- **`<Button>` polymorphic `as`/`<ButtonLink>`** — TypeScript generics are non-trivial. Either split into two components (`<Button>` and `<ButtonLink>`) with shared styles, or use a small `as` prop typed via `forwardRef`.
- **`useTeamMembers` join** — depends on the `auth.users` schema in InsForge. Verify the table is queryable from the frontend before refactoring.

---

## File inventory

**New files (10):**
- `components/ui/Spinner.tsx`
- `components/ui/Modal.tsx`
- `components/ui/Alert.tsx`
- `components/ui/PageHeader.tsx`
- `components/ui/FilterBar.tsx`
- `components/ui/EmptyState.tsx`
- `components/icons/ArrowRight.tsx`
- `__tests__/ui/spinner.test.tsx`
- `__tests__/ui/modal.test.tsx`
- `__tests__/ui/filter-bar.test.tsx`

**Heavily edited (15):**
- `app/page.tsx` (landing)
- `app/layout.tsx` (Tooltip Provider, remove font link)
- `app/globals.css` (no changes planned; vars left intact)
- `app/inbox/page.tsx`
- `app/customers/page.tsx`
- `app/knowledge/page.tsx`
- `app/analytics/page.tsx`
- `app/team/page.tsx`
- `app/settings/page.tsx`
- `app/login/page.tsx`
- `app/register/page.tsx`
- `app/not-found.tsx`
- `tailwind.config.ts` (new tokens)
- `lib/queries.ts` (team members join)
- `components/ui/Button.tsx` (loading, polymorphic, focus)
- `components/ui/Card.tsx` (compound)

**Lightly edited (30+):**
- All form primitives, StatusBadge, Logo, Tooltip, all layout components, all inbox/customers/knowledge components, all property tests
