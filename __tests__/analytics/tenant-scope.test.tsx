/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '@/app/analytics/page';

const mocks = vi.hoisted(() => ({
  eqCalls: [] as Array<{ column: string; value: unknown }>,
  ltCalls: [] as Array<{ column: string; value: unknown }>,
  from: vi.fn(),
  membership: {
    data: 'org-1' as string | null | undefined,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries', () => ({
  useOrgMembership: () => mocks.membership,
  useOrganization: () => ({ data: { name: 'Acme' } }),
}));

vi.mock('@/components/layout', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui', () => ({
  Pill: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/insforge', () => {
  function makeBuilder() {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      lt: vi.fn(),
      limit: vi.fn(),
    };

    builder.select.mockImplementation(() => builder);
    builder.eq.mockImplementation((column: string, value: unknown) => {
      mocks.eqCalls.push({ column, value });
      return builder;
    });
    builder.gte.mockImplementation(() => builder);
    builder.lt.mockImplementation((column: string, value: unknown) => {
      mocks.ltCalls.push({ column, value });
      return builder;
    });
    builder.limit.mockResolvedValue({ data: [], error: null });
    return builder;
  }

  return {
    insforge: {
      database: {
        from: mocks.from.mockImplementation(() => makeBuilder()),
      },
    },
  };
});

describe('Analytics tenant scoping', () => {
  beforeEach(() => {
    mocks.eqCalls = [];
    mocks.ltCalls = [];
    mocks.membership = { data: 'org-1', isLoading: false, error: null };
    mocks.from.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('filters conversation metrics to the current organization', async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(mocks.eqCalls).toContainEqual({
        column: 'organization_id',
        value: 'org-1',
      });
      expect(mocks.ltCalls).toEqual([
        {
          column: 'created_at',
          value: expect.any(String),
        },
      ]);
    });
  });

  it.each([
    {
      label: 'missing',
      membership: { data: null, isLoading: false, error: null },
      expected: 'No workspace membership was found.',
    },
    {
      label: 'failed',
      membership: {
        data: undefined,
        isLoading: false,
        error: new Error('membership unavailable'),
      },
      expected: 'Could not load your workspace.',
    },
  ])('shows an actionable state when membership is $label', ({ membership, expected }) => {
    mocks.membership = membership;

    render(<AnalyticsPage />);

    expect(screen.getByRole('alert').textContent).toContain(expected);
    expect(screen.queryByText('Loading analytics…')).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
