import { describe, it, expect, vi } from 'vitest';
import { AiDecisionRepository } from '../../src/repositories/ai-decision-repository.js';
import type { DatabaseClient, QueryBuilder, QueryResult } from '../../src/interfaces/database-client.js';

/**
 * Unit tests for AiDecisionRepository.
 *
 * Uses a mock DatabaseClient to verify query construction and
 * snake_case ↔ camelCase mapping without a real database.
 */

/** Helper: build a mock QueryBuilder that chains and resolves to a given result. */
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

/** Build a snake_case ai_decisions row as the database would return it. */
function row(overrides: Partial<{
  id: string;
  conversation_id: string;
  organization_id: string;
  message_id: string | null;
  decision_type: 'respond' | 'escalate' | 'clarify';
  confidence: number;
  reasoning_summary: string | null;
  response_text: string | null;
  tags: string[];
  requires_human: boolean;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'd-1',
    conversation_id: overrides.conversation_id ?? 'conv-1',
    organization_id: overrides.organization_id ?? 'org-1',
    message_id: overrides.message_id ?? null,
    decision_type: overrides.decision_type ?? 'respond',
    confidence: overrides.confidence ?? 0,
    reasoning_summary: overrides.reasoning_summary ?? null,
    response_text: overrides.response_text ?? null,
    tags: overrides.tags ?? [],
    requires_human: overrides.requires_human ?? false,
    raw_response: overrides.raw_response ?? null,
    created_at: overrides.created_at ?? '2024-01-15T10:30:00.000Z',
  };
}

describe('AiDecisionRepository', () => {
  describe('countConsecutiveFailures', () => {
    it('returns 0 when there are no recent decisions', async () => {
      const builder = createMockQueryBuilder({ data: [], error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1', 10);

      expect(count).toBe(0);
      expect(db.from).toHaveBeenCalledWith('ai_decisions');
      expect(builder.eq).toHaveBeenCalledWith('conversation_id', 'conv-1');
      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(10);
    });

    it('returns 0 when the most-recent decision is a successful respond', async () => {
      // newest first: [success]
      const rows = [row({ id: 'd-3', tags: ['returns'] })];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1');

      expect(count).toBe(0);
    });

    it('returns 1 when the most-recent decision is a single parse_error', async () => {
      // [parse_error, success, success] -> 1
      const rows = [
        row({ id: 'd-3', tags: ['parse_error'] }),
        row({ id: 'd-2', tags: ['returns'] }),
        row({ id: 'd-1', tags: [] }),
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1');

      expect(count).toBe(1);
    });

    it('returns 3 when the three most-recent decisions are all failures (the launch scenario)', async () => {
      // The case that previously could never fire: default maxConsecutiveFailures=3.
      // [error, parse_error, error, success] -> 3
      const rows = [
        row({ id: 'd-4', tags: ['error'] }),
        row({ id: 'd-3', tags: ['parse_error'] }),
        row({ id: 'd-2', tags: ['error'] }),
        row({ id: 'd-1', tags: ['returns'] }),
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1');

      expect(count).toBe(3);
    });

    it('stops counting at the first non-failure (does not count past it)', async () => {
      // [error, error, success, error] -> 2, not 3
      // The most-recent run starts with 2 errors and recovers; the older
      // single error must not pull the count up to 3 (otherwise escalation
      // would fire on a conversation that already recovered).
      const rows = [
        row({ id: 'd-4', tags: ['error'] }),
        row({ id: 'd-3', tags: ['error'] }),
        row({ id: 'd-2', tags: ['returns'] }),
        row({ id: 'd-1', tags: ['error'] }),
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1');

      expect(count).toBe(2);
    });

    it('counts failure tags even when they are mixed with other tags', async () => {
      // LLM might include other tags alongside parse_error (e.g. ['low_confidence', 'parse_error']).
      const rows = [
        row({ id: 'd-2', tags: ['low_confidence', 'parse_error'] }),
        row({ id: 'd-1', tags: ['error', 'retry'] }),
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1');

      expect(count).toBe(2);
    });

    it('does not count an `escalate` decision as a failure (escalate is a deliberate decision)', async () => {
      // [escalate, error, error] -> 0. The conversation was escalated to a
      // human by design; the "error" rows are stale from a previous attempt
      // and should not push us back over the failure threshold.
      const rows = [
        row({ id: 'd-3', decision_type: 'escalate', tags: ['escalated'], requires_human: true }),
        row({ id: 'd-2', tags: ['error'] }),
        row({ id: 'd-1', tags: ['parse_error'] }),
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1');

      expect(count).toBe(0);
    });

    it('caps the scan at the requested window (DB enforces via limit)', async () => {
      // The window is enforced by the SQL `.limit(window)` on the query,
      // not by the in-memory scan — when the DB returns only 3 rows we
      // can only count up to 3. The test data is shaped accordingly: the
      // repository would never see rows 4 and 5.
      const rows = [
        row({ id: 'd-5', tags: ['error'] }),
        row({ id: 'd-4', tags: ['error'] }),
        row({ id: 'd-3', tags: ['error'] }),
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      const count = await repo.countConsecutiveFailures('conv-1', 3);

      expect(count).toBe(3);
      // The window must have been passed to the database query
      expect(builder.limit).toHaveBeenCalledWith(3);
    });

    it('caps the scan at the default window of 10 when no window is given', async () => {
      const builder = createMockQueryBuilder({ data: [], error: null });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      await repo.countConsecutiveFailures('conv-1');

      expect(builder.limit).toHaveBeenCalledWith(10);
    });

    it('propagates a database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'connection lost' },
      });
      const db = createMockDb(builder);
      const repo = new AiDecisionRepository(db);

      await expect(repo.countConsecutiveFailures('conv-1')).rejects.toThrow(/connection lost/);
    });
  });
});
