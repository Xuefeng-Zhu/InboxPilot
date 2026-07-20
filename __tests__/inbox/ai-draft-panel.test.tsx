/**
 * @vitest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDraftPanel } from '@/components/inbox/AiDraftPanel';
import { queryKeys } from '@/lib/queries/keys';

const mocks = vi.hoisted(() => ({
  latestDecision: {
    id: 'decision-1',
    conversation_id: 'conversation-1',
    organization_id: 'org-1',
    message_id: 'message-1',
    decision_type: 'respond',
    confidence: 0.91,
    reasoning_summary: 'First reasoning',
    response_text: 'First generated draft',
    tags: [],
    requires_human: false,
    raw_response: null,
    created_at: '2026-07-20T12:00:00.000Z',
  },
  fetch: vi.fn(),
  queryResponsePromise: null as Promise<{
    data: Array<Record<string, unknown>>;
    error: null;
  }> | null,
  queryDecisionQueue: [] as Array<Record<string, unknown>>,
  queryErrorQueue: [] as Array<{ message: string } | null>,
  queryCallCount: 0,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/insforge', () => {
  const createBuilder = () => {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      then: vi.fn(),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    builder.then.mockImplementation((onfulfilled, onrejected) => {
      mocks.queryCallCount += 1;
      const queuedDecision = mocks.queryDecisionQueue.shift();
      const queuedError = mocks.queryErrorQueue.shift() ?? null;
      return (mocks.queryResponsePromise ??
        Promise.resolve({
          data: [queuedDecision ?? mocks.latestDecision],
          error: queuedError,
        })).then(onfulfilled, onrejected);
    });
    return builder;
  };

  return {
    getAccessToken: () => 'test-token',
    insforge: {
      database: {
        from: vi.fn(() => createBuilder()),
      },
    },
  };
});

function renderPanel(onPrefillComposer = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AiDraftPanel
        conversationId="conversation-1"
        aiState="drafted"
        onPrefillComposer={onPrefillComposer}
      />
    </QueryClientProvider>,
  );
  return { ...view, client, onPrefillComposer };
}

describe('AiDraftPanel regeneration', () => {
  beforeEach(() => {
    mocks.latestDecision = {
      id: 'decision-1',
      conversation_id: 'conversation-1',
      organization_id: 'org-1',
      message_id: 'message-1',
      decision_type: 'respond',
      confidence: 0.91,
      reasoning_summary: 'First reasoning',
      response_text: 'First generated draft',
      tags: [],
      requires_human: false,
      raw_response: null,
      created_at: '2026-07-20T12:00:00.000Z',
    };
    mocks.queryResponsePromise = null;
    mocks.queryDecisionQueue = [];
    mocks.queryErrorQueue = [];
    mocks.queryCallCount = 0;
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({ status: 'queued' }),
    } as unknown as Response);
    global.fetch = mocks.fetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears D1, then displays and prefills regenerated D2 without an aiState transition', async () => {
    const { client, onPrefillComposer } = renderPanel();

    expect(await screen.findByText('First generated draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI draft' }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText('First generated draft')).toBeNull());
    expect(
      screen.getByRole('status', { name: 'Regenerating AI draft' }),
    ).toBeTruthy();

    mocks.latestDecision = {
      ...mocks.latestDecision,
      id: 'decision-2',
      response_text: 'Second regenerated draft',
      created_at: '2026-07-20T12:02:00.000Z',
    };
    await act(async () => {
      await client.invalidateQueries({
        queryKey: queryKeys.aiDecision('conversation-1'),
      });
    });

    expect(await screen.findByText('Second regenerated draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fill composer with AI draft' }));
    expect(onPrefillComposer).toHaveBeenCalledWith('Second regenerated draft');
    expect(onPrefillComposer).not.toHaveBeenCalledWith('First generated draft');
  });

  it('preserves D2 when realtime wins the race with the regeneration response', async () => {
    let resolveRegeneration!: (response: Response) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRegeneration = resolve;
      }),
    );
    const { client, onPrefillComposer } = renderPanel();

    expect(await screen.findByText('First generated draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI draft' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());

    const regeneratedDecision = {
      ...mocks.latestDecision,
      id: 'decision-2',
      response_text: 'Second draft arrived first',
      created_at: '2026-07-20T12:02:00.000Z',
    };
    act(() => {
      client.setQueryData(
        queryKeys.aiDecision('conversation-1'),
        regeneratedDecision,
      );
    });
    expect(await screen.findByText('Second draft arrived first')).toBeTruthy();

    mocks.queryResponsePromise = new Promise(() => undefined);
    await act(async () => {
      resolveRegeneration({
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ status: 'queued' }),
      } as unknown as Response);
    });

    await waitFor(() => {
      expect(screen.getByText('Second draft arrived first')).toBeTruthy();
      expect(screen.queryByText('First generated draft')).toBeNull();
    });
    expect(client.getQueryData(queryKeys.aiDecision('conversation-1'))).toEqual(
      regeneratedDecision,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fill composer with AI draft' }));
    expect(onPrefillComposer).toHaveBeenCalledWith('Second draft arrived first');
  });

  it('polls after a lost completion event and cleans up once D2 arrives', async () => {
    renderPanel();
    expect(await screen.findByText('First generated draft')).toBeTruthy();

    const regeneratedDecision = {
      ...mocks.latestDecision,
      id: 'decision-2',
      response_text: 'Second draft recovered by polling',
      created_at: '2026-07-20T12:02:00.000Z',
    };
    mocks.queryDecisionQueue = [mocks.latestDecision, regeneratedDecision];
    const callsBeforeRegeneration = mocks.queryCallCount;
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI draft' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.queryCallCount).toBe(callsBeforeRegeneration + 1);
    expect(screen.queryByText('First generated draft')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Regenerating AI draft' }),
    ).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(mocks.queryCallCount).toBe(callsBeforeRegeneration + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.queryCallCount).toBe(callsBeforeRegeneration + 2);
    expect(screen.getByText('Second draft recovered by polling')).toBeTruthy();
    const callsAfterRecovery = mocks.queryCallCount;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.queryCallCount).toBe(callsAfterRecovery);
  });

  it('stops polling and replaces the spinner when a recovery refetch fails', async () => {
    renderPanel();
    expect(await screen.findByText('First generated draft')).toBeTruthy();

    mocks.queryDecisionQueue = [mocks.latestDecision, mocks.latestDecision];
    mocks.queryErrorQueue = [null, { message: 'decision lookup unavailable' }];
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI draft' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(
      screen.getByRole('alert', { name: 'AI draft regeneration failed' }),
    ).toHaveTextContent(
      'Could not refresh the regenerated draft: decision lookup unavailable',
    );
    const callsAfterError = mocks.queryCallCount;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.queryCallCount).toBe(callsAfterError);
  });

  it('times out bounded polling instead of leaving the spinner indefinitely', async () => {
    renderPanel();
    expect(await screen.findByText('First generated draft')).toBeTruthy();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI draft' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(
      screen.getByRole('alert', { name: 'AI draft regeneration failed' }),
    ).toHaveTextContent(
      'The regenerated draft is taking longer than expected.',
    );
    const callsAfterTimeout = mocks.queryCallCount;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.queryCallCount).toBe(callsAfterTimeout);
  });
});
