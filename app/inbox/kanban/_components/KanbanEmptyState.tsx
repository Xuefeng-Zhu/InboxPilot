'use client';

import type { LaneId } from '../_lib/lane-filters';
import { LANE_EMPTY_COPY } from '../_lib/constants';

/**
 * KanbanEmptyState — empty placeholder for a lane with 0 rows.
 *
 * Per-lane copy is read from `LANE_EMPTY_COPY` (a `Record<LaneId, string>`
 * in `constants.ts`). The "mine" copy contains the literal token
 * `**Unassigned**` which is split on `**` here and rendered with the
 * word wrapped in `<strong>` — a tiny markdown subset that keeps the
 * copy string readable without introducing a markdown dependency.
 *
 * The container is `flex items-center justify-center` with a min height
 * so the lane always has a visible "empty" affordance, not a flat
 * 0-height void. The text is dim (`var(--m03-fg-3)`) to match the
 * rest of the app's empty state convention.
 */
export function KanbanEmptyState({ laneId }: { laneId: LaneId }) {
  const copy = LANE_EMPTY_COPY[laneId];

  // The "mine" copy uses `**word**` to mark a bolded word. Render it
  // as alternating plain/bold spans.
  if (laneId === 'mine') {
    const parts = copy.split('**');
    return (
      <div
        data-testid={`kanban-empty-${laneId}`}
        className="flex h-full min-h-[80px] items-center justify-center px-3 py-6 text-center text-[12px] leading-[1.5] text-[var(--m03-fg-3)]"
      >
        <p>
          {parts.map((part, i) =>
            i % 2 === 1 ? (
              <strong key={i}>{part}</strong>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid={`kanban-empty-${laneId}`}
      className="flex h-full min-h-[80px] items-center justify-center px-3 py-6 text-center text-[12px] leading-[1.5] text-[var(--m03-fg-3)]"
    >
      <p>{copy}</p>
    </div>
  );
}
