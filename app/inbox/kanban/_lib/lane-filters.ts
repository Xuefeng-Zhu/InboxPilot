/**
 * Kanban lane filter — pure function, dependency-free.
 *
 * Decides which of 5 lanes a conversation belongs to. Precedence (top wins):
 *   1. escalated       — status === 'escalated'
 *   2. ai_drafted      — ai_state === 'drafted'
 *   3. awaiting_reply  — last_message_direction === 'outbound' AND no inbound since
 *   4. unassigned      — assigned_to IS NULL AND status NOT IN ('resolved','closed')
 *   5. mine            — assigned_to === userId AND status NOT IN ('resolved','closed')
 *
 * NO React, NO InsForge, NO IO. Pure TypeScript only.
 */

import type { ConversationListItem } from '../../../../lib/queries/keys';

export type LaneId =
  | 'escalated'
  | 'ai_drafted'
  | 'awaiting_reply'
  | 'unassigned'
  | 'mine';

/**
 * Local input type. The canonical `ConversationListItem` does not yet include
 * `last_message_direction` (Task 4 adds it). This alias is the migration
 * surface; once `lib/queries/keys.ts` gains the field, this `& { ... }` becomes
 * a no-op and can be removed.
 */
export type ConversationWithDirection = ConversationListItem & {
  last_message_direction: string | null;
};

/** Statuses that remove a conversation from the active kanban. */
const INACTIVE_STATUSES = new Set<string>(['resolved', 'closed']);

const isActive = (c: ConversationWithDirection): boolean =>
  !INACTIVE_STATUSES.has(c.status);

// ─── Lane predicates ──────────────────────────────────────────────────
// Each predicate is independently readable and unit-testable in isolation.

/** Lane 1: status === 'escalated'. Wins over every other signal. */
export const isEscalated = (c: ConversationWithDirection): boolean =>
  c.status === 'escalated';

/** Lane 2: AI has a draft ready for the agent to review/send. */
export const isAiDrafted = (c: ConversationWithDirection): boolean =>
  c.ai_state === 'drafted';

/**
 * Lane 3: the last message was sent by us (outbound) and the customer has
 * not replied yet. The "no inbound since" half is implicit — the input row
 * already joins the latest message, so a row with `last_message_direction =
 * 'outbound'` means no inbound has been recorded after the last send.
 */
export const isOutboundAwaiting = (c: ConversationWithDirection): boolean =>
  c.last_message_direction === 'outbound';

/** Lane 4: nobody is assigned AND the conversation is still active. */
export const isUnassigned = (
  c: ConversationWithDirection,
  _userId: string | null,
): boolean => c.assigned_to === null && isActive(c);

/**
 * Lane 5: assigned to the current user AND the conversation is still
 * active. The `_userId` parameter is kept for symmetry with `isUnassigned`
 * and to make the call site self-documenting.
 */
export const isMineActive = (
  c: ConversationWithDirection,
  userId: string | null,
): boolean => c.assigned_to === userId && isActive(c);

// ─── Router ───────────────────────────────────────────────────────────

/**
 * Route a conversation to exactly one of 5 lanes, in locked precedence order.
 * First predicate match wins. Returns `'unassigned'` as a safe catch-all if
 * no lane matches (e.g. status is `resolved`/`closed` but the row slipped
 * past the page filter).
 */
export function routeToLane(
  conversation: ConversationWithDirection,
  userId: string | null,
): LaneId {
  if (isEscalated(conversation)) return 'escalated';
  if (isAiDrafted(conversation)) return 'ai_drafted';
  if (isOutboundAwaiting(conversation)) return 'awaiting_reply';
  if (isUnassigned(conversation, userId)) return 'unassigned';
  if (isMineActive(conversation, userId)) return 'mine';
  return 'unassigned';
}
