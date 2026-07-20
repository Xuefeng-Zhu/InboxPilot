/**
 * @vitest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SymphonyView } from '../../app/symphony/_components/SymphonyView';

const mocks = vi.hoisted(() => ({
  conversations: [
    {
      id: 'conv-1',
      contacts: { name: 'Maya Chen' },
      channel: 'sms',
      last_message_at: '2026-07-20T12:00:00.000Z',
      latest_message: { body: 'Where is my order?' },
      ai_state: 'drafted',
      status: 'open',
    },
  ],
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/queries', async () => {
  const invalidation = await vi.importActual<
    typeof import('@/lib/queries/invalidation')
  >('@/lib/queries/invalidation');
  return {
    ...invalidation,
    useOrgMembership: () => ({ data: 'org-1' }),
    useMessages: () => ({
      data: [
        {
          id: 'message-1',
          sender_type: 'contact',
          body: 'Where is my order?',
          created_at: '2026-07-20T12:00:00.000Z',
        },
      ],
    }),
    useAiDecision: () => ({
      data: {
        id: 'decision-1',
        response_text: 'Your order is on the way.',
        confidence: 0.9,
        created_at: '2026-07-20T12:01:00.000Z',
      },
    }),
  };
});

vi.mock('@/lib/queries/hooks/useSymphony', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/queries/hooks/useSymphony')
  >('@/lib/queries/hooks/useSymphony');
  return {
    ...actual,
    useSymphonyConversations: () => ({ data: mocks.conversations }),
    useSymphonyCounts: () => ({
      data: { stream: mocks.conversations.length, drafting: 1, escalated: 0 },
    }),
  };
});

vi.mock('@/lib/use-realtime', () => ({
  useRealtime: () => undefined,
}));

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/insforge', () => ({
  getAccessToken: () => 'test-token',
}));

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SymphonyView initialZoom="week" />
    </QueryClientProvider>,
  );
}

describe('SymphonyView accepted warning', () => {
  beforeEach(() => {
    mocks.conversations = [
      {
        id: 'conv-1',
        contacts: { name: 'Maya Chen' },
        channel: 'sms',
        last_message_at: '2026-07-20T12:00:00.000Z',
        latest_message: { body: 'Where is my order?' },
        ai_state: 'drafted',
        status: 'open',
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        status: 'accepted',
        warning: 'Provider outcome is unknown; retry was suppressed.',
        data: { message: null },
      }),
      text: async () => '',
    } as unknown as Response) as unknown as typeof fetch;
  });

  it('keeps the warning dismissible after the approved card leaves the query window', async () => {
    const view = renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve & send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Provider outcome is unknown; retry was suppressed.',
    );

    mocks.conversations = [];
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SymphonyView initialZoom="week" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId('river-card-conv-1')).toBeNull());
    expect(screen.getByTestId('river-empty')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Provider outcome is unknown; retry was suppressed.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss approval warning' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
