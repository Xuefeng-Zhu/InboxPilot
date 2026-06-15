/**
 * @vitest-environment jsdom
 *
 * PERMANENT regression test for the M03 right-panel tab strip — the test
 * that catches the next silent removal of the AI Insight / Customer /
 * Audit tab strip from `components/inbox/RightPanel.tsx`.
 *
 * See `.omo/plans/restore-ai-insight-tab.md` Task 9 (Test strategy).
 * The plan explicitly calls this out as a deliverable — Tasks 3-7 used
 * throwaway QA harnesses, but Task 9 is the permanent safety net.
 *
 * ## What this test locks in
 *
 *   1. 3 tab buttons render with the exact labels "AI Insight",
 *      "Customer", "Audit" (Group 1).
 *   2. Default active tab is "AI Insight" (the body shows the empty
 *      state `No AI activity yet` for `ai_state='idle'` + null decision).
 *   3. Clicking "Customer" swaps the body to ContactDetails +
 *      ActivityPanel; the "Activity" SectionHeading is visible.
 *   4. Clicking "Audit" swaps the body to the audit timeline; the
 *      writer-gap acknowledgement `Some actions may not be audited yet.`
 *      is visible (it's always rendered, above every state).
 *   5. Switching `conversationId` resets the active tab to "AI Insight"
 *      via the `useEffect(() => setActiveTab('ai'), [conversationId])`
 *      side effect.
 *   6. Tabs render in drawer mode (`open={true}`).
 *   7. `AuditTab`'s underlying `useAuditLogs` calls receive the right
 *      filter args: `{ metadataContains: { conversationId } }` and
 *      `{ resourceType: 'conversation', resourceId }`.
 *
 * ## Mock strategy
 *
 * - `vi.hoisted` mock registry for all 5 leaf hooks touched by the
 *   panel + its 3 tab bodies.
 * - Module-level `vi.mock` of the 4 hook source paths (relative
 *   `@/lib/queries/hooks/<name>`) so both the panel's barrel-imports
 *   and the tabs' direct imports resolve to the registry.
 * - The `useConversationAuditTrail` orchestrator runs REAL via
 *   `vi.importActual` — its 6 underlying hooks (useAuditLogs x4,
 *   useAiDecisionsForConversation, useInfiniteMessages) are all mocked,
 *   so we never hit InsForge, but the orchestrator's call pattern to
 *   `useAuditLogs` (2-4 calls per render with specific filter shapes)
 *   is exactly what Group 6 wants to lock in.
 * - `useAuth` returns a fake user so any downstream `useAuthReady`
 *   (inside the mocked hooks) is satisfied.
 *
 * No new dependencies; no `as any`; no `console.log`; no real DB.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../../components/inbox/RightPanel';
import { AuditTab } from '../../components/inbox/AuditTab';

// ---------------------------------------------------------------------------
// Mock registry
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  useInfiniteMessages: vi.fn(),
  useAiDecision: vi.fn(),
  useAiDecisionsForConversation: vi.fn(),
  useAuditLogs: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));

// The barrel re-exports the same hook the deep paths export. Mock BOTH
// the barrel (imported by `RightPanel` for `useConversation` and
// `useInfiniteMessages`) and the deep paths (imported by `AiInsightTab`,
// `AuditTab`, and the orchestrator). Both factories reference the same
// `vi.hoisted` mock instances so all 5 hooks are controlled by one
// registry.
vi.mock('@/lib/queries', () => ({
  useConversation: mocks.useConversation,
  useInfiniteMessages: mocks.useInfiniteMessages,
  queryKeys: {
    conversation: (id: string) => ['conversation', id],
    messagesInfinite: (id: string, pageSize: number) => ['messages', 'infinite', id, pageSize],
    aiDecision: (id: string) => ['ai-decision', id],
    auditLogs: (filters?: Record<string, unknown>) => ['audit-logs', filters],
  },
  CONVERSATION_PAGE_SIZE: 25,
  MESSAGE_PAGE_SIZE: 50,
}));

vi.mock('@/lib/queries/hooks/useAiDecision', () => ({
  useAiDecision: mocks.useAiDecision,
  useAiDecisionsForConversation: mocks.useAiDecisionsForConversation,
}));

vi.mock('@/lib/queries/hooks/useMessages', () => ({
  useMessages: () => ({ data: [], isLoading: false }),
  useInfiniteMessages: mocks.useInfiniteMessages,
}));

vi.mock('@/lib/queries/hooks/useAuditLogs', () => ({
  useAuditLogs: mocks.useAuditLogs,
}));

// Run the real orchestrator — its 6 leaf hooks are all mocked above, so
// we never hit InsForge, but the call pattern to `useAuditLogs` (and the
// 4-prong filter shapes) is exactly what Group 6 wants to lock in.
vi.mock('@/lib/queries/hooks/useConversationAuditTrail', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/queries/hooks/useConversationAuditTrail')
  >();
  return {
    useConversationAuditTrail: actual.useConversationAuditTrail,
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const conversationRow = {
  id: 'c1',
  organization_id: 'org-1',
  contact_id: 'contact-1',
  channel: 'webchat',
  status: 'open',
  ai_state: 'idle',
  subject: null,
  assigned_to: null,
  last_message_at: '2026-06-13T10:00:00.000Z',
  last_message_direction: 'inbound',
  metadata: {},
  created_at: '2026-06-13T10:00:00.000Z',
  updated_at: '2026-06-13T10:00:00.000Z',
  contacts: {
    id: 'contact-1',
    organization_id: 'org-1',
    name: 'Maya Chen',
    email: null,
    phone: null,
    metadata: {},
    created_at: '2026-06-13T10:00:00.000Z',
    updated_at: '2026-06-13T10:00:00.000Z',
  },
  latest_message: null,
};

const auditRow = {
  id: 'audit-1',
  organization_id: 'org-1',
  actor_id: null,
  actor_type: 'system',
  action: 'message_received',
  resource_type: 'conversation',
  resource_id: 'c1',
  metadata: {},
  created_at: '2026-06-13T10:01:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return {
    ...result,
    rerenderWithQueryClient: (nextUi: React.ReactElement) =>
      result.rerender(
        <QueryClientProvider client={queryClient}>{nextUi}</QueryClientProvider>,
      ),
  };
}

function defaultMockSetup() {
  mocks.useConversation.mockReturnValue({
    data: conversationRow,
    isLoading: false,
    error: null,
  });
  mocks.useInfiniteMessages.mockReturnValue({
    items: [],
    isInitialLoading: false,
    isLoading: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn().mockResolvedValue(undefined),
    error: null,
  });
  // The orchestrator reads `useAiDecisionsForConversation().data` and
  // `useInfiniteMessages().items` as array sources. Returning [] keeps
  // prongs 3 (ai_decision) and 4 (message) gated off (`enabled: false`).
  mocks.useAiDecision.mockReturnValue({ data: null, isLoading: false });
  mocks.useAiDecisionsForConversation.mockReturnValue({ data: [], isLoading: false });
  mocks.useAuditLogs.mockReturnValue({ data: [], isLoading: false, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RightPanel tab strip (M03 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultMockSetup();
  });

  describe('Group 1: 3 tabs render', () => {
    it('renders 3 tab buttons with correct labels', () => {
      renderWithQueryClient(<RightPanel conversationId="c1" />);
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      expect(tabs.map((t) => t.textContent)).toEqual([
        'AI Insight',
        'Customer',
        'Audit',
      ]);
    });
  });

  describe('Group 2: default tab', () => {
    it('defaults to AI Insight tab', () => {
      renderWithQueryClient(<RightPanel conversationId="c1" />);
      const aiTab = screen.getByRole('tab', { name: 'AI Insight' });
      // aria-current="page" is set on the active tab by TabStrip.
      expect(aiTab).toHaveAttribute('aria-current', 'page');
      // The AI Insight body shows the empty state (aiState='idle' +
      // decision=null) — this is the AiInsightTab early-return branch.
      expect(screen.getByText('No AI activity yet')).toBeInTheDocument();
    });
  });

  describe('Group 3: tab switching', () => {
    it('clicking Customer tab swaps the body to ContactDetails + ActivityPanel', () => {
      renderWithQueryClient(<RightPanel conversationId="c1" />);
      const customerTab = screen.getByRole('tab', { name: 'Customer' });
      fireEvent.click(customerTab);
      // CustomerTab renders ContactDetails + ActivityPanel. The
      // "Activity" SectionHeading lives in ActivityPanel and is only
      // visible when this tab is mounted.
      expect(screen.getByText('Activity')).toBeInTheDocument();
      // Customer tab is now active; AI Insight is not.
      expect(customerTab).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('tab', { name: 'AI Insight' })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('clicking Audit tab swaps the body to useConversationAuditTrail timeline', () => {
      // Mock audit-log data so the timeline rows render (not just the
      // empty state below the writer-gap note).
      mocks.useAuditLogs.mockReturnValue({
        data: [auditRow],
        isLoading: false,
        error: null,
      });
      renderWithQueryClient(<RightPanel conversationId="c1" />);
      const auditTab = screen.getByRole('tab', { name: 'Audit' });
      fireEvent.click(auditTab);
      // The writer-gap acknowledgement is ALWAYS visible (top of tab,
      // above every state). Locking in its presence is the most
      // direct way to assert AuditTab's body is mounted.
      expect(
        screen.getByText('Some actions may not be audited yet.'),
      ).toBeInTheDocument();
      // The humanized action label for the mocked row is visible.
      expect(screen.getByText('Message received')).toBeInTheDocument();
      // Audit tab is now active.
      expect(auditTab).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('Group 4: conversation change resets tab', () => {
    it('switching conversationId resets active tab to AI Insight', () => {
      const { rerenderWithQueryClient } = renderWithQueryClient(
        <RightPanel conversationId="c1" />,
      );
      // Click Audit — it should become active.
      const auditTab = screen.getByRole('tab', { name: 'Audit' });
      fireEvent.click(auditTab);
      expect(auditTab).toHaveAttribute('aria-current', 'page');

      // Switch conversationId — the useEffect(..., [conversationId])
      // side effect should reset the active tab to 'ai'.
      rerenderWithQueryClient(<RightPanel conversationId="c2" />);
      expect(screen.getByRole('tab', { name: 'AI Insight' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(auditTab).not.toHaveAttribute('aria-current', 'page');
    });
  });

  describe('Group 5: drawer mode', () => {
    it('renders tabs in drawer mode (open=true)', () => {
      renderWithQueryClient(
        <RightPanel conversationId="c1" open={true} onClose={vi.fn()} />,
      );
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      expect(tabs.map((t) => t.textContent)).toEqual([
        'AI Insight',
        'Customer',
        'Audit',
      ]);
    });
  });

  describe('Group 6: useAuditLogs filter args', () => {
    it('AuditTab calls useAuditLogs with the conversationId filter args', () => {
      // Spy: record every (filters, options) pair passed to useAuditLogs.
      const calls: Array<{ filters: unknown; options: unknown }> = [];
      mocks.useAuditLogs.mockImplementation((filters: unknown, options: unknown) => {
        calls.push({ filters, options });
        return { data: [], isLoading: false, error: null };
      });
      // Empty ID-source arrays keep prongs 3 (ai_decision) and 4
      // (message) gated off (`enabled: aiDecisionIds.length > 0`),
      // so the assertion focuses on the 2 baseline prongs.
      mocks.useAiDecisionsForConversation.mockReturnValue({
        data: [],
        isLoading: false,
      });
      mocks.useInfiniteMessages.mockReturnValue({
        items: [],
        isInitialLoading: false,
        isLoading: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        hasNextPage: false,
        fetchNextPage: vi.fn().mockResolvedValue(undefined),
        error: null,
      });

      renderWithQueryClient(<AuditTab conversationId="c1" />);

      // Prong 1: metadataContains: { conversationId: 'c1' }
      expect(calls).toContainEqual({
        filters: { metadataContains: { conversationId: 'c1' } },
        options: { enabled: true },
      });
      // Prong 2: resourceType: 'conversation', resourceId: 'c1'
      expect(calls).toContainEqual({
        filters: { resourceType: 'conversation', resourceId: 'c1' },
        options: { enabled: true },
      });
    });
  });
});
