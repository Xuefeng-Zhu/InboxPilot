'use client';

/**
 * SlaChip — small colored chip showing a conversation's SLA tier + relative time.
 *
 * Visual target: `mockups/4-retool-grade.html:66-91` (right side of row 1).
 * The chip sits on the right edge of a kanban row, mirroring the SLA chip in
 * the mockup's `Mine` lane (`12s`, `42m`, `1h22`, `2d`, `new`).
 *
 * Tier classification is delegated to `slaTier` (T3, commit `c830803`).
 * This component is purely presentational — it computes the delta only
 * for the label, never for the tier itself.
 *
 * WHY a lookup map (not a switch):
 *   The 4 tier→className mappings are static config, not branching logic.
 *   A `Record<SlaTier, string>` is the most readable form: a single table
 *   the reviewer can scan in 5 seconds. Adding a 5th tier would force a
 *   TS compile error here (which is what we want — tiers are locked at 4).
 *
 * WHY `now` is a prop, not a global clock read:
 *   The parent (the kanban page) injects `now` so the chip is
 *   deterministically testable and tolerant of clock skew between server
 *   and client. Reading the global clock here would make the chip a
 *   hidden side-effect, which makes the chip + the parent impossible
 *   to test together.
 */

import { slaTier, type SlaTier, type SlaThresholds } from '../_lib/sla';

type SlaChipProps = {
  lastMessageAt: string | null;
  now: Date;
  thresholds: SlaThresholds;
};

// Tier → Tailwind className. Locked at 4 entries; the `SlaTier` union
// guarantees the map stays exhaustive (TS error if a tier is added but
// the map isn't). Raw Tailwind per the plan — the conversation-status
// tokens live on a different semantic axis (status, not SLA) and would
// conflate the two. Defer tokenization to ui-polish Phase 2.
const tierClasses: Record<SlaTier, string> = {
  new: 'bg-gray-100 text-gray-500',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-rose-100 text-rose-800',
};

// ---------------------------------------------------------------------------
// Private delta formatter
// ---------------------------------------------------------------------------

/**
 * Format a millisecond delta into a compact relative-time label.
 *
 * Buckets (matching the mockup's chip labels):
 *   - `< 60_000`        → `Xs`     (e.g., `12s`, `0s` at the boundary)
 *   - `< 3_600_000`     → `Xm`     (e.g., `42m`)
 *   - `< 86_400_000`    → `XhYY`   (e.g., `1h22`, `5h07` — YY is remainder
 *                                     minutes padded to 2 digits)
 *   - `>= 86_400_000`   → `Xd`     (e.g., `2d`)
 *
 * Edge case at 60_000 ms (exactly 1 minute): the first bucket's predicate
 * is `< 60_000` (strictly less), so 60_000 falls into the `Xm` bucket as
 * `1m`. The task brief flagged this as "debatable" — the strict-less
 * boundary is the choice here, mirroring the inclusive-lower-bound
 * pattern from `slaTier` (delta === bucket-edge belongs to the next
 * bucket). The result is consistent: `30s` for 30s, `1m` for 1m, never
 * `60s` for 1m.
 *
 * The function trusts the caller for sign: negative deltas (future
 * timestamps, clock skew) fall into the first bucket and format as
 * `Xs`. This matches `slaTier`'s contract — negative deltas are a
 * data issue, not a formatter issue.
 */
function formatDelta(deltaMs: number): string {
  if (deltaMs < 60_000) {
    const seconds = Math.floor(deltaMs / 1_000);
    return `${seconds}s`;
  }
  if (deltaMs < 3_600_000) {
    const minutes = Math.floor(deltaMs / 60_000);
    return `${minutes}m`;
  }
  if (deltaMs < 86_400_000) {
    const hours = Math.floor(deltaMs / 3_600_000);
    const minutes = Math.floor((deltaMs % 3_600_000) / 60_000);
    return `${hours}h${String(minutes).padStart(2, '0')}`;
  }
  const days = Math.floor(deltaMs / 86_400_000);
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlaChip({ lastMessageAt, now, thresholds }: SlaChipProps) {
  const tier = slaTier(lastMessageAt, now, thresholds);

  // Label: literal `new` for the null tier, otherwise the formatted delta.
  // Compute the delta only when needed (cheap, but keeps the new branch
  // from paying for a Date parse it doesn't use).
  const label =
    tier === 'new'
      ? 'new'
      : formatDelta(now.getTime() - new Date(lastMessageAt as string).getTime());

  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-sm ${tierClasses[tier]}`}
      aria-label={
        tier === 'new'
          ? 'No messages yet'
          : `Last message ${label} ago`
      }
    >
      {label}
    </span>
  );
}
