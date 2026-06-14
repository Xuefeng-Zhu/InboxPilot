/**
 * Page-level type definitions for the kanban split-inbox.
 *
 * `LaneId` is owned by `lane-filters.ts` (T2) — the page only re-exports it
 * so consumers can import both `LaneId` and `LaneDef` from one place.
 *
 * `LaneDef` is the page-level static config for a single lane: its
 * identifier, the human-facing title shown in the column header, the
 * brand-accent color, and the empty-state copy. The actual
 * sticky-header / scrollable-body / row-rendering lives in
 * `_components/KanbanLane.tsx` (T7); this type is the data shape the
 * page feeds into the component, not the component's prop shape.
 *
 * `isReviewable` is the per-lane affordance flag. T8's `KanbanRow` shows
 * the `Review` button only when `showReviewButton=true`, so the page
 * forwards `lane.isReviewable ?? false` into that prop. Currently only
 * the `ai_drafted` lane sets it.
 */

import type { LaneId } from './lane-filters';
export type { LaneId } from './lane-filters';

export interface LaneDef {
  id: LaneId;
  title: string;
  accent: 'blue' | 'rose' | 'violet' | 'amber' | 'neutral';
  emptyCopy: string; // shown when the lane is empty (T13 reads this)
  isReviewable?: boolean; // true for ai_drafted (shows Review button on rows)
}
