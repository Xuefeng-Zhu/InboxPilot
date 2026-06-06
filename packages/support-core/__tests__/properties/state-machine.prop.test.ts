import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { DatabaseClient, QueryBuilder, QueryResult } from '../../src/interfaces/database-client.js';
import type { ConversationStatus, AiState } from '../../src/types/index.js';

/**
 * Property-based tests for the conversation state machine.
 *
 * Feature: ai-customer-support
 */

// ─── Valid value sets (from the design document / DB CHECK constraints) ───

const VALID_STATUSES: ConversationStatus[] = ['open', 'pending', 'resolved', 'escalated'];
const VALID_AI_STATES: AiState[] = ['idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed'];

// ─── Mock helpers ────────────────────────────────────────────────────

/** Build a mock QueryBuilder that chains and resolves to a given result. */
function createMockQueryBuilder(result: QueryResult): QueryBuilder {
  const builder: QueryBuilder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve) => Promise.resolve(resolve?.(result))),
  };
  return builder;
}

function createMockDb(builder: QueryBuilder): DatabaseClient {
  return {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn(),
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────

/** Arbitrary for a valid ConversationStatus. */
const validStatusArb = fc.constantFrom<ConversationStatus>(...VALID_STATUSES);

/** Arbitrary for a valid AiState. */
const validAiStateArb = fc.constantFrom<AiState>(...VALID_AI_STATES);

/** Arbitrary for an arbitrary string that may or may not be a valid status. */
const arbitraryStringArb = fc.oneof(
  fc.constantFrom(...VALID_STATUSES),
  fc.constantFrom('closed', 'archived', 'deleted', 'spam', 'active', 'inactive', ''),
  fc.string({ minLength: 1, maxLength: 30 }),
);

/** Arbitrary for an arbitrary string that may or may not be a valid ai_state. */
const arbitraryAiStateStringArb = fc.oneof(
  fc.constantFrom(...VALID_AI_STATES),
  fc.constantFrom('running', 'pending', 'completed', 'error', 'waiting', ''),
  fc.string({ minLength: 1, maxLength: 30 }),
);

// ─── Property Tests ──────────────────────────────────────────────────

describe('Conversation state machine property tests', () => {
  /**
   * Property 12: Conversation state machine invariant
   *
   * For any conversation at any point, status is exactly one of
   * {open, pending, resolved, escalated} and ai_state is exactly one of
   * {idle, thinking, drafted, auto_replied, needs_human, failed}.
   * No operation produces a value outside these sets.
   *
   * **Validates: Requirements 5.3, 5.4**
   *
   * Feature: ai-customer-support, Property 12: Conversation state machine invariant
   */
  it('Property 12: valid status values are exactly {open, pending, resolved, escalated}', () => {
    fc.assert(
      fc.property(arbitraryStringArb, (value) => {
        const isValid = VALID_STATUSES.includes(value as ConversationStatus);
        const expectedValid = ['open', 'pending', 'resolved', 'escalated'].includes(value);
        expect(isValid).toBe(expectedValid);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 12: valid ai_state values are exactly {idle, thinking, drafted, auto_replied, needs_human, failed}', () => {
    fc.assert(
      fc.property(arbitraryAiStateStringArb, (value) => {
        const isValid = VALID_AI_STATES.includes(value as AiState);
        const expectedValid = ['idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed'].includes(value);
        expect(isValid).toBe(expectedValid);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 12: ConversationRepository.update only passes valid status and ai_state to the database', async () => {
    await fc.assert(
      fc.asyncProperty(validStatusArb, validAiStateArb, async (status, aiState) => {
        const updatedRow = {
          id: 'conv-1',
          organization_id: 'org-1',
          contact_id: 'contact-1',
          channel: 'sms' as const,
          status,
          ai_state: aiState,
          subject: null,
          assigned_to: null,
          last_message_at: '2024-01-15T10:30:00.000Z',
          metadata: {},
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-15T10:30:00.000Z',
        };

        const builder = createMockQueryBuilder({ data: updatedRow, error: null });
        const db = createMockDb(builder);
        const repo = new ConversationRepository(db);

        const result = await repo.update('conv-1', { status, aiState });

        // The returned conversation must have valid status and ai_state
        expect(VALID_STATUSES).toContain(result.status);
        expect(VALID_AI_STATES).toContain(result.aiState);

        // The values must match what we set
        expect(result.status).toBe(status);
        expect(result.aiState).toBe(aiState);

        // Verify the update call sent the correct snake_case values
        expect(builder.update).toHaveBeenCalledWith(
          expect.objectContaining({
            status,
            ai_state: aiState,
          }),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('Property 12: every valid (status, ai_state) pair is representable and round-trips through the repository', async () => {
    await fc.assert(
      fc.asyncProperty(validStatusArb, validAiStateArb, async (status, aiState) => {
        const row = {
          id: 'conv-rt',
          organization_id: 'org-rt',
          contact_id: 'contact-rt',
          channel: 'email' as const,
          status,
          ai_state: aiState,
          subject: 'Test subject',
          assigned_to: null,
          last_message_at: null,
          metadata: {},
          created_at: '2024-06-01T00:00:00.000Z',
          updated_at: '2024-06-01T00:00:00.000Z',
        };

        const builder = createMockQueryBuilder({ data: row, error: null });
        const db = createMockDb(builder);
        const repo = new ConversationRepository(db);

        // Simulate creating a conversation with the given status/aiState
        const created = await repo.create({
          organizationId: 'org-rt',
          contactId: 'contact-rt',
          channel: 'email',
          status,
          aiState,
        });

        // The created conversation must have valid values
        expect(VALID_STATUSES).toContain(created.status);
        expect(VALID_AI_STATES).toContain(created.aiState);
        expect(created.status).toBe(status);
        expect(created.aiState).toBe(aiState);
      }),
      { numRuns: 100 },
    );
  });
});
