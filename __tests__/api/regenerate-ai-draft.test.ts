import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  fetch: vi.fn(),
  rpc: vi.fn(),
  auditError: null as { message: string } | null,
  inserts: [] as Array<{ table: string; values: Array<Record<string, unknown>> }>,
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from, rpc: mocks.rpc } },
}));
vi.mock('@/app/api/functions/_auth', () => ({
  getUserFromToken: mocks.getUserFromToken,
  userHasOrgPermission: mocks.userHasOrgPermission,
}));

import { POST } from '../../app/api/functions/regenerate-ai-draft/route';

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/functions/regenerate-ai-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conversation-1' }),
  }) as NextRequest;
}

interface ConversationRow {
  organization_id: string;
  status: string;
  ai_state: string;
  latest_message_id: string | null;
  pending_ai_decision_id: string | null;
}

function createBuilder(table: string, conversation: ConversationRow) {
  const builder = {
    select: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.insert.mockImplementation((values: Array<Record<string, unknown>>) => {
    mocks.inserts.push({ table, values });
    return builder;
  });
  builder.then.mockImplementation((onfulfilled, onrejected) => (
    Promise.resolve(
      table === 'audit_logs'
        ? { data: null, error: mocks.auditError }
        : { data: [conversation], error: null },
    ).then(onfulfilled, onrejected)
  ));
  return builder;
}

describe('regenerate-ai-draft route', () => {
  const originalFunctionsUrl = process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
  const originalProcessJobsSecret = process.env.PROCESS_JOBS_SECRET;
  let conversation: ConversationRow;

  beforeEach(() => {
    vi.clearAllMocks();
    conversation = {
      organization_id: 'org-1',
      status: 'open',
      ai_state: 'drafted',
      latest_message_id: 'message-1',
      pending_ai_decision_id: 'decision-1',
    };
    mocks.auditError = null;
    mocks.inserts = [];
    mocks.from.mockImplementation((table: string) => createBuilder(table, conversation));
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFunctionsUrl === undefined) {
      delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    } else {
      process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL = originalFunctionsUrl;
    }
    if (originalProcessJobsSecret === undefined) {
      delete process.env.PROCESS_JOBS_SECRET;
    } else {
      process.env.PROCESS_JOBS_SECRET = originalProcessJobsSecret;
    }
    vi.unstubAllGlobals();
  });

  it('atomically claims the exact pending decision and enqueues its source turn', async () => {
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'queued' });
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_regenerate_ai_draft', {
      p_conversation_id: 'conversation-1',
      p_organization_id: 'org-1',
      p_source_message_id: 'message-1',
      p_pending_ai_decision_id: 'decision-1',
    });
    expect(mocks.inserts).toEqual([{
      table: 'audit_logs',
      values: [{
        organization_id: 'org-1',
        actor_id: 'user-1',
        actor_type: 'user',
        action: 'ai_draft_regenerated',
        resource_type: 'conversation',
        resource_id: 'conversation-1',
        metadata: {
          sourceMessageId: 'message-1',
          supersededDecisionId: 'decision-1',
        },
      }],
    }]);
  });

  it('surfaces an audit failure without reporting the durable job as failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.auditError = { message: 'audit unavailable' };
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    try {
      const response = await POST(makeRequest());

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        status: 'queued',
        warning: 'Draft regeneration was queued, but its audit log failed: audit unavailable',
      });
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith(
        'regenerate-ai-draft: failed to write audit log',
        'audit unavailable',
      );
    } finally {
      error.mockRestore();
    }
  });

  it('does not expose thinking or queue work when the transactional enqueue fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'job queue unavailable' },
    });
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'regenerate-ai-draft failed to enqueue job: job queue unavailable',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns a conflict when approval or a newer turn wins the atomic claim', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL = 'https://functions.example.test';
    process.env.PROCESS_JOBS_SECRET = 'worker-secret';

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Draft is already being processed or is no longer pending',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a stale route snapshot before attempting an enqueue', async () => {
    conversation.pending_ai_decision_id = null;

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a rejected transactional enqueue without triggering the worker', async () => {
    mocks.rpc.mockRejectedValue(new Error('database connection closed'));
    process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL = 'https://functions.example.test';
    process.env.PROCESS_JOBS_SECRET = 'worker-secret';

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'database connection closed',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns once the durable job is queued even when the direct trigger times out', async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL = 'https://functions.example.test';
    process.env.PROCESS_JOBS_SECRET = 'worker-secret';
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => (
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })
    ));

    const responsePromise = POST(makeRequest());
    await vi.advanceTimersByTimeAsync(1_500);
    const response = await responsePromise;

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'queued' });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://functions.example.test/process-jobs',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Process-Jobs-Secret': 'worker-secret',
        },
      }),
    );
  });
});
