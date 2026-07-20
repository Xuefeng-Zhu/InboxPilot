/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    builder.then.mockImplementation((onfulfilled, onrejected) =>
      (mocks.queryResponsePromise ??
        Promise.resolve({ data: [mocks.latestDecision], error: null })).then(
        onfulfilled,
        onrejected,
      ),
    );
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
    defaultOptions: { queries: { retry: false } },
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
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({ status: 'queued' }),
    } as unknown as Response);
    global.fetch = mocks.fetch as unknown as typeof fetch;
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
});
