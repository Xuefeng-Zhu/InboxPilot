import { describe, expect, it, vi } from 'vitest';
import { AiDecisionRepository } from '../../src/repositories/ai-decision-repository.js';
import type { DatabaseClient, QueryBuilder } from '../../src/interfaces/database-client.js';

describe('AiDecisionRepository', () => {
  it('atomically finalizes a source turn through the database RPC', async () => {
    const row = {
      id: 'decision-1',
      conversation_id: 'conversation-1',
      organization_id: 'org-1',
      source_job_id: 'job-1',
      message_id: 'message-1',
      decision_type: 'respond',
      confidence: 0.9,
      reasoning_summary: 'reason',
      response_text: 'Hello',
      tags: ['answer'],
      requires_human: false,
      raw_response: { model: 'test' },
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const db: DatabaseClient = {
      from: vi.fn(),
      rpc,
    };
    const repository = new AiDecisionRepository(db);

    const result = await repository.finalizeTurn({
      conversationId: 'conversation-1',
      organizationId: 'org-1',
      sourceJobId: 'job-1',
      messageId: 'message-1',
      decisionType: 'respond',
      confidence: 0.9,
      reasoningSummary: 'reason',
      responseText: 'Hello',
      tags: ['answer'],
      requiresHuman: false,
      rawResponse: { model: 'test' },
    }, {
      sourceMessageId: 'message-1',
      aiState: 'drafted',
      expected: { aiState: 'thinking', status: 'open' },
    });

    expect(rpc).toHaveBeenCalledWith('finalize_ai_turn_with_decision', {
      p_conversation_id: 'conversation-1',
      p_organization_id: 'org-1',
      p_source_message_id: 'message-1',
      p_source_job_id: 'job-1',
      p_message_id: 'message-1',
      p_decision_type: 'respond',
      p_confidence: 0.9,
      p_reasoning_summary: 'reason',
      p_response_text: 'Hello',
      p_tags: ['answer'],
      p_requires_human: false,
      p_raw_response: { model: 'test' },
      p_ai_state: 'drafted',
      p_status: null,
      p_expected_ai_state: 'thinking',
      p_expected_status: 'open',
    });
    expect(result).toMatchObject({
      id: 'decision-1',
      sourceJobId: 'job-1',
      messageId: 'message-1',
      responseText: 'Hello',
    });
  });

  it('returns null when the source-turn guard loses without persisting', async () => {
    const db: DatabaseClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const repository = new AiDecisionRepository(db);

    await expect(repository.finalizeTurn({
      conversationId: 'conversation-1',
      organizationId: 'org-1',
      messageId: 'message-1',
      decisionType: 'respond',
      confidence: 0.9,
      requiresHuman: false,
    }, {
      sourceMessageId: 'message-1',
      aiState: 'drafted',
      expected: { aiState: 'thinking', status: 'open' },
    })).resolves.toBeNull();
  });

  it('surfaces atomic finalization failures with repository context', async () => {
    const db: DatabaseClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'decision insert failed' },
      }),
    };
    const repository = new AiDecisionRepository(db);

    await expect(repository.finalizeTurn({
      conversationId: 'conversation-1',
      organizationId: 'org-1',
      decisionType: 'respond',
      confidence: 0.9,
      requiresHuman: false,
    }, {
      aiState: 'failed',
    })).rejects.toThrow(
      'AiDecisionRepository.finalizeTurn failed: decision insert failed',
    );
  });

  it('merges metadata without erasing the model response or retry markers', async () => {
    const existingRaw = {
      decision_type: 'respond',
      response_text: 'Hello',
      _groundingChunkIds: ['chunk-1'],
      _shouldAutoSend: true,
    };
    let operation: 'read' | 'update' = 'read';
    let capturedUpdate: Record<string, unknown> = {};
    const builder: QueryBuilder = {
      select: vi.fn(() => builder),
      insert: vi.fn(() => builder),
      update: vi.fn((values: Record<string, unknown>) => {
        operation = 'update';
        capturedUpdate = values;
        return builder;
      }),
      delete: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      neq: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lt: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      like: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      is: vi.fn(() => builder),
      in: vi.fn(() => builder),
      contains: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      range: vi.fn(() => builder),
      single: vi.fn(() => builder),
      maybeSingle: vi.fn(() => builder),
      then: vi.fn((onfulfilled, onrejected) => {
        const data = operation === 'read'
          ? { raw_response: existingRaw }
          : {
              id: 'decision-1',
              conversation_id: 'conversation-1',
              organization_id: 'org-1',
              source_job_id: 'job-1',
              message_id: 'message-1',
              decision_type: 'respond',
              confidence: 0.9,
              reasoning_summary: 'reason',
              response_text: 'Hello',
              tags: [],
              requires_human: false,
              raw_response: capturedUpdate.raw_response,
              created_at: '2026-01-01T00:00:00.000Z',
            };
        return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
      }),
    };
    const db: DatabaseClient = {
      from: vi.fn(() => {
        operation = 'read';
        return builder;
      }),
      rpc: vi.fn(),
    };
    const repository = new AiDecisionRepository(db);

    const result = await repository.update('decision-1', {
      metadata: { autoSent: true, sentAt: '2026-01-02T00:00:00.000Z' },
    });

    expect(capturedUpdate.raw_response).toEqual({
      ...existingRaw,
      autoSent: true,
      sentAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.rawResponse).toEqual(capturedUpdate.raw_response);
  });
});
