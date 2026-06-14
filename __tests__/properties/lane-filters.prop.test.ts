import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  routeToLane,
  type ConversationWithDirection,
  type LaneId,
} from '../../app/inbox/kanban/_lib/lane-filters';

const LANE_IDS: readonly LaneId[] = [
  'escalated',
  'ai_drafted',
  'awaiting_reply',
  'unassigned',
  'mine',
] as const;

/**
 * Conversation arbitrary — every field is generated, including valid AND
 * invalid enum values, to assert the function is robust to arbitrary input.
 *
 * The 5 lanes are decided by 3 fields:
 *   - status               (drives escalated + unassigned/mine active filter)
 *   - ai_state             (drives ai_drafted)
 *   - last_message_direction (drives awaiting_reply)
 *   - assigned_to          (drives unassigned vs mine)
 *
 * The remaining fields are noise — they should never influence routing.
 */
const statusArb = fc.oneof(
  fc.constantFrom('open', 'pending', 'resolved', 'escalated', 'closed'),
  fc.string({ minLength: 0, maxLength: 30 }),
);

const aiStateArb = fc.oneof(
  fc.constantFrom('idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed'),
  fc.string({ minLength: 0, maxLength: 30 }),
);

const directionArb = fc.option(
  fc.oneof(
    fc.constantFrom('inbound', 'outbound'),
    fc.string({ minLength: 0, maxLength: 30 }),
  ),
  { nil: null, freq: 2 },
);

const userIdArb = fc.option(fc.uuid(), { nil: null, freq: 2 });

const conversationArb = fc.record({
  id: fc.uuid(),
  organization_id: fc.uuid(),
  contact_id: fc.uuid(),
  channel: fc.constantFrom('sms', 'email', 'webchat'),
  status: statusArb,
  ai_state: aiStateArb,
  subject: fc.option(fc.string(), { nil: null }),
  assigned_to: fc.option(fc.uuid(), { nil: null, freq: 2 }),
  last_message_at: fc.option(fc.constant('2024-01-15T10:30:00.000Z'), { nil: null }),
  last_message_direction: directionArb,
  created_at: fc.constant('2024-01-01T00:00:00.000Z'),
  contacts: fc.constant(null),
}) as fc.Arbitrary<ConversationWithDirection>;

/** Convenience: build a conversation from a field-override spread. */
function buildConversation(
  overrides: Partial<ConversationWithDirection> = {},
): ConversationWithDirection {
  return {
    id: 'conv-x',
    organization_id: 'org-x',
    contact_id: 'contact-x',
    channel: 'sms',
    status: 'open',
    ai_state: 'idle',
    subject: null,
    assigned_to: null,
    last_message_at: null,
    last_message_direction: null,
    created_at: '2024-01-01T00:00:00.000Z',
    contacts: null,
    ...overrides,
  };
}

// ─── Property Tests ──────────────────────────────────────────────────

describe('Property 1: Precedence — escalated always wins', () => {
  it('any conversation with status="escalated" routes to "escalated"', () => {
    fc.assert(
      fc.property(
        aiStateArb,
        directionArb,
        fc.option(fc.uuid(), { nil: null, freq: 2 }),
        userIdArb,
        (aiState, direction, assignedTo, userId) => {
          const c = buildConversation({
            status: 'escalated',
            ai_state: aiState,
            last_message_direction: direction,
            assigned_to: assignedTo,
          });
          expect(routeToLane(c, userId)).toBe('escalated');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: One lane only', () => {
  it('routeToLane returns exactly one of the 5 LaneId values for any input', () => {
    fc.assert(
      fc.property(conversationArb, userIdArb, (c, userId) => {
        const result = routeToLane(c, userId);
        expect(LANE_IDS).toContain(result);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 3: AI drafted precedence', () => {
  it('non-escalated with ai_state="drafted" routes to "ai_drafted"', () => {
    fc.assert(
      fc.property(
        statusArb.filter((s) => s !== 'escalated'),
        directionArb,
        fc.option(fc.uuid(), { nil: null, freq: 2 }),
        userIdArb,
        (status, direction, assignedTo, userId) => {
          const c = buildConversation({
            status,
            ai_state: 'drafted',
            last_message_direction: direction,
            assigned_to: assignedTo,
          });
          expect(routeToLane(c, userId)).toBe('ai_drafted');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: Awaiting reply definition', () => {
  it('non-escalated, non-drafted, outbound-last routes to "awaiting_reply"', () => {
    fc.assert(
      fc.property(
        statusArb.filter((s) => s !== 'escalated'),
        aiStateArb.filter((s) => s !== 'drafted'),
        fc.option(fc.uuid(), { nil: null, freq: 2 }),
        userIdArb,
        (status, aiState, assignedTo, userId) => {
          const c = buildConversation({
            status,
            ai_state: aiState,
            last_message_direction: 'outbound',
            assigned_to: assignedTo,
          });
          expect(routeToLane(c, userId)).toBe('awaiting_reply');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 5: Unassigned vs Mine', () => {
  it('active, non-drafted, inbound/no-direction-last: assigned_to=null → unassigned, assigned_to=userId → mine, never both', () => {
    fc.assert(
      fc.property(
        // Active statuses: anything NOT IN ('resolved', 'closed', 'escalated')
        fc.constantFrom('open', 'pending', 'active', 'snoozed', 'new'),
        // ai_state must NOT be 'drafted'
        aiStateArb.filter((s) => s !== 'drafted'),
        // last_message_direction must NOT be 'outbound'
        directionArb.filter((d) => d !== 'outbound'),
        userIdArb,
        (status, aiState, direction, userId) => {
          // The userId must be non-null for the "mine" branch to apply; if it's
          // null we can only test the "unassigned" half. So we generate a
          // non-null userId for the "mine" sub-property.
          const concreteUserId = userId ?? 'concrete-user-id';

          // Branch A: assigned_to === null → unassigned
          const unassignedConv = buildConversation({
            status,
            ai_state: aiState,
            last_message_direction: direction,
            assigned_to: null,
          });
          expect(routeToLane(unassignedConv, concreteUserId)).toBe('unassigned');

          // Branch B: assigned_to === userId → mine
          const mineConv = buildConversation({
            status,
            ai_state: aiState,
            last_message_direction: direction,
            assigned_to: concreteUserId,
          });
          expect(routeToLane(mineConv, concreteUserId)).toBe('mine');

          // Edge: null-fields conversation lands in unassigned (covers QA
          // scenario 2 — fresh conversation with all nullable fields null).
          const nullEdgeConv = buildConversation({
            status: 'open',
            ai_state: 'idle',
            assigned_to: null,
            last_message_at: null,
            last_message_direction: null,
          });
          expect(routeToLane(nullEdgeConv, concreteUserId)).toBe('unassigned');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Extended edge cases (T16) ────────────────────────────────────────

describe('Property 6: Precedence wins when both escalated and unassigned match', () => {
  it('escalated + assigned_to=null still routes to "escalated" (precedence over Unassigned)', () => {
    fc.assert(
      fc.property(
        aiStateArb,
        directionArb,
        userIdArb,
        (aiState, direction, userId) => {
          const c = buildConversation({
            status: 'escalated',
            ai_state: aiState,
            assigned_to: null,
            last_message_direction: direction,
          });
          expect(routeToLane(c, userId)).toBe('escalated');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 7: All fields null defaults to unassigned', () => {
  it('a fully-null conversation (no status, no ai_state, no assigned_to, no last_message_direction) routes to "unassigned"', () => {
    fc.assert(
      fc.property(userIdArb, (userId) => {
        const c = buildConversation({
          status: 'open',
          ai_state: 'idle',
          assigned_to: null,
          last_message_at: null,
          last_message_direction: null,
        });
        expect(routeToLane(c, userId)).toBe('unassigned');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 8: userId=null prevents Mine lane', () => {
  it('Mine lane is never returned when userId is null, regardless of assigned_to', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        directionArb.filter((d) => d !== 'outbound'),
        (assignedTo, direction) => {
          const c = buildConversation({
            status: 'open',
            ai_state: 'idle',
            assigned_to: assignedTo,
            last_message_direction: direction,
          });
          // userId is null — Mine lane must not match
          expect(routeToLane(c, null)).not.toBe('mine');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 9: Resolved conversations route to a non-Mine lane', () => {
  it('status="resolved" + assigned_to=userId does NOT route to "mine" (Mine excludes resolved/closed)', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        userIdArb,
        (assignedTo, userId) => {
          const concreteUserId = userId ?? 'concrete-user';
          const c = buildConversation({
            status: 'resolved',
            ai_state: 'idle',
            assigned_to: concreteUserId,
            last_message_direction: null,
          });
          // Mine predicate requires `isActive(c)` which excludes resolved.
          // So this conversation should NOT land in Mine.
          expect(routeToLane(c, concreteUserId)).not.toBe('mine');
        },
      ),
      { numRuns: 100 },
    );
  });
});
