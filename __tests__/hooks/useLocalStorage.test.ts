/**
 * @vitest-environment jsdom
 *
 * Sanity-check tests for the SSR-safe `useLocalStorage` hook. The hook is
 * the foundation for sidebar-collapse persistence in AppShell, so these
 * tests cover the three load-bearing properties:
 *   1. SSR safety: synchronous render returns `initialValue`, never reads
 *      `localStorage` during render.
 *   2. Mount read: after the initial paint, `useEffect` hydrates state
 *      from an existing `localStorage` value.
 *   3. Fallback: when `localStorage` is unavailable (Safari private mode,
 *      sandboxed iframes, quota), the hook degrades to in-memory state.
 */
/**
 * This file is `.ts` (not `.tsx`) per the task spec — React elements are
 * built with `React.createElement` to keep the file plain TypeScript.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, renderHook } from '@testing-library/react';
import { useLocalStorage } from '../../lib/hooks/useLocalStorage';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useLocalStorage — SSR safety', () => {
  it('returns initial value without reading localStorage during the synchronous render', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    // Capture the spy call count and the rendered value at the moment the
    // component's render function runs. We use module-level bindings rather
    // than refs because reading from inside the function body is enough —
    // the first call to the render function is the synchronous render, and
    // the effect's `getItem` call happens AFTER the render returns and
    // RTL commits. Reading these bindings after `render()` returns gives
    // us a snapshot of the render-phase state.
    let spyCountDuringRender = -1;
    let valueAtFirstRender: boolean | undefined;

    const Probe: React.FC = () => {
      const [value] = useLocalStorage<boolean>('test:k1', false);
      if (spyCountDuringRender === -1) {
        spyCountDuringRender = getItemSpy.mock.calls.length;
        valueAtFirstRender = value;
      }
      return React.createElement(
        'span',
        { 'data-testid': 'value' },
        String(value),
      );
    };

    render(React.createElement(Probe));

    // (1) The synchronous render must NOT have called localStorage.getItem.
    //     The hook uses `useState<T>(initialValue)` (a direct value) plus a
    //     `useEffect` for the read, so storage is consulted only after commit.
    //     Reading the spy mock here — at the render phase — proves this:
    //     a lazy initializer that called getItem would have incremented the
    //     counter before the render function returned.
    expect(spyCountDuringRender).toBe(0);

    // (2) The initial render output is the supplied default, proving that
    //     even if storage had been consulted during render, the value seen
    //     by the consumer is still `initialValue` — the SSR-safety invariant.
    expect(valueAtFirstRender).toBe(false);

    // (3) Sanity: the effect did eventually run and consulted the right
    //     key. This confirms the read happens post-commit, not during
    //     render, and targets the key the caller asked for.
    expect(getItemSpy).toHaveBeenCalledWith('test:k1');
  });
});

describe('useLocalStorage — mount read', () => {
  it('reads an existing localStorage value after mount and updates state', async () => {
    // Pre-seed with a value different from the default. `JSON.stringify(true)`
    // produces the literal string `"true"`, which `JSON.parse` will round-trip
    // back to a boolean — that round-trip is what the hook does internally.
    localStorage.setItem('test:k2', JSON.stringify(true));

    const { result } = renderHook(() =>
      useLocalStorage<boolean>('test:k2', false),
    );

    // `renderHook` flushes effects inside its internal `act()`, so by the
    // time it returns the `useEffect` has already read `test:k2` from
    // localStorage and updated state from the default `false` to the
    // stored `true`. The interesting assertion is that the hook actually
    // picked up the pre-seeded value — that proves the post-mount read
    // works. (The synchronous-render return value is covered by the SSR
    // safety test above.)
    expect(result.current[0]).toBe(true);
  });
});

describe('useLocalStorage — fallback when localStorage is unavailable', () => {
  it('degrades gracefully to in-memory state when getItem/setItem throw', () => {
    // Simulate Safari private mode / sandboxed iframe / disabled storage:
    // every storage access throws. The hook must not propagate the error.
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError: storage unavailable');
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('SecurityError: storage unavailable');
      });

    const { result } = renderHook(() =>
      useLocalStorage<string>('test:k3', 'default'),
    );

    // (1) Initial value is the supplied default — the read in the effect
    //     threw, so the hook kept `initialValue` and the component kept
    //     running.
    expect(result.current[0]).toBe('default');
    expect(getItemSpy).toHaveBeenCalled();

    // (2) Calling the setter with a direct value updates the in-memory
    //     state even though the underlying `setItem` throws. The error
    //     is caught inside the hook, not propagated to the caller.
    expect(() => {
      act(() => {
        result.current[1]('new');
      });
    }).not.toThrow();
    expect(result.current[0]).toBe('new');
    expect(setItemSpy).toHaveBeenCalled();

    // (3) The function-form setter (matches React's `useState` shape) also
    //     works under the same degraded conditions.
    expect(() => {
      act(() => {
        result.current[1]((prev) => `${prev}-updated`);
      });
    }).not.toThrow();
    expect(result.current[0]).toBe('new-updated');
  });
});
