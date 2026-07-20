/**
 * @vitest-environment jsdom
 *
 * Regression test for the P1 frontend fix in
 * app/symphony/_components/RiverExpandedPanel.tsx.
 *
 * Background
 * ----------
 * Before the fix, the approve mutation sent only
 *   { conversationId, aiDecisionId }
 * to /api/functions/approve-ai-draft, so when an agent edited the AI draft
 * in the textarea and clicked "Save & send", the edit was silently discarded
 * and the API ended up sending the original AI text.
 *
 * The fix:
 *   1. mutationFn now accepts an optional `bodyOverride: string` argument
 *   2. "Save & send" calls `approve.mutate(editedBody)` — pass the override
 *   3. "Approve & send" calls `approve.mutate(undefined)` — no override
 *   4. The JSON payload spreads `...(bodyOverride ? { body: bodyOverride } : {})`,
 *      so the `body` key is OMITTED from the JSON entirely when no override.
 *
 * These two tests lock in the P1 contract:
 *   - Test 1 proves "Save & send" sends the edited text in `body`
 *   - Test 2 proves "Approve & send" still omits `body` (backward-compat:
 *     the API's `bodyOverride !== undefined` check distinguishes the two
 *     paths via key-presence, not via `null`/`undefined`-as-value)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RiverExpandedPanel } from '../../app/symphony/_components/RiverExpandedPanel';
import type { PillDescriptor } from '../../lib/queries/hooks/useSymphony';
import { queryKeys } from '../../lib/queries/keys';

const lifecycle = vi.hoisted(() => ({
  events: [] as string[],
}));

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockAiDecision = {
  id: 'decision-1',
  response_text: 'Original AI response text from the model.',
  confidence: 0.92,
  created_at: new Date().toISOString(),
};

const mockMessages = [
  {
    id: 'm-1',
    sender_type: 'contact',
    body: 'Customer asks a question.',
    created_at: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Module mocks (must run before component import — vitest hoists vi.mock)
// ---------------------------------------------------------------------------

vi.mock('@/lib/queries', async () => {
  const invalidation = await vi.importActual<
    typeof import('@/lib/queries/invalidation')
  >('@/lib/queries/invalidation');
  return {
    ...invalidation,
    invalidateConversationMutationCaches: async (
      queryClient: QueryClient,
      conversationId: string,
    ) => {
      lifecycle.events.push('invalidate');
      return invalidation.invalidateConversationMutationCaches(
        queryClient,
        conversationId,
      );
    },
    useMessages: () => ({ data: mockMessages }),
    useAiDecision: () => ({ data: mockAiDecision }),
  };
});

vi.mock('@/lib/insforge', () => ({
  getAccessToken: () => 'test-token-abc',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const draftingPill: PillDescriptor = { text: 'drafting', tone: 'drafting' };

function renderPanel(
  props: Partial<React.ComponentProps<typeof RiverExpandedPanel>> = {},
) {
  const onStartEdit = vi.fn();
  const onCancelEdit = vi.fn();
  const onAcceptedWarning = vi.fn();
  const onApproved = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const utils = render(
    <QueryClientProvider client={client}>
      <RiverExpandedPanel
        conversationId="conv-1"
        contactName="Maya Chen"
        pill={draftingPill}
        editMode={true}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onAcceptedWarning={onAcceptedWarning}
        onApproved={onApproved}
        {...props}
      />
    </QueryClientProvider>,
  );

  return {
    ...utils,
    client,
    onStartEdit,
    onCancelEdit,
    onAcceptedWarning,
    onApproved,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RiverExpandedPanel (P1 frontend regression)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    lifecycle.events.length = 0;
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', data: { message: { id: 'msg-1' } } }),
      text: async () => '',
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the edited textarea body when Save & send is clicked', async () => {
    renderPanel();

    // Textarea is prefilled with the AI decision's response_text via useEffect.
    const textarea = (await screen.findByLabelText(
      /edit ai draft/i,
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original AI response text from the model.');

    // Agent edits the draft.
    fireEvent.change(textarea, {
      target: { value: 'EDITED: I have updated the response per the agent request.' },
    });

    // Click "Save & send".
    const saveButton = screen.getByRole('button', { name: /save & send/i });
    fireEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Inspect the POST: URL, method, headers, and JSON body.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/functions/approve-ai-draft');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer test-token-abc');

    const body = JSON.parse(init.body);
    expect(body.conversationId).toBe('conv-1');
    expect(body.aiDecisionId).toBe('decision-1');
    // CRITICAL: the edited text must reach the API.
    expect(body.body).toBe('EDITED: I have updated the response per the agent request.');
  });

  it('omits the body key when Approve & send is clicked (no override)', async () => {
    // Non-edit mode: only the "Approve & send" + "Edit" buttons render.
    const { client } = renderPanel({ editMode: false });
    const countKey = queryKeys.symphonyCounts('org-1', 'day:0');
    const listKey = queryKeys.conversationsInfinite('org-1');
    client.setQueryData(countKey, { drafting: 1 });
    client.setQueryData(listKey, [{ id: 'conv-1' }]);

    const approveButton = screen.getByRole('button', { name: /approve & send/i });
    fireEvent.click(approveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.conversationId).toBe('conv-1');
    expect(body.aiDecisionId).toBe('decision-1');
    // CRITICAL: the patched payload uses
    //   ...(bodyOverride ? { body: bodyOverride } : {})
    // so when bodyOverride is undefined, the spread contributes nothing and
    // the `body` key is absent from the serialized JSON (not present-with-undef).
    expect('body' in body).toBe(false);
    expect(client.getQueryState(countKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it('emits an accepted-reply warning before invalidating query-derived cards', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({
        status: 'accepted',
        warning: 'Provider outcome is unknown; retry was suppressed.',
        data: { message: null },
      }),
      text: async () => '',
    } as unknown as Response);
    const onAcceptedWarning = vi.fn((warning: string | null) => {
      lifecycle.events.push(`warning:${warning ?? 'null'}`);
    });
    renderPanel({ editMode: false, onAcceptedWarning });

    fireEvent.click(screen.getByRole('button', { name: /approve & send/i }));

    await waitFor(() => expect(lifecycle.events).toContain('invalidate'));
    expect(onAcceptedWarning).toHaveBeenNthCalledWith(1, null);
    expect(onAcceptedWarning).toHaveBeenNthCalledWith(
      2,
      'Provider outcome is unknown; retry was suppressed.',
    );
    expect(lifecycle.events).toEqual([
      'warning:null',
      'warning:Provider outcome is unknown; retry was suppressed.',
      'invalidate',
    ]);
  });
});
