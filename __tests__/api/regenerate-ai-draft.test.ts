import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
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
  stateUpdateError: string | null,
  stateUpdateReject: string | null,
  insertedJobs: unknown[],
) {
  let operation: 'select' | 'insert' | 'update' = 'select';
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: mocks.update,
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.insert.mockImplementation((value: unknown) => {
    operation = 'insert';
    insertedJobs.push(value);
    return builder;
  });
  builder.update.mockImplementation(() => {
    operation = 'update';
    return builder;
  });
  builder.then.mockImplementation((onfulfilled, onrejected) => {
    if (operation === 'update' && stateUpdateReject) {
      return Promise.reject(new Error(stateUpdateReject)).then(onfulfilled, onrejected);
    }
    const result = operation === 'select' && table === 'conversations'
      ? { data: [{ organization_id: 'org-1' }], error: null }
      : operation === 'insert' && enqueueError
        ? { data: null, error: { message: enqueueError } }
        : operation === 'update' && stateUpdateError
          ? { data: null, error: { message: stateUpdateError } }
        : { data: null, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  });
  return builder;
}

describe('regenerate-ai-draft route', () => {
  const originalFunctionsUrl = process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
  const originalProcessJobsSecret = process.env.PROCESS_JOBS_SECRET;
  let enqueueError: string | null;
  let stateUpdateError: string | null;
  let stateUpdateReject: string | null;
  let insertedJobs: unknown[];

  beforeEach(() => {
    vi.clearAllMocks();
    enqueueError = null;
    stateUpdateError = null;
    stateUpdateReject = null;
    insertedJobs = [];
    mocks.from.mockImplementation((table: string) => (
      createBuilder(
        table,
        enqueueError,
        stateUpdateError,
        stateUpdateReject,
        insertedJobs,
      )
    ));
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
    expect(mocks.update).not.toHaveBeenCalled();
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
    expect(mocks.update).toHaveBeenCalledWith({ ai_state: 'thinking' });
  });

  it('returns an accepted warning when state display fails after enqueue', async () => {
    stateUpdateError = 'conversation update unavailable';
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
    stateUpdateReject = 'state update network failure';
    delete process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
    delete process.env.PROCESS_JOBS_SECRET;

    const response = await POST(makeRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: 'queued',
      warning: 'Draft regeneration was queued, but the thinking state could not be updated: state update network failure',
    });
  });
});
