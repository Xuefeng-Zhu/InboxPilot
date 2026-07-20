/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiDecision } from '@/lib/queries/hooks/useAiDecision';

const mocks = vi.hoisted(() => ({
  orderCalls: [] as Array<[
    string,
    { ascending: boolean },
  ]>,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/insforge', () => {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockImplementation(
    (column: string, options: { ascending: boolean }) => {
      mocks.orderCalls.push([column, options]);
      return builder;
    },
  );
  builder.limit.mockReturnValue(builder);
  builder.then.mockImplementation((onfulfilled, onrejected) =>
    Promise.resolve({
      data: [
        {
          id: 'decision-2',
          conversation_id: 'conversation-1',
          created_at: '2026-07-20T12:00:00.000Z',
        },
      ],
      error: null,
    }).then(onfulfilled, onrejected),
  );

  return {
    insforge: {
      database: {
        from: vi.fn(() => builder),
      },
    },
  };
});

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('useAiDecision', () => {
  beforeEach(() => {
    mocks.orderCalls.length = 0;
  });

  it('uses id descending as the deterministic tie-breaker after created_at', async () => {
    const { result } = renderHook(
      () => useAiDecision('conversation-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.orderCalls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });
});
