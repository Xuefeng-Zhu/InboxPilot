/**
 * Page-level constants for the kanban split-inbox.
 *
 * `KANBAN_LANES` is the locked 5-column order. The order here is the
 * visual order in the grid (left → right) and matches the mockup at
 * `mockups/4-retool-grade.html:55-285`. Don't reorder without
 * re-syncing the visual.
 *
 * `DEFAULT_SLA_THRESHOLDS` is the safe fallback when
 * `useOrganization(orgId)?.sla_thresholds` is null (T4's column is
 * NOT NULL with a DB default, so this is mostly belt-and-suspenders for
 * the moment between org fetch and SLA chip render). Keep the defaults
 * here in lockstep with the migration 009 DEFAULT clause
 * (`insforge/migrations/009_org_sla_thresholds.sql`).
 */

import type { LaneId } from './lane-filters';
import type { LaneDef } from './types';

export const KANBAN_LANES: readonly LaneDef[] = [
  {
    id: 'mine',
    title: 'Mine',
    accent: 'blue',
    emptyCopy:
      'Nothing assigned to you. Pick up an unassigned conversation from the **Unassigned** lane →',
  },
  {
    id: 'escalated',
    title: 'Escalated',
    accent: 'rose',
    emptyCopy: 'No escalations — nice work.',
  },
  {
    id: 'ai_drafted',
    title: 'AI drafted',
    accent: 'violet',
    emptyCopy: 'No AI drafts to review.',
    isReviewable: true,
  },
  {
    id: 'awaiting_reply',
    title: 'Awaiting reply',
    accent: 'amber',
    emptyCopy: 'All caught up — every reply has a response.',
  },
  {
    id: 'unassigned',
    title: 'Unassigned',
    accent: 'neutral',
    emptyCopy: 'No unassigned open conversations.',
  },
] as const;

export const DEFAULT_SLA_THRESHOLDS = {
  greenMs: 300_000, // 5 min
  amberMs: 3_600_000, // 60 min
} as const;

/**
 * Empty-state copy per lane. Read by `KanbanEmptyState`.
 *
 * The "mine" copy uses `**Unassigned**` to bold the word "Unassigned";
 * `KanbanEmptyState` splits on `**` and wraps the inner token in
 * `<strong>`. Tiny markdown subset — keeps the string readable without
 * pulling in a markdown parser.
 */
export const LANE_EMPTY_COPY: Record<LaneId, string> = {
  mine: 'Nothing assigned to you. Pick up an unassigned conversation from the **Unassigned** lane →',
  escalated: 'No escalations — nice work.',
  ai_drafted: 'No AI drafts to review.',
  awaiting_reply: 'All caught up — every reply has a response.',
  unassigned: 'No unassigned open conversations.',
};
