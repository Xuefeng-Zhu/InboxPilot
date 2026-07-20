/**
 * @vitest-environment jsdom
 */
import { Suspense, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  linksData: [] as unknown[],
  linksError: null as { message: string } | null,
  linkSelection: '',
  invalidateQueries: vi.fn(),
  realtimeOptions: null as {
    messageChannel?: string;
    enabled?: boolean;
    onKnowledgeDocumentUpdated?: (payload: Record<string, unknown>) => void;
  } | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/queries', () => ({
  useCurrentMembership: () => ({
    data: { organizationId: 'org-1', role: 'viewer' },
    error: null,
  }),
  useKnowledgeDoc: () => ({
    data: {
      id: 'doc-1',
      organization_id: 'org-1',
      title: 'Returns policy',
      source_type: 'article',
      body: 'Return items within 30 days.',
      status: 'ready',
      error_message: null,
      updated_at: '2026-07-20T00:00:00.000Z',
    },
    isLoading: false,
    error: null,
  }),
  queryKeys: {
    knowledgeDoc: (orgId: string, id: string) => ['knowledge-document', orgId, id],
    knowledgeDocs: (orgId: string) => ['knowledge-documents', orgId],
  },
}));

vi.mock('@/lib/use-realtime', () => ({
  useRealtime: (options: typeof mocks.realtimeOptions) => {
    mocks.realtimeOptions = options;
  },
}));

vi.mock('@/lib/insforge', () => ({
  insforge: {
    database: {
      from: vi.fn((table: string) => {
        if (table === 'knowledge_chunks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() =>
                Promise.resolve({
                  data: [{ id: 'chunk-1' }],
                  count: 1,
                  error: null,
                }),
              ),
            })),
          };
        }

        if (table === 'ai_decision_chunks') {
          return {
            select: vi.fn((selection: string) => {
              mocks.linkSelection = selection;
              return {
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() =>
                      Promise.resolve({
                        data: mocks.linksData,
                        error: mocks.linksError,
                      }),
                    ),
                  })),
                })),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  },
}));

vi.mock('@/components/layout', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui', () => ({
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Select: () => <div />,
}));

vi.mock('@/components/knowledge/MarkdownEditor', () => ({
  MarkdownEditor: () => <textarea />,
}));

vi.mock('@/components/knowledge/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/components/knowledge/types', () => ({
  SOURCE_TYPES: ['article'],
}));

vi.mock('../../app/knowledge/mutations', () => ({
  deleteKnowledgeDocument: vi.fn(),
  reprocessKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));

vi.mock('../../app/knowledge/mutation-warning', () => ({
  storeKnowledgeMutationWarning: vi.fn(),
}));

import KnowledgeDetailPage from '../../app/knowledge/[id]/page';

function renderPage() {
  const value = { id: 'doc-1' };
  const params = Object.assign(Promise.resolve(value), {
    status: 'fulfilled' as const,
    value,
  });
  return render(
    <Suspense fallback={<div>Loading page…</div>}>
      <KnowledgeDetailPage params={params} />
    </Suspense>,
  );
}

describe('knowledge document linked conversations', () => {
  beforeEach(() => {
    mocks.linksData = [];
    mocks.linksError = null;
    mocks.linkSelection = '';
    mocks.invalidateQueries.mockReset();
    mocks.realtimeOptions = null;
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('joins contact names and renders linked conversations', async () => {
    mocks.linksData = [
      {
        ai_decisions: {
          id: 'decision-1',
          conversations: {
            id: 'conversation-123456789',
            last_message_at: '2026-07-20T00:00:00.000Z',
            contacts: { name: 'Ada Lovelace' },
          },
        },
      },
    ];

    renderPage();

    const link = await screen.findByRole('link', {
      name: /Ada Lovelace/i,
    });
    expect(link.getAttribute('href')).toBe(
      '/inbox?conversation=conversation-123456789',
    );
    expect(mocks.linkSelection).toContain('contacts(name)');
    expect(mocks.linkSelection).not.toContain('customer_name');
    expect(screen.queryByText('None yet')).toBeNull();
  });

  it('shows a query error instead of an empty state', async () => {
    mocks.linksError = { message: 'column lookup failed' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Unable to load linked conversations.',
    );
    expect(screen.queryByText('None yet')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Linked knowledge conversations could not be loaded:',
      'column lookup failed',
    );
  });

  it('invalidates only this document and its list on a matching completion event', async () => {
    renderPage();
    await screen.findByText('None yet');

    expect(mocks.realtimeOptions?.messageChannel).toBe('org:org-1');
    expect(mocks.realtimeOptions?.enabled).toBe(true);

    act(() => {
      mocks.realtimeOptions?.onKnowledgeDocumentUpdated?.({
        documentId: 'doc-other',
        status: 'ready',
      });
    });
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();

    act(() => {
      mocks.realtimeOptions?.onKnowledgeDocumentUpdated?.({
        documentId: 'doc-1',
        status: 'ready',
      });
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-document', 'org-1', 'doc-1'],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-documents', 'org-1'],
    });
  });
});
