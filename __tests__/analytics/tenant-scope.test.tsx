/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '@/app/analytics/page';

const mocks = vi.hoisted(() => ({
  eqCalls: [] as Array<{ column: string; value: unknown }>,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries', () => ({
  useOrgMembership: () => ({ data: 'org-1' }),
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
      limit: vi.fn(),
    };

    builder.select.mockImplementation(() => builder);
    builder.eq.mockImplementation((column: string, value: unknown) => {
      mocks.eqCalls.push({ column, value });
      return builder;
    });
    builder.gte.mockImplementation(() => builder);
    builder.limit.mockResolvedValue({ data: [], error: null });
    return builder;
  }

  return {
    insforge: {
      database: {
        from: vi.fn(() => makeBuilder()),
      },
    },
  };
});

describe('Analytics tenant scoping', () => {
  it('filters conversation metrics to the current organization', async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(mocks.eqCalls).toContainEqual({
        column: 'organization_id',
        value: 'org-1',
      });
    });
  });
});
