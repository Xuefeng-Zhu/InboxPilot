/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InboxPage from '@/app/inbox/page';
import { ReplyComposer } from '@/components/inbox/ReplyComposer';

const navigation = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  );
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: { total: 0, escalated: 0, drafted: 0 } })),
  };
});

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries', () => ({
  useOrgMembership: () => ({ data: 'org-1', isLoading: false }),
  queryKeys: {
    inboxSublineCounts: (orgId: string) => ['inbox-subline-counts', orgId],
  },
}));

vi.mock('@/lib/insforge', () => ({
  getAccessToken: vi.fn(() => null),
  insforge: { database: {} },
}));

vi.mock('@/components/layout', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/inbox/InboxFilters', () => ({
  InboxFilters: () => <div>Inbox filters</div>,
}));

vi.mock('@/components/inbox/ConversationList', () => ({
  ConversationList: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('conversation-list-choice')}>
      Open conversation
    </button>
  ),
}));

vi.mock('@/components/inbox/MessageThread', () => ({
  MessageThread: ({
    conversationId,
    onBack,
  }: {
    conversationId: string;
    onBack?: () => void;
  }) => (
    <section>
      <p data-testid="thread-id">{conversationId}</p>
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back to conversations">
          Back
        </button>
      )}
    </section>
  ),
}));

vi.mock('@/components/inbox/RightPanel', () => ({
  RightPanel: () => <aside>Contact details</aside>,
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('inbox navigation and draft isolation', () => {
  beforeEach(() => {
    navigation.search = '';
    navigation.replace.mockReset();
  });

  it('opens the conversation from the URL and provides a working narrow-layout back path', async () => {
    navigation.search = 'conversation=conversation-from-url';
    renderWithClient(<InboxPage />);

    expect(screen.getByTestId('thread-id').textContent).toBe('conversation-from-url');
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));

    await waitFor(() => {
      expect(screen.queryByTestId('thread-id')).toBeNull();
      expect(screen.getByRole('button', { name: 'Open conversation' })).toBeTruthy();
    });
    expect(navigation.replace).toHaveBeenCalledWith('/inbox', { scroll: false });
  });

  it('synchronizes the selected thread when the conversation query parameter changes', async () => {
    const view = renderWithClient(<InboxPage />);
    expect(screen.queryByTestId('thread-id')).toBeNull();

    navigation.search = 'conversation=conversation-later';
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <InboxPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('thread-id').textContent).toBe('conversation-later');
    });
  });

  it('clears an unsent reply when the selected conversation changes', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ReplyComposer conversationId="conversation-a" />
      </QueryClientProvider>,
    );

    const composer = screen.getByRole('textbox', { name: 'Reply message' });
    fireEvent.change(composer, { target: { value: 'Private draft for customer A' } });
    expect((composer as HTMLTextAreaElement).value).toBe('Private draft for customer A');

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ReplyComposer conversationId="conversation-b" />
      </QueryClientProvider>,
    );

    expect((screen.getByRole('textbox', { name: 'Reply message' }) as HTMLTextAreaElement).value).toBe('');
  });
});
