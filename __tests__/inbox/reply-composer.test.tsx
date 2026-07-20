/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyComposer } from '@/components/inbox/ReplyComposer';
import { queryKeys } from '@/lib/queries/keys';

vi.mock('@/lib/insforge', () => ({
  getAccessToken: () => 'test-access-token',
}));

function renderComposer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ReplyComposer conversationId="conversation-1" />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('ReplyComposer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces an accepted-reply warning returned with HTTP 202', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        status: 'accepted',
        warning: 'Provider outcome is unknown; retry was suppressed.',
        data: null,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      },
    )));
    renderComposer();

    const composer = screen.getByRole('textbox', { name: 'Reply message' });
    fireEvent.change(composer, { target: { value: 'Please confirm receipt.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Provider outcome is unknown; retry was suppressed.',
    );
    await waitFor(() => {
      expect((composer as HTMLTextAreaElement).value).toBe('');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reply warning' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not show a warning for an ordinary successful reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', data: { id: 'message-1' } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )));
    const { queryClient } = renderComposer();
    const listKey = queryKeys.conversationsInfinite('org-1');
    const countKey = queryKeys.symphonyCounts('org-1', 'day:0');
    queryClient.setQueryData(listKey, [{ id: 'conversation-1' }]);
    queryClient.setQueryData(countKey, { drafting: 1 });

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply message' }), {
      target: { value: 'Ordinary reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send reply' }).textContent).toBe('Send');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true);
  });
});
