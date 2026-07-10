/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKanbanLane } from '@/lib/queries/hooks/useKanbanLane';

const mocks = vi.hoisted(() => ({
  rangeCalls: [] as Array<[number, number]>,
  messageLookups: [] as string[][],
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/helpers')>(
    '@/lib/queries/helpers',
  );
  return {
    ...actual,
    useAuthReady: () => true,
  };
});

vi.mock('@/lib/insforge', () => {
  const conversations = Array.from({ length: 30 }, (_, index) => ({
    id: `conversation-${index + 1}`,
    organization_id: 'org-1',
    contact_id: `contact-${index + 1}`,
    channel: 'webchat',
    status: 'open',
    ai_state: 'idle',
    subject: null,
    assigned_to: null,
    last_message_at: `2026-07-10T10:${String(index).padStart(2, '0')}:00.000Z`,
    last_message_direction: null,
    created_at: '2026-07-10T09:00:00.000Z',
    contacts: null,
  }));

  function makeBuilder(table: string) {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
      in: vi.fn(),
    };

    builder.select.mockImplementation(() => builder);
    builder.eq.mockImplementation(() => builder);
    builder.neq.mockImplementation(() => builder);
    builder.order.mockImplementation(() => {
      if (table === 'messages') {
        return Promise.resolve({ data: [], error: null });
      }
      return builder;
    });
    builder.range.mockImplementation((start: number, end: number) => {
      mocks.rangeCalls.push([start, end]);
      return Promise.resolve({
        data: conversations.slice(start, end + 1),
        error: null,
      });
    });
    builder.in.mockImplementation((_column: string, values: string[]) => {
      mocks.messageLookups.push(values);
      return builder;
    });
    return builder;
  }

  return {
    insforge: {
      database: {
        from: vi.fn((table: string) => makeBuilder(table)),
      },
    },
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useKanbanLane completeness', () => {
  beforeEach(() => {
    mocks.rangeCalls.length = 0;
    mocks.messageLookups.length = 0;
    vi.clearAllMocks();
  });

  it('loads every active-conversation page instead of truncating at the first 25 rows', async () => {
    const { result } = renderHook(
      () => useKanbanLane('org-1', 'user-1', 'unassigned', 25),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(30));

    expect(mocks.rangeCalls).toEqual([
      [0, 24],
      [25, 49],
    ]);
    expect(mocks.messageLookups).toHaveLength(1);
    expect(mocks.messageLookups[0]).toHaveLength(30);
    expect(result.current.items.at(-1)?.id).toBe('conversation-30');
  });
});
