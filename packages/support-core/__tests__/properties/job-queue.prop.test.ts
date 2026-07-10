import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PostgresJobQueue } from '@support-core/services/postgres-job-queue';
import type { DatabaseClient, QueryBuilder, QueryResult } from '@support-core/interfaces/database-client';
import type { Job, JobType, JobStatus } from '@support-core/types/index';

/**
 * Property-based tests for the PostgresJobQueue.
 *
 * Feature: ai-customer-support
 */

// ─── Helpers ──────────────────────────────────────────────────────────

/** Arbitrary for valid job types. */
const jobTypeArb = fc.constantFrom<JobType>(
  'process_ai_message',
  'process_knowledge_document',
  'send_outbound_message',
  'process_delivery_status',
  'record_chunk_refs',
  'retry_failed_jobs',
);

const idempotentJobTypeArb = fc.constantFrom<JobType>(
  'process_ai_message',
  'process_knowledge_document',
  'send_outbound_message',
  'process_delivery_status',
  'record_chunk_refs',
);

/** Arbitrary for org IDs. */
const orgIdArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 20 },
).map((s) => `org-${s}`);

/** Arbitrary for UUID-like IDs. */
const uuidArb = fc.stringOf(
  fc.constantFrom(...'abcdef0123456789'.split('')),
  { minLength: 8, maxLength: 8 },
).map((s) => `${s}-0000-0000-0000-000000000000`);

/** Arbitrary for attempts (0 to 10). */
const attemptsArb = fc.integer({ min: 0, max: 10 });

/** Arbitrary for max_attempts (1 to 10). */
const maxAttemptsArb = fc.integer({ min: 1, max: 10 });

/** Arbitrary for error messages. */
const errorMsgArb = fc.string({ minLength: 1, maxLength: 100 });

/** Arbitrary for claim limit. */
const limitArb = fc.integer({ min: 1, max: 20 });

/** Arbitrary for number of pending jobs available. */
const pendingCountArb = fc.integer({ min: 0, max: 30 });

/**
 * Creates a mock DatabaseClient that tracks calls and returns configured data.
 */
function createMockDb(options: {
  rpcResult?: QueryResult;
  fromSelectResult?: QueryResult;
  fromInsertResult?: QueryResult;
  fromUpdateResult?: QueryResult;
  onUpdate?: (values: Record<string, unknown>) => void;
  onInsert?: (values: Record<string, unknown>) => void;
  onEq?: (column: string, value: unknown) => void;
  onContains?: (column: string, value: Record<string, unknown>) => void;
}): DatabaseClient {
  const {
    rpcResult = { data: [], error: null },
    fromSelectResult = { data: null, error: null },
    fromInsertResult = { data: null, error: null },
    fromUpdateResult = { data: null, error: null },
    onUpdate,
    onInsert,
    onEq,
    onContains,
  } = options;

  // Build a chainable query builder mock
  function createQueryBuilder(resolveWith: QueryResult): QueryBuilder {
    const builder: QueryBuilder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        if (onInsert) onInsert(values);
        // After insert, resolve with insert result
        return createQueryBuilder(fromInsertResult);
      }),
      update: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        if (onUpdate) onUpdate(values);
        return createQueryBuilder(fromUpdateResult);
      }),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(function (
        this: QueryBuilder,
        column: string,
        value: unknown,
      ) {
        onEq?.(column, value);
        return this;
      }),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      like: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      contains: vi.fn().mockImplementation(function (
        this: QueryBuilder,
        column: string,
        value: Record<string, unknown>,
      ) {
        onContains?.(column, value);
        return this;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((onfulfilled, onrejected) => {
        return Promise.resolve(resolveWith).then(onfulfilled, onrejected);
      }),
    };
    return builder;
  }

  return {
    from: vi.fn().mockImplementation(() => createQueryBuilder(fromSelectResult)),
    rpc: vi.fn().mockImplementation(async () => rpcResult),
  };
}

// ─── Property Tests ───────────────────────────────────────────────────

describe('Job queue property tests', () => {
  /**
   * Property 8: Job queue exponential backoff and dead-lettering
   *
   * For any job that fails, run_after = now() + 2^attempts seconds.
   * When attempts >= max_attempts, status = "dead".
   *
   * **Validates: Requirements 13.4, 13.5, 29.8**
   *
   * Feature: ai-customer-support, Property 8: Job queue exponential backoff and dead-lettering
   */
  it('Property 8: failing a job applies exponential backoff or dead-letters when attempts >= max_attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        attemptsArb,
        maxAttemptsArb,
        errorMsgArb,
        async (jobId, currentAttempts, maxAttempts, errorMsg) => {
          // Track what gets written to the DB
          let capturedUpdate: Record<string, unknown> | null = null;

          const jobRow = {
            id: jobId,
            organization_id: 'org-test',
            job_type: 'process_ai_message',
            payload: {},
            status: 'claimed',
            attempts: currentAttempts,
            max_attempts: maxAttempts,
            last_error: null,
            run_after: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null,
          };

          const db = createMockDb({
            fromSelectResult: { data: jobRow, error: null },
            fromUpdateResult: { data: null, error: null },
            onUpdate: (values) => {
              capturedUpdate = values;
            },
          });

          const queue = new PostgresJobQueue(db);

          await queue.fail(jobId, errorMsg);

          // The update should have been captured
          expect(capturedUpdate).not.toBeNull();

          const newAttempts = currentAttempts + 1;

          // Verify attempts was incremented
          expect(capturedUpdate!.attempts).toBe(newAttempts);

          // Verify error was recorded
          expect(capturedUpdate!.last_error).toBe(errorMsg);

          if (newAttempts >= maxAttempts) {
            // Dead-lettered: status should be 'dead'
            expect(capturedUpdate!.status).toBe('dead');
          } else {
            // Exponential backoff: status should be 'failed'
            expect(capturedUpdate!.status).toBe('failed');

            // Verify run_after is approximately now + 2^newAttempts seconds
            const runAfter = new Date(capturedUpdate!.run_after as string);
            const expectedBackoffMs = Math.pow(2, newAttempts) * 1000;
            const now = Date.now();
            const actualDiffMs = runAfter.getTime() - now;

            // Allow 2 second tolerance for test execution time
            expect(actualDiffMs).toBeGreaterThan(expectedBackoffMs - 2000);
            expect(actualDiffMs).toBeLessThan(expectedBackoffMs + 2000);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 9: Job enqueue idempotency
   *
   * Enqueuing the same job twice results in exactly one job.
   * If a pending/claimed job with the same type and key payload fields exists,
   * the existing job is returned instead of creating a new one.
   *
   * **Validates: Requirements 13.8**
   *
   * Feature: ai-customer-support, Property 9: Job enqueue idempotency
   */
  it('Property 9: enqueuing the same job type and payload twice returns the existing job', async () => {
    await fc.assert(
      fc.asyncProperty(
        idempotentJobTypeArb,
        orgIdArb,
        uuidArb,
        async (jobType, orgId, existingJobId) => {
          // Build a payload appropriate for the job type
          const payload: Record<string, unknown> = {};
          if (jobType === 'process_ai_message') {
            payload.conversationId = 'conv-123';
            payload.messageId = 'msg-456';
          } else if (jobType === 'process_knowledge_document') {
            payload.documentId = 'doc-789';
          } else if (jobType === 'send_outbound_message') {
            payload.conversationId = 'conv-123';
            payload.aiDecisionId = 'decision-456';
          } else if (jobType === 'process_delivery_status') {
            payload.externalMessageId = 'ext-abc';
          } else if (jobType === 'record_chunk_refs') {
            payload.ai_decision_id = 'decision-789';
          }

          const existingJobRow = {
            id: existingJobId,
            organization_id: orgId,
            job_type: jobType,
            payload,
            status: 'pending',
            attempts: 0,
            max_attempts: 5,
            last_error: null,
            run_after: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: null,
          };

          let insertCalled = false;

          // First call: findExistingJob returns null (no existing job)
          // Second call: findExistingJob returns the existing job
          let callCount = 0;

          const db: DatabaseClient = {
            from: vi.fn().mockImplementation(() => {
              callCount++;
              // Calls 1-2 are from findExistingJob (first enqueue)
              // Call 3 is from insert (first enqueue)
              // Call 4 is from select after insert (first enqueue)
              // Calls 5-6 are from findExistingJob (second enqueue) — returns existing
              const builder: QueryBuilder = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockImplementation(() => {
                  insertCalled = true;
                  // Return a builder that resolves with the inserted row
                  const insertBuilder: QueryBuilder = {
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
                    then: vi.fn().mockImplementation((onfulfilled, onrejected) => {
                      return Promise.resolve({ data: existingJobRow, error: null }).then(onfulfilled, onrejected);
                    }),
                  };
                  return insertBuilder;
                }),
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
                then: vi.fn().mockImplementation((onfulfilled, onrejected) => {
                  // findExistingJob: first time returns null, second time returns existing
                  if (callCount <= 1) {
                    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
                  }
                  return Promise.resolve({ data: existingJobRow, error: null }).then(onfulfilled, onrejected);
                }),
              };
              return builder;
            }),
            rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
          };

          const queue = new PostgresJobQueue(db);

          // First enqueue — should insert
          const job1 = await queue.enqueue(jobType, payload, orgId);
          expect(job1.id).toBe(existingJobId);

          // Reset insert tracking
          insertCalled = false;

          // Second enqueue — should return existing, not insert
          const job2 = await queue.enqueue(jobType, payload, orgId);
          expect(job2.id).toBe(existingJobId);
          expect(insertCalled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects idempotent jobs that omit required payload fields before querying', async () => {
    const db = createMockDb({});
    const queue = new PostgresJobQueue(db);

    await expect(
      queue.enqueue(
        'send_outbound_message',
        { conversationId: 'conv-123', body: 'Hello' },
        'org-123',
      ),
    ).rejects.toThrow('aiDecisionId');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('scopes idempotency lookup to the organization and canonical payload keys', async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const containsCalls: Array<[string, Record<string, unknown>]> = [];
    const existingJobRow = {
      id: 'job-existing',
      organization_id: 'org-123',
      job_type: 'send_outbound_message',
      payload: { conversationId: 'conv-123', aiDecisionId: 'decision-123' },
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      last_error: null,
      run_after: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    };
    const db = createMockDb({
      fromSelectResult: { data: existingJobRow, error: null },
      onEq: (column, value) => eqCalls.push([column, value]),
      onContains: (column, value) => containsCalls.push([column, value]),
    });
    const queue = new PostgresJobQueue(db);

    const job = await queue.enqueue(
      'send_outbound_message',
      {
        conversationId: 'conv-123',
        aiDecisionId: 'decision-123',
        body: 'Hello',
      },
      'org-123',
    );

    expect(job.id).toBe('job-existing');
    expect(eqCalls).toContainEqual(['organization_id', 'org-123']);
    expect(containsCalls).toEqual([
      ['payload', { conversationId: 'conv-123', aiDecisionId: 'decision-123' }],
    ]);
  });

  it('propagates idempotency lookup errors instead of inserting a duplicate job', async () => {
    let insertCalled = false;
    const db = createMockDb({
      fromSelectResult: {
        data: null,
        error: { message: 'invalid input syntax for type json' },
      },
      onInsert: () => {
        insertCalled = true;
      },
    });
    const queue = new PostgresJobQueue(db);

    await expect(
      queue.enqueue(
        'send_outbound_message',
        {
          conversationId: 'conv-123',
          aiDecisionId: 'decision-123',
          body: 'Hello',
        },
        'org-123',
      ),
    ).rejects.toThrow(
      'Failed to check for existing send_outbound_message job: invalid input syntax for type json',
    );
    expect(insertCalled).toBe(false);
  });

  /**
   * Property 10: Job claim respects limit and pending status
   *
   * claim(N) returns at most N jobs, all previously pending.
   *
   * **Validates: Requirements 13.2**
   *
   * Feature: ai-customer-support, Property 10: Job claim respects limit and pending status
   */
  it('Property 10: claim(N) returns at most N jobs, all previously pending', async () => {
    await fc.assert(
      fc.asyncProperty(
        limitArb,
        pendingCountArb,
        orgIdArb,
        async (limit, pendingCount, orgId) => {
          // The RPC should return min(limit, pendingCount) jobs, all with status 'claimed'
          const returnedCount = Math.min(limit, pendingCount);

          const claimedJobs: Record<string, unknown>[] = [];
          for (let i = 0; i < returnedCount; i++) {
            claimedJobs.push({
              id: `job-${i}`,
              organization_id: orgId,
              job_type: 'process_ai_message',
              payload: { conversationId: `conv-${i}` },
              status: 'claimed', // RPC sets status to claimed
              attempts: 0,
              max_attempts: 5,
              last_error: null,
              run_after: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              completed_at: null,
            });
          }

          const db = createMockDb({
            rpcResult: { data: claimedJobs, error: null },
          });

          const queue = new PostgresJobQueue(db);
          const result = await queue.claim(limit);

          // Should return at most `limit` jobs
          expect(result.length).toBeLessThanOrEqual(limit);

          // Should return exactly min(limit, pendingCount) jobs
          expect(result.length).toBe(returnedCount);

          // All returned jobs should have status 'claimed'
          for (const job of result) {
            expect(job.status).toBe('claimed');
          }

          // Verify the RPC was called with the correct limit
          expect(db.rpc).toHaveBeenCalledWith('claim_support_jobs', {
            max_count: limit,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
