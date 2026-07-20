import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  fetch: vi.fn(),
  rpc: vi.fn(),
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

function createBuilder(
  table: string,
  enqueueError: string | null,
  insertedJobs: unknown[],
) {
  let operation: 'select' | 'insert' = 'select';
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.insert.mockImplementation((value: unknown) => {
    operation = 'insert';
    insertedJobs.push(value);
    return builder;
  });
  builder.then.mockImplementation((onfulfilled, onrejected) => {
    const result = operation === 'select' && table === 'conversations'
      ? { data: [{ organization_id: 'org-1' }], error: null }
      : operation === 'select' && table === 'messages'
        ? { data: [{ id: 'message-1' }], error: null }
      : operation === 'insert' && enqueueError
        ? { data: null, error: { message: enqueueError } }
        : { data: null, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  });
  return builder;
}

describe('regenerate-ai-draft route', () => {
  const originalFunctionsUrl = process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
  const originalProcessJobsSecret = process.env.PROCESS_JOBS_SECRET;
  let enqueueError: string | null;
  let insertedJobs: unknown[];

  beforeEach(() => {
    vi.clearAllMocks();
    enqueueError = null;
    insertedJobs = [];
    mocks.from.mockImplementation((table: string) => (
      createBuilder(
        table,
        enqueueError,
        insertedJobs,
      )
    ));
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

  it('does not change conversation state before the durable job insert succeeds', async () => {
    enqueueError = 'job queue unavailable';
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'regenerate-ai-draft failed to enqueue job: job queue unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
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
    expect(insertedJobs).toHaveLength(1);
    expect(insertedJobs[0]).toEqual([
      expect.objectContaining({
        payload: {
          conversationId: 'conversation-1',
          messageId: 'message-1',
        },
      }),
    ]);
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
    expect(mocks.rpc).toHaveBeenCalledWith('transition_ai_source_turn', {
      p_conversation_id: 'conversation-1',
      p_organization_id: 'org-1',
      p_source_message_id: 'message-1',
      p_ai_state: 'thinking',
      p_status: null,
      p_expected_ai_state: null,
      p_expected_status: 'open',
    });
  });

  it('returns an accepted warning when state display fails after enqueue', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'conversation update unavailable' },
    });
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: 'queued',
      warning: 'Draft regeneration was queued, but the thinking state could not be updated: conversation update unavailable',
    });
    expect(insertedJobs).toHaveLength(1);
  });

  it('returns an accepted warning when the state update promise rejects', async () => {
    mocks.rpc.mockRejectedValue(new Error('state update network failure'));
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: 'queued',
      warning: 'Draft regeneration was queued, but the thinking state could not be updated: state update network failure',
    });
  });

  it('does not overwrite a newer turn with a stale thinking state', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: 'queued',
      warning: 'Draft regeneration was queued, but a newer conversation turn superseded it',
    });
  });
});
