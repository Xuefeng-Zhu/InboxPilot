'use client';

/**
 * useLocalStorage — SSR-safe, typed localStorage React hook.
 *
 * Why this hook is shaped the way it is:
 *
 * 1. **SSR safety.** The initial render — both on the server and on the first
 *    client render before hydration — returns `initialValue` verbatim. We use
 *    `useState<T>(initialValue)` (a direct value) instead of a lazy
 *    initializer like `useState(() => localStorage.getItem(...))`, because
 *    the latter would throw on the server (no `window`/`localStorage`) and
 *    could also cause a hydration mismatch when the server-rendered HTML
 *    differs from the client's first post-hydration render. The real value
 *    from `localStorage` is read inside a `useEffect`, which only runs
 *    after commit on the client.
 *
 * 2. **`try/catch` fallback.** `localStorage.getItem` can throw
 *    (`SecurityError` in Safari private mode, sandboxed iframes, etc.) and
 *    `JSON.parse` can throw on malformed data. `localStorage.setItem` can
 *    throw on quota exceeded or when storage is disabled. In every case the
 *    hook degrades to in-memory state — the component continues to work,
 *    it just won't persist across reloads.
 *
 * 3. **No cross-tab sync (intentional, deferred).** We do NOT subscribe to
 *    the `window` `storage` event. Two tabs of the same app would otherwise
 *    overwrite each other on every change, which is usually surprising
 *    for sidebar-collapse-style preferences. Cross-tab sync can be added
 *    later as a follow-up behind an opt-in flag.
 *
 * Usage:
 * ```ts
 * const [collapsed, setCollapsed] = useLocalStorage<boolean>(
 *   'inboxpilot:sidebar:collapsed',
 *   false,
 * );
 * ```
 */

import { useCallback, useEffect, useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  // SSR-safe: this is a direct value, not a lazy initializer. The server
  // renders `initialValue`; the client also renders `initialValue` on the
  // first paint. The stored value is applied only after `useEffect` runs.
  const [storedValue, setStoredState] = useState<T>(initialValue);

  // Read the persisted value once, after mount, and merge it into state.
  // Wrapped in try/catch so private-mode browsers and malformed JSON don't
  // crash the component tree.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as T;
      setStoredState(parsed);
    } catch {
      // Either storage is unavailable (SecurityError) or the stored payload
      // is malformed. Fall back to `initialValue` and keep going.
    }
  }, [key]);

  // Setter mirrors React's `useState` shape: it accepts either a direct
  // value or an updater function. We resolve the next value inside
  // `setStoredState` so concurrent updates see a consistent `prev`.
  const setStoredValue = useCallback(
    (value: T | ((prev: T) => T)): void => {
      setStoredState((prev) => {
        const resolved =
          typeof value === 'function'
            ? (value as (prev: T) => T)(prev)
            : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage write failed (quota, disabled, private mode). The
          // in-memory state is still updated, so the UI stays consistent
          // within this tab; the change simply won't survive a reload.
        }
        return resolved;
      });
    },
    [key],
  );

  return [storedValue, setStoredValue];
}
