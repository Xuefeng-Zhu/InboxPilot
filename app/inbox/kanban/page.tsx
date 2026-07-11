'use client';

/**
 * /inbox/kanban — split-inbox kanban page (T10).
 *
 * Visual target: `mockups/4-retool-grade.html:55-285` (5-column split inbox).
 * Page owns data fetching (5 sibling `useKanbanLane` calls), selected-row
 * state, and the top bar. Lanes own sticky header + scrollable body;
 * rows own the per-conversation visual.
 *
 * Why a client component (not RSC):
 *   `useAuth` and the 5 `useKanbanLane` hooks are client-only; React
 *   Query and the auth context live in the browser. Next.js requires
 *   `'use client'` on any page that consumes them.
 *
 * Why `<Suspense>` (not `loading.tsx`):
 *   Project rule (`app/AGENTS.md`) — no `loading.tsx` / `error.tsx` files.
 *   The Suspense boundary is here for future-proofing (the symphony
 *   page uses it for `useSearchParams`; this page does not strictly
 *   need it today, but the rule is symmetric across the two alt-inbox
 *   pages).
 *
 * Why `now` is frozen at first render (not a `setInterval`):
 *   The plan defers live SLA ticks to a v2 hook. v1 snapshots the
 *   clock at mount; `SlaChip` is re-rendered when lane items change
 *   (via the hook invalidation chain), so a single tick on refresh
 *   is good enough for the static visual.
 *
 * Why the 5 `useKanbanLane` calls are sequential (not a `.map`):
 *   Two forms are Rules-of-Hooks-safe here (KANBAN_LANES is a module-
 *   level readonly const, so `.map` order is stable). The explicit
 *   5-call form is easier to read in a 200-line file and lets the
 *   TS compiler verify the lane id literal at each call site (a typo
 *   in `'mnie'` would fail). The `.map` form would defer the typo to
 *   a `Record<LaneId, …>` index access.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import {
  queryKeys,
  useOrgMembership,
  useOrganization,
} from '@/lib/queries';
import { useKanbanLane } from '@/lib/queries/hooks/useKanbanLane';
import { useRealtime } from '@/lib/use-realtime';
import { AppShell } from '@/components/layout';
import { KanbanLane } from './_components/KanbanLane';
import { KanbanRow } from './_components/KanbanRow';
import { KanbanDrawer } from './_components/KanbanDrawer';
import { KANBAN_LANES, DEFAULT_SLA_THRESHOLDS } from './_lib/constants';
import type { LaneId } from './_lib/types';

export default function KanbanPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[var(--m03-fg-3)]">
          Loading kanban…
        </div>
      }
    >
      <KanbanContent />
    </Suspense>
  );
}

function KanbanContent() {
  const { user } = useAuth();
  // `useOrgMembership`'s `data` is `string | null | undefined` (a found
  // membership → string; no row → null; not yet resolved → undefined).
  // `?? undefined` coerces the `null` branch to `undefined` so the
  // downstream hooks (which take `string | undefined`) compile. This
  // matches the established pattern in `app/analytics/page.tsx:165` and
  // `app/settings/page.tsx:124`.
  const { data: rawOrgId } = useOrgMembership(user?.id);
  const orgId = rawOrgId ?? undefined;
  const { data: organization } = useOrganization(orgId);
  const [now] = useState(() => new Date());
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    null,
  );

  // Realtime — invalidate all 5 lane queries (parent-key prefix match)
  // with a 250ms debounce so a burst of N messages becomes 1 refetch.
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    onNewMessage: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.kanbanLanes(orgId ?? '', user?.id ?? ''),
        });
      }, 250);
    },
    onConversationUpdated: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.kanbanLanes(orgId ?? '', user?.id ?? ''),
        });
      }, 250);
    },
    messageChannel: orgId ? `org:${orgId}` : undefined,
    conversationChannel: orgId ? `org:${orgId}` : undefined,
    enabled: !!user && !!orgId,
  });
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // 5 sibling hooks, one per lane. The order is locked by the 5-entry
  // KANBAN_LANES constant — adding a 6th lane requires editing both
  // this block AND the constant. The hook handles `orgId`/`userId` of
  // `undefined` via the `enabled` gate, so this is safe to call before
  // the `!rawOrgId` early return below.
  const mineResult = useKanbanLane(orgId, user?.id, 'mine');
  const escalatedResult = useKanbanLane(orgId, user?.id, 'escalated');
  const aiDraftedResult = useKanbanLane(orgId, user?.id, 'ai_drafted');
  const awaitingReplyResult = useKanbanLane(
    orgId,
    user?.id,
    'awaiting_reply',
  );
  const unassignedResult = useKanbanLane(orgId, user?.id, 'unassigned');

  const laneResults: Record<LaneId, ReturnType<typeof useKanbanLane>> = {
    mine: mineResult,
    escalated: escalatedResult,
    ai_drafted: aiDraftedResult,
    awaiting_reply: awaitingReplyResult,
    unassigned: unassignedResult,
  };

  const thresholds = organization?.sla_thresholds ?? DEFAULT_SLA_THRESHOLDS;

  // Empty-state guard: shouldn't happen after auth (useOrgMembership
  // always returns the user's first org membership row), but the
  // `enabled` gate in `useKanbanLane` would silently produce 0 items
  // on every lane if `orgId` were ever null — better to surface the
  // missing-org case as a real UI state. Use `rawOrgId` (pre-coercion)
  // so the guard correctly catches both the `null` and `undefined`
  // branches.
  if (!rawOrgId) {
    return (
      <AppShell noPadding>
        <div className="p-8 text-center text-[var(--m03-fg-3)]">
          No organization
        </div>
      </AppShell>
    );
  }

  const totalCount = KANBAN_LANES.reduce(
    (sum, lane) => sum + laneResults[lane.id].items.length,
    0,
  );
  const laneError = KANBAN_LANES.map((lane) => laneResults[lane.id].error).find(
    (error): error is Error => error instanceof Error,
  );

  return (
    <AppShell noPadding>
      <div className="flex h-full w-full min-h-0 flex-col">
        {/* Top bar — brand strip + back link + total badge. Mirrors
            mockup `4-retool-grade.html:36-52` in spirit (one-row
            brand strip across the top), trimmed to the spec's 3
            elements (title, back link, total). */}
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--m03-line)] bg-white px-3">
          <div className="flex items-center gap-3">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-gray-900 text-[10px] font-semibold text-white">
              IP
            </div>
            <span className="text-[13px] font-semibold text-[var(--m03-fg)]">
              Kanban
            </span>
            <a
              href="/inbox"
              className="text-[12px] text-[var(--m03-fg-3)] hover:text-[var(--m03-fg)]"
            >
              ← Back to inbox
            </a>
          </div>
          {totalCount > 0 ? (
            <span
              data-testid="kanban-total"
              className="font-mono text-[11px] text-[var(--m03-fg-3)]"
            >
              +{totalCount} total
            </span>
          ) : null}
        </header>

        {laneError && (
          <div
            role="alert"
            className="mx-2 mt-2 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-3 py-2 text-[12px] text-[var(--m03-red)]"
          >
            Could not load the board: {laneError.message}
          </div>
        )}

        {/* Narrow screens scroll by full-width lanes; desktop retains the
            dense five-column board with independently scrolling lane bodies. */}
        <div className="grid h-full min-h-0 grid-flow-col auto-cols-[minmax(280px,85vw)] gap-2 overflow-x-auto p-2 lg:grid-flow-row lg:grid-cols-5 lg:auto-cols-auto lg:overflow-hidden">
          {KANBAN_LANES.map((lane) => {
            const result = laneResults[lane.id];
            return (
              <KanbanLane
                key={lane.id}
                laneId={lane.id}
                title={lane.title}
                count={result.items.length}
                accent={lane.accent}
                isLoading={result.isInitialLoading}
              >
                {result.items.map((conversation) => (
                  <KanbanRow
                    key={conversation.id}
                    conversation={conversation}
                    isSelected={selectedConversationId === conversation.id}
                    onClick={() =>
                      setSelectedConversationId(conversation.id)
                    }
                    thresholds={thresholds}
                    now={now}
                    showReviewButton={lane.isReviewable ?? false}
                    dataLaneId={conversation.id}
                  />
                ))}
              </KanbanLane>
            );
          })}
        </div>

        {/* Triage drawer — slides in from the right when a row is
            clicked. Wraps the existing RightPanel (no re-implementation
            of the message thread / AI draft panel). Open state is
            derived from `selectedConversationId` being non-null;
            `onClose` clears it. Rendered OUTSIDE the grid so its
            `fixed` positioning escapes the `overflow-hidden` parent. */}
        <KanbanDrawer
          conversationId={selectedConversationId}
          onClose={() => setSelectedConversationId(null)}
          isOpen={selectedConversationId !== null}
        />
      </div>
    </AppShell>
  );
}
