/**
 * SLA tier classifier — pure function, dependency-free.
 *
 * Decides which of 4 SLA tiers a conversation is in based on
 * `(now - lastMessageAt)` against the org's `SlaThresholds`.
 *
 * Tiers (locked):
 *   - 'new'   — `lastMessageAt` is null (never messaged).
 *   - 'green' — delta <= greenMs.
 *   - 'amber' — delta <= amberMs.
 *   - 'red'   — delta > amberMs.
 *
 * The lower bounds are INCLUSIVE: `delta === greenMs` returns `'green'`,
 * `delta === amberMs` returns `'amber'`. That makes the chip a closed
 * interval at the lower edge of every tier, so a row whose age is exactly
 * 5 min still reads as fresh and a row exactly 60 min old still reads as
 * amber (not yet red).
 *
 * NO React, NO InsForge, NO IO. Pure TypeScript only.
 */

export type SlaTier = 'new' | 'green' | 'amber' | 'red';

export type SlaThresholds = {
  greenMs: number;
  amberMs: number;
};

/**
 * Compute the millisecond delta between `now` and `lastMessageAt`.
 *
 * `lastMessageAt` is an ISO 8601 string (matching the
 * `conversations.last_message_at` column type). Returns
 * `now - lastMessageAt`: positive for past messages, negative for
 * future messages (clock skew between server and client).
 */
function computeDeltaMs(lastMessageAt: string, now: Date): number {
  return now.getTime() - new Date(lastMessageAt).getTime();
}

/**
 * Classify a conversation into one of 4 SLA tiers.
 *
 * The `now` parameter is injected (not read from `Date.now()`) so the
 * function is trivially testable with a fixed clock.
 *
 * Semantics (locked):
 *   - `lastMessageAt === null`                → `'new'`
 *   - `delta <= thresholds.greenMs`           → `'green'`  (inclusive)
 *   - `delta <= thresholds.amberMs`           → `'amber'`  (inclusive)
 *   - otherwise                               → `'red'`
 *
 * The lower bounds are INCLUSIVE. A row whose age is exactly 5 min
 * reads as `'green'`; a row exactly 60 min old reads as `'amber'` (not
 * yet `'red'`). This makes the chip a closed interval at the lower
 * edge of every tier.
 *
 * Delta is signed (`now - lastMessageAt`): positive for past messages,
 * negative for future messages (clock skew between server and client,
 * or `lastMessageAt` mis-set). The function trusts the caller — a
 * negative delta `<= greenMs` returns `'green'`. In practice,
 * `conversations.last_message_at` is server-stamped at insert time, so
 * negative deltas should not occur; if they do, it's a data issue, not
 * a tier-classifier issue.
 */
export function slaTier(
  lastMessageAt: string | null,
  now: Date,
  thresholds: SlaThresholds,
): SlaTier {
  if (lastMessageAt === null) return 'new';
  const delta = computeDeltaMs(lastMessageAt, now);
  if (delta <= thresholds.greenMs) return 'green';
  if (delta <= thresholds.amberMs) return 'amber';
  return 'red';
}
