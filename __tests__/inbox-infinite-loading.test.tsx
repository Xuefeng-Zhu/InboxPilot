/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from '../components/inbox/ConversationList';
import { MessageThread } from '../components/inbox/MessageThread';

const mocks = vi.hoisted(() => ({
  useOrgMembership: vi.fn(),
  useInfiniteConversations: vi.fn(),
  useConversation: vi.fn(),
  useInfiniteMessages: vi.fn(),
  useAiDecision: vi.fn(),
  useRealtime: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries', () => ({
  CONVERSATION_PAGE_SIZE: 25,
  MESSAGE_PAGE_SIZE: 50,
  queryKeys: {
    messages: (conversationId: string) => ['messages', conversationId],
    messagesInfinite: (conversationId: string, pageSize: number) => ['messages', 'infinite', conversationId, pageSize],
    conversation: (conversationId: string) => ['conversation', conversationId],
    conversationsInfinite: (orgId: string, filters: Record<string, unknown>, pageSize: number) =>
      ['conversations', 'infinite', orgId, filters, pageSize],
    aiDecision: (conversationId: string) => ['ai-decision', conversationId],
  },
  useOrgMembership: mocks.useOrgMembership,
  useInfiniteConversations: mocks.useInfiniteConversations,
  useConversation: mocks.useConversation,
  useInfiniteMessages: mocks.useInfiniteMessages,
  useAiDecision: mocks.useAiDecision,
}));

vi.mock('@/lib/use-realtime', () => ({
  useRealtime: mocks.useRealtime,
}));

type MockObserverEntry = { isIntersecting: boolean };

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  observe = vi.fn();
  disconnect = vi.fn();

  constructor(
    private callback: (entries: MockObserverEntry[]) => void,
    public options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  intersect(isIntersecting = true) {
    this.callback([{ isIntersecting }]);
  }
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );

  return {
    ...result,
    rerenderWithQueryClient: (nextUi: React.ReactElement) =>
      result.rerender(
        <QueryClientProvider client={queryClient}>
          {nextUi}
        </QueryClientProvider>,
      ),
  };
}

function setScrollMetrics(element: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight,
  });
}

const conversationRow = {
  id: 'conversation-1',
  organization_id: 'org-1',
  contact_id: 'contact-1',
  channel: 'webchat',
  status: 'open',
  ai_state: 'idle',
  subject: null,
  assigned_to: null,
  last_message_at: '2026-06-13T10:00:00.000Z',
  metadata: {},
  created_at: '2026-06-13T10:00:00.000Z',
  updated_at: '2026-06-13T10:00:00.000Z',
  contacts: {
    id: 'contact-1',
    organization_id: 'org-1',
    name: null,
    email: null,
    phone: null,
    metadata: {},
    created_at: '2026-06-13T10:00:00.000Z',
    updated_at: '2026-06-13T10:00:00.000Z',
  },
  latest_message: {
    conversation_id: 'conversation-1',
    body: 'Hello',
    subject: null,
    created_at: '2026-06-13T10:00:00.000Z',
  },
};

function messageRow(id: string, createdAt: string, body = id) {
  return {
    id,
    conversation_id: 'conversation-1',
    sender_type: 'contact',
    sender_id: null,
    direction: 'inbound',
    channel: 'webchat',
    body,
    subject: null,
    raw_payload: {},
    provider: 'webchat',
    provider_account_id: null,
    external_message_id: null,
    delivery_status: 'delivered',
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe('Inbox infinite loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mocks.useOrgMembership.mockReturnValue({ data: 'org-1', isLoading: false });
    mocks.useAiDecision.mockReturnValue({ data: null, isLoading: false });
  });

  it('loads older conversations when the bottom sentinel intersects', async () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    mocks.useInfiniteConversations.mockReturnValue({
      items: [conversationRow],
      isInitialLoading: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: true,
      fetchNextPage,
      error: null,
    });

    renderWithQueryClient(
      <ConversationList
        selectedId={null}
        onSelect={vi.fn()}
        statusFilter="all"
        channelFilter="all"
        searchQuery=""
      />,
    );

    await act(async () => {
      MockIntersectionObserver.instances[0].intersect();
    });

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('renders initial, page-loading, page-error, and empty conversation states', () => {
    mocks.useInfiniteConversations.mockReturnValueOnce({
      items: [],
      isInitialLoading: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    });

    const { rerenderWithQueryClient } = renderWithQueryClient(
      <ConversationList selectedId={null} onSelect={vi.fn()} statusFilter="all" channelFilter="all" searchQuery="" />,
    );
    expect(screen.getByText('Loading conversations…')).toBeTruthy();

    mocks.useInfiniteConversations.mockReturnValueOnce({
      items: [conversationRow],
      isInitialLoading: false,
      isFetchingNextPage: true,
      isFetchNextPageError: false,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      error: null,
    });
    rerenderWithQueryClient(<ConversationList selectedId={null} onSelect={vi.fn()} statusFilter="all" channelFilter="all" searchQuery="" />);
    expect(screen.getByText('Loading more…')).toBeTruthy();

    mocks.useInfiniteConversations.mockReturnValueOnce({
      items: [conversationRow],
      isInitialLoading: false,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      error: new Error('Page failed'),
    });
    rerenderWithQueryClient(<ConversationList selectedId={null} onSelect={vi.fn()} statusFilter="all" channelFilter="all" searchQuery="" />);
    expect(screen.getByRole('alert').textContent).toContain('Page failed');

    mocks.useInfiniteConversations.mockReturnValueOnce({
      items: [],
      isInitialLoading: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    });
    rerenderWithQueryClient(<ConversationList selectedId={null} onSelect={vi.fn()} statusFilter="all" channelFilter="all" searchQuery="" />);
    expect(screen.getByText('No conversations found.')).toBeTruthy();
  });

  it('loads older messages at the top and preserves scroll position', async () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    let messageItems = [
      messageRow('newer-1', '2026-06-13T10:01:00.000Z', 'newer one'),
      messageRow('newer-2', '2026-06-13T10:02:00.000Z', 'newer two'),
    ];

    mocks.useConversation.mockReturnValue({
      data: conversationRow,
      isLoading: false,
      error: null,
    });
    mocks.useInfiniteMessages.mockImplementation(() => ({
      items: messageItems,
      isInitialLoading: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: true,
      fetchNextPage,
      error: null,
    }));

    const { rerenderWithQueryClient } = renderWithQueryClient(<MessageThread conversationId="conversation-1" />);
    const scrollRoot = screen.getByRole('log');
    setScrollMetrics(scrollRoot, { scrollHeight: 1000, clientHeight: 400 });
    scrollRoot.scrollTop = 20;
    fireEvent.scroll(scrollRoot);

    const messageObserver = MockIntersectionObserver.instances.find(
      (observer) => observer.options?.root === scrollRoot,
    );
    expect(messageObserver).toBeDefined();

    await act(async () => {
      messageObserver!.intersect();
    });

    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    messageItems = [
      messageRow('older-1', '2026-06-13T09:59:00.000Z', 'older one'),
      ...messageItems,
    ];
    setScrollMetrics(scrollRoot, { scrollHeight: 1200, clientHeight: 400 });
    rerenderWithQueryClient(<MessageThread conversationId="conversation-1" />);

    await waitFor(() => expect(scrollRoot.scrollTop).toBe(220));
  });

  it('renders message loading and page-error states', () => {
    mocks.useConversation.mockReturnValue({
      data: conversationRow,
      isLoading: false,
      error: null,
    });
    mocks.useInfiniteMessages.mockReturnValueOnce({
      items: [],
      isInitialLoading: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    });

    const { rerenderWithQueryClient } = renderWithQueryClient(<MessageThread conversationId="conversation-1" />);
    expect(screen.getByText('Loading messages…')).toBeTruthy();

    mocks.useInfiniteMessages.mockReturnValueOnce({
      items: [messageRow('newer', '2026-06-13T10:02:00.000Z')],
      isInitialLoading: false,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      error: new Error('Older messages failed'),
    });
    rerenderWithQueryClient(<MessageThread conversationId="conversation-1" />);

    expect(screen.getByRole('alert').textContent).toContain('Older messages failed');
  });

  it('keeps a recovery path when a mobile deep link points to a missing conversation', () => {
    const onBack = vi.fn();
    mocks.useConversation.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    mocks.useInfiniteMessages.mockReturnValue({
      items: [],
      isInitialLoading: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    });

    renderWithQueryClient(
      <MessageThread conversationId="missing-conversation" onBack={onBack} />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Conversation not found.');
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('keeps the mobile recovery path available while a deep link is loading', () => {
    const onBack = vi.fn();
    mocks.useConversation.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });
    mocks.useInfiniteMessages.mockReturnValue({
      items: [],
      isInitialLoading: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    });

    renderWithQueryClient(
      <MessageThread conversationId="slow-conversation" onBack={onBack} />,
    );

    expect(screen.getByText('Loading messages…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
