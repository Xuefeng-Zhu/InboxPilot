/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  invalidateConversationMutationCaches: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/insforge', () => ({
  getAccessToken: mocks.getAccessToken,
}));

vi.mock('@/lib/queries', () => ({
  invalidateConversationMutationCaches: mocks.invalidateConversationMutationCaches,
}));

import { ConversationActions } from '../../components/inbox/ConversationActions';

function renderActions(status: 'open' | 'escalated' | 'resolved' = 'open') {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationActions conversationId="conversation-1" status={status} />
    </QueryClientProvider>,
  );
}

describe('ConversationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockReturnValue('access-token');
    mocks.invalidateConversationMutationCaches.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('shows only valid actions for each conversation status', () => {
    const view = renderActions('open');
    expect(screen.getByRole('button', { name: 'Escalate conversation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolve conversation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen conversation' })).toBeNull();

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ConversationActions conversationId="conversation-1" status="resolved" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Reopen conversation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resolve conversation' })).toBeNull();
  });

  it('calls the authenticated action endpoint and refreshes derived views', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Escalate conversation' }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/functions/escalate-conversation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer access-token',
        },
        body: JSON.stringify({ conversationId: 'conversation-1' }),
      },
    ));
    await waitFor(() => expect(mocks.invalidateConversationMutationCaches).toHaveBeenCalledWith(
      expect.any(QueryClient),
      'conversation-1',
    ));
  });

  it('surfaces accepted warnings and request failures', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      status: 'accepted',
      warning: 'Conversation changed, but auditing is delayed.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve conversation' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Conversation changed, but auditing is delayed.',
    );

    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Escalate conversation' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Forbidden');
  });
});
