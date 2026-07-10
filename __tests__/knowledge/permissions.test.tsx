/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'viewer' as 'owner' | 'admin' | 'agent' | 'viewer',
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
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgePage />
    </QueryClientProvider>,
  );
}

describe('knowledge management permissions', () => {
  afterEach(() => {
    cleanup();
    mocks.role = 'viewer';
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
});
