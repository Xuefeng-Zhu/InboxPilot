/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'viewer' as 'owner' | 'admin' | 'agent' | 'viewer',
  realtimeOptions: null as {
    messageChannel?: string;
    enabled?: boolean;
    onKnowledgeDocumentUpdated?: (payload: Record<string, unknown>) => void;
  } | null,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/lib/queries', () => ({
  useCurrentMembership: () => ({
    data: { organizationId: 'org-1', role: mocks.role },
    error: null,
  }),
  useKnowledgeDocs: () => ({ data: [], isLoading: false, error: null }),
  queryKeys: {
    knowledgeDocs: (orgId: string) => ['knowledge-documents', orgId],
  },
}));

vi.mock('@/lib/insforge', () => ({
  insforge: { database: { from: vi.fn() } },
}));

vi.mock('@/lib/use-realtime', () => ({
  useRealtime: (options: typeof mocks.realtimeOptions) => {
    mocks.realtimeOptions = options;
  },
}));

vi.mock('@/components/layout', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui', () => ({
  Pill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/knowledge', () => ({
  AddDocumentForm: () => <div>Add document form</div>,
  MAX_FILE_SIZE_MB: 10,
  SOURCE_TYPES: ['faq', 'article'],
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

import KnowledgePage from '../../app/knowledge/page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <KnowledgePage />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('knowledge management permissions', () => {
  afterEach(() => {
    cleanup();
    mocks.role = 'viewer';
    mocks.realtimeOptions = null;
  });

  it.each(['agent', 'viewer'] as const)('keeps the %s knowledge view read-only', (role) => {
    mocks.role = role;
    renderPage();

    expect(screen.queryByRole('button', { name: /new article/i })).toBeNull();
  });

  it.each(['owner', 'admin'] as const)('shows knowledge management to the %s', (role) => {
    mocks.role = role;
    renderPage();

    expect(screen.getByRole('button', { name: /new article/i })).toBeTruthy();
  });

  it('invalidates the organization document list on a completion event', () => {
    const { queryClient } = renderPage();
    const documentListKey = ['knowledge-documents', 'org-1'] as const;
    queryClient.setQueryData(documentListKey, [{ id: 'doc-1', status: 'processing' }]);

    expect(mocks.realtimeOptions?.messageChannel).toBe('org:org-1');
    expect(mocks.realtimeOptions?.enabled).toBe(true);
    act(() => {
      mocks.realtimeOptions?.onKnowledgeDocumentUpdated?.({
        documentId: 'doc-1',
        status: 'ready',
      });
    });

    expect(queryClient.getQueryState(documentListKey)?.isInvalidated).toBe(true);
  });
});
