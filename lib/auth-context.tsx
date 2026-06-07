'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { insforge, type InsForgeUser } from '@/lib/insforge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthState {
  user: InsForgeUser | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Cookie helpers (for Next.js middleware auth detection)
//
// Cookie flags (HIGH-5, docs/QA_BUG_HUNT.md):
//   * `SameSite=Strict` — strictest available; cookie is not sent on any
//     cross-origin navigation, neutralizing most CSRF risk on this token.
//   * `Secure` — added on HTTPS origins only. We cannot unconditionally set
//     `Secure` because local dev runs on `http://localhost:3000` and a
//     Secure cookie set over HTTP is silently dropped by the browser, which
//     would break sign-in during development. In production, the origin is
//     HTTPS and `Secure` is applied.
//   * `HttpOnly` is INTENTIONALLY NOT SET. The client reads this cookie via
//     `getAccessToken()` (lib/insforge.ts) to attach a bearer header when
//     invoking serverless functions. HttpOnly would block that read and is
//     a deferred launch item — the long-term fix is a server-side proxy
//     (Next.js API routes) that reads the cookie server-side and forwards
//     the bearer, letting us flip HttpOnly on. See HIGH-5 in QA_BUG_HUNT.md
//     and the `insforge_access_token` entry in docs/DEVELOPMENT.md.
// ---------------------------------------------------------------------------

/**
 * Build the attribute string for the `insforge_access_token` cookie.
 *
 * Pure function — no `document` / `window` access — so it is unit-testable
 * under the default `node` test environment.
 *
 * @param isSecureOrigin  Pass `true` when the cookie is being set on an
 *                        HTTPS origin (i.e. production). Pass `false` for
 *                        local dev over plain HTTP, where a `Secure` flag
 *                        would be ignored and would also prevent the cookie
 *                        from being stored.
 */
export function buildCookieAttributes(isSecureOrigin: boolean): string {
  // SameSite=Strict is always safe: the cookie is only ever read on the
  // same origin that set it (the InsPilot app), and the strictest possible
  // value is the most defensive against CSRF / cross-origin exfil.
  return [
    'path=/',
    `SameSite=Strict`,
    ...(isSecureOrigin ? ['Secure'] : []),
  ].join('; ');
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function isSecureContext(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
  } catch {
    return false;
  }
}

function setCookie(token: string): void {
  try {
    const attrs = buildCookieAttributes(isSecureContext());
    document.cookie = `insforge_access_token=${token}; ${attrs}; max-age=${COOKIE_MAX_AGE_SECONDS}`;
  } catch {
    // ignore
  }
}

function clearCookie(): void {
  try {
    const attrs = buildCookieAttributes(isSecureContext());
    document.cookie = `insforge_access_token=; ${attrs}; max-age=0`;
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  // Hydrate session on mount
  useEffect(() => {
    insforge.auth.getCurrentUser().then(({ data, error }) => {
      if (error || !data?.user) {
        clearCookie();
        setState({ user: null, loading: false });
      } else {
        setState({ user: data.user as InsForgeUser, loading: false });
      }
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data) {
      return { error: error?.message ?? 'Sign-in failed' };
    }
    if (data.accessToken) {
      setCookie(data.accessToken);
    }
    setState({ user: data.user as InsForgeUser, loading: false });
    return { error: null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signUp({
      email,
      password,
    });
    if (error || !data) {
      return { error: error?.message ?? 'Sign-up failed' };
    }
    if (data.accessToken) {
      setCookie(data.accessToken);
      setState({ user: data.user as InsForgeUser, loading: false });
    }
    // If email verification is required, user won't have an accessToken yet
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await insforge.auth.signOut();
    clearCookie();
    setState({ user: null, loading: false });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signUp, signOut }),
    [state, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
