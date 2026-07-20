/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuditLogs } from '@/lib/queries/hooks/useAuditLogs';
import {
  useContacts,
  useCustomerSelectorOptions,
} from '@/lib/queries/hooks/useContacts';
import { useKnowledgeDocs } from '@/lib/queries/hooks/useKnowledge';
import { useTeamMembers } from '@/lib/queries/hooks/useTeamMembers';

const mocks = vi.hoisted(() => ({
  orgId: 'org-1',
  eqCalls: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries/helpers', () => ({
  useAuthReady: () => true,
}));

vi.mock('@/lib/queries/hooks/useOrganization', () => ({
  useOrgMembership: () => ({ data: mocks.orgId, isLoading: false }),
}));

vi.mock('@/lib/insforge', () => {
  type Result = { data: unknown[]; error: null };
  type Resolve = (value: Result) => unknown;
  type Reject = (reason: unknown) => unknown;

  function makeBuilder(table: string) {
    const result: Result = { data: [], error: null };
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      ilike: vi.fn(),
      limit: vi.fn(),
      in: vi.fn(),
      contains: vi.fn(),
      or: vi.fn(),
      then: (resolve: Resolve, reject?: Reject) =>
        Promise.resolve(result).then(resolve, reject),
    };

    builder.select.mockImplementation(() => builder);
    builder.eq.mockImplementation((column: string, value: unknown) => {
      mocks.eqCalls.push({ table, column, value });
      return builder;
    });
    builder.order.mockImplementation(() => builder);
    builder.ilike.mockImplementation(() => builder);
    builder.limit.mockImplementation(() => builder);
    builder.in.mockImplementation(() => builder);
    builder.contains.mockImplementation(() => builder);
    builder.or.mockImplementation(() => builder);
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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function useTenantQueries() {
  return [
    useContacts({ search: 'Ada' }),
    useCustomerSelectorOptions('Ada', true),
    useKnowledgeDocs(),
    useTeamMembers(),
    useAuditLogs({ actorType: 'user' }),
  ];
}

describe('tenant-scoped query isolation', () => {
  beforeEach(() => {
    mocks.orgId = 'org-1';
    mocks.eqCalls.length = 0;
    vi.clearAllMocks();
  });

  it('uses independent cache entries and organization filters after an org transition', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(() => useTenantQueries(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.every((query) => query.isSuccess)).toBe(true);
    });

    act(() => {
      mocks.orgId = 'org-2';
      rerender();
    });

    await waitFor(() => {
      expect(
        mocks.eqCalls.filter(
          ({ column, value }) => column === 'organization_id' && value === 'org-2',
        ),
      ).toHaveLength(5);
    });

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);

    for (const orgId of ['org-1', 'org-2']) {
      expect(keys).toContainEqual(['contacts', orgId, { search: 'Ada' }]);
      expect(keys).toContainEqual(['customer-selector-options', orgId, 'Ada']);
      expect(keys).toContainEqual(['knowledge-documents', orgId]);
      expect(keys).toContainEqual(['team-members', orgId]);
      expect(keys).toContainEqual(['audit-logs', orgId, { actorType: 'user' }]);
    }

    for (const table of [
      'contacts',
      'knowledge_documents',
      'organization_members',
      'audit_logs',
    ]) {
      expect(mocks.eqCalls).toContainEqual({
        table,
        column: 'organization_id',
        value: 'org-1',
      });
      expect(mocks.eqCalls).toContainEqual({
        table,
        column: 'organization_id',
        value: 'org-2',
      });
    }
  });
});
