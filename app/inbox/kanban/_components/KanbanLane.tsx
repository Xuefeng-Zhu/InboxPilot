'use client';

/**
 * KanbanLane — one column in the split-inbox kanban.
 *
 * Visual target: `mockups/4-retool-grade.html:58-64` (Mine header), L121-128
 * (Escalated), L172-179 (AI drafted), L226-232 (Awaiting reply). Each lane
 * is a vertical column: a sticky header (dot + title + count + optional
 * delta) over a scrollable body of `KanbanRow` children.
 *
 * This component is purely presentational. The parent (T10, the kanban
 * page) owns data fetching, lane routing, and child-row rendering. The
 * lane only renders what it's given, plus three orthogonal states:
 *
 *   1. `isLoading`  → `Loading…` text (wins over the empty state)
 *   2. `children`   → the rows
 *   3. neither      → placeholder "No items" (T13 replaces with
 *                     a proper `KanbanEmptyState`).
 *
 * The accent dot is a per-lane brand color (NOT a status indicator),
 * so we use raw Tailwind `bg-{color}-500` classes via a `Record` map.
 * The conversation-status tokens are a different semantic axis
 * (status, not lane) and would conflate the two.
 *
 * Test hooks (consumed by T14 unit tests and T15 Playwright e2e):
 *   - `data-testid="kanban-lane-${laneId}"` on the outer container
 *   - `data-testid="lane-count"` on the count badge
 *   - `aria-label="${title} lane with ${count} items"` on the outer
 */

import type { LaneId } from '../_lib/lane-filters';
import { KanbanEmptyState } from './KanbanEmptyState';

type Accent = 'blue' | 'rose' | 'violet' | 'amber' | 'neutral';

// Accent → Tailwind dot class. `Record<Accent, string>` makes adding a
// 5th accent (or renaming) a TS compile error here — exactly what we
// want, since the lane palette is locked at 5 by the design system.
// `neutral` intentionally maps to `bg-gray-400` (not `bg-neutral-500`)
// to match the mockup's `Mine` empty state in the other waves.
const accentDotClasses: Record<Accent, string> = {
  blue: 'bg-blue-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  neutral: 'bg-gray-400',
};

export interface KanbanLaneProps {
  laneId: LaneId;
  title: string;
  count: number;
  delta?: number;
  accent: Accent;
  isLoading: boolean;
  children?: React.ReactNode;
}

export function KanbanLane({
  laneId,
  title,
  count,
  delta,
  accent,
  isLoading,
  children,
}: KanbanLaneProps) {
  return (
    <div
      className="flex h-full min-w-0 flex-col"
      data-testid={`kanban-lane-${laneId}`}
      aria-label={`${title} lane with ${count} items`}
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--m03-line)] bg-white px-2.5 py-1.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${accentDotClasses[accent]}`}
        />
        <span className="text-[12px] font-semibold text-[var(--m03-fg)]">
          {title}
        </span>
        <span
          data-testid="lane-count"
          className="text-[11px] text-[var(--m03-fg-3)]"
        >
          {count}
        </span>
        {delta !== undefined && delta !== 0 ? (
          <span className="ml-auto font-mono text-[10.5px] text-emerald-600">
            +{delta}
          </span>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-[12px] text-[var(--m03-fg-3)]">
            Loading…
          </div>
        ) : children ? (
          children
        ) : (
          <KanbanEmptyState laneId={laneId} />
        )}
      </div>
    </div>
  );
}
