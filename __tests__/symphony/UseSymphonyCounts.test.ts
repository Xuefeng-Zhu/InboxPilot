/**
 * @vitest-environment jsdom
 *
 * Regression test for the P2 fix in lib/queries/hooks/useSymphony.ts
 * (useSymphonyCounts).
 *
 * Background: the buggy version of useSymphonyCounts built ONE PostgREST
 * chain and then re-used it for all three count queries. Because the
 * PostgREST chain is mutable, the .eq / .neq / .gte / .lte calls from
 * the "stream" query leaked into the "drafting" and "escalated" queries,
 * producing wrong counts (e.g. drafting was double-filtered).
 *
 * The fix introduced `buildBase()` so each call to
 * `insforge.database.from('conversations')` returns a brand-new chain.
 *
 * This test mocks `@/lib/insforge` so that EVERY `.from()` call returns
 * a fresh chainable backed by its own `URL` object. Each chain records
 * its filters into its own URL when `.eq` / `.neq` / `.gte` / `.lte` are
 * called, and pushes its URL onto `captured` when awaited. We then
 * assert that:
 *   - stream URL has status=neq.resolved and NO ai_state filter
 *   - drafting URL has ai_state=eq.drafted and NO status filter
 *   - escalated URL has status=eq.escalated and NO ai_state filter
 *
 * If the buggy shared-chain code is restored, the three captured URLs
 * are the SAME URL object (mutated across all three awaits), and
 * multiple assertions fail.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSymphonyCounts } from '../../lib/queries/hooks/useSymphony';

// ---------------------------------------------------------------------------
// Mocks
//
// vi.hoisted runs before module imports so vi.mock factories can reference
// the shared `mocks` object. Each call to `mocks.from()` returns a NEW
// chain (new URL), so filters cannot leak between queries.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const captured: { url: URL }[] = [];

  type MockChain = {
    select(): MockChain;
    eq(column: string, value: string): MockChain;
    neq(column: string, value: string): MockChain;
    gte(column: string, value: string): MockChain;
    lte(column: string, value: string): MockChain;
    in(): MockChain;
    order(): MockChain;
    limit(): MockChain;
    range(): MockChain;
    then(resolve: (value: { count: number; data: null; error: null }) => void): void;
  };

  function makeChain() {
    const url = new URL('https://example.test/rest/v1/conversations');
    const chain: MockChain = {
      select: vi.fn(() => chain),
      eq: vi.fn((col: string, val: string) => {
        url.searchParams.append(col, `eq.${val}`);
        return chain;
      }),
      neq: vi.fn((col: string, val: string) => {
        url.searchParams.append(col, `neq.${val}`);
        return chain;
      }),
      gte: vi.fn((col: string, val: string) => {
        url.searchParams.append(col, `gte.${val}`);
        return chain;
      }),
      lte: vi.fn((col: string, val: string) => {
        url.searchParams.append(col, `lte.${val}`);
        return chain;
      }),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      range: vi.fn(() => chain),
      // Stand-in for the real PostgREST thenable. Captures the chain's URL
      // and resolves with a count-shaped object so the destructuring in
      // useSymphonyCounts works (`const { count } = await ...`).
      then(resolve: (value: { count: number; data: null; error: null }) => void) {
        captured.push({ url });
        resolve({ count: 0, data: null, error: null });
      },
    };
    return chain;
  }

  return {
    captured,
    from: vi.fn(() => makeChain()),
  };
});

vi.mock('@/lib/insforge', () => ({
  insforge: {
    database: {
      from: mocks.from,
    },
  },
  getAccessToken: () => null,
}));

vi.mock('@/lib/queries/keys', () => ({
  queryKeys: {
    symphonyCounts: (orgId: string, zoom: string) =>
      ['symphony-counts', orgId, zoom] as const,
  },
}));

vi.mock('@/lib/queries/helpers', () => ({
  useAuthReady: () => true,
}));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('useSymphonyCounts (P2 regression)', () => {
  beforeEach(() => {
    mocks.captured.length = 0;
    mocks.from.mockClear();
  });

  it('uses a fresh PostgREST builder for each count query (no filter leakage)', async () => {
    const { result } = renderHook(
      () => useSymphonyCounts('org-1', 'week', 0),
      { wrapper },
    );

    // Wait for all three awaited queries to complete.
    await waitFor(() => expect(mocks.captured.length).toBe(3));

    // Sanity: each query hit .from() with a brand-new chain.
    expect(mocks.from).toHaveBeenCalledTimes(3);
    expect(mocks.from).toHaveBeenNthCalledWith(1, 'conversations');
    expect(mocks.from).toHaveBeenNthCalledWith(2, 'conversations');
    expect(mocks.from).toHaveBeenNthCalledWith(3, 'conversations');

    // The three captured URLs must be DISTINCT objects (the fresh-builder
    // invariant). In the buggy version, all three references point at the
    // SAME URL object.
    expect(mocks.captured[0].url).not.toBe(mocks.captured[1].url);
    expect(mocks.captured[1].url).not.toBe(mocks.captured[2].url);
    expect(mocks.captured[0].url).not.toBe(mocks.captured[2].url);

    const streamParams = mocks.captured[0].url.searchParams;
    const draftingParams = mocks.captured[1].url.searchParams;
    const escalatedParams = mocks.captured[2].url.searchParams;

    // stream: org_id + range + neq(resolved)  —  no ai_state
    expect(streamParams.get('organization_id')).toBe('eq.org-1');
    expect(streamParams.get('status')).toBe('neq.resolved');
    expect(streamParams.get('ai_state')).toBeNull();

    // drafting: org_id + range + ai_state=drafted  —  NO status filter
    // (This is the specific leak from the buggy shared-chain code: drafting
    //  was inheriting status=neq.resolved from stream.)
    expect(draftingParams.get('organization_id')).toBe('eq.org-1');
    expect(draftingParams.get('ai_state')).toBe('eq.drafted');
    expect(draftingParams.get('status')).toBeNull();

    // escalated: org_id + range + status=eq.escalated  —  no ai_state
    // (Buggy code leaked ai_state=eq.drafted from drafting into escalated.)
    expect(escalatedParams.get('organization_id')).toBe('eq.org-1');
    expect(escalatedParams.get('status')).toBe('eq.escalated');
    expect(escalatedParams.get('ai_state')).toBeNull();

    // The hook should have produced a result.
    expect(result.current.data).toEqual({ stream: 0, drafting: 0, escalated: 0 });
  });
});
