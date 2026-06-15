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
  signIn: (email: string, password: string, remember?: boolean) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Cookie helpers (for Next.js middleware auth detection)
// ---------------------------------------------------------------------------

function setCookie(token: string, remember: boolean): void {
  try {
    const maxAge = remember ? `; max-age=${60 * 60 * 24 * 7}` : '';
    document.cookie = `insforge_access_token=${encodeURIComponent(token)}; path=/; SameSite=Lax${maxAge}`;
  } catch {
    // ignore
  }
}

function clearCookie(): void {
  try {
    document.cookie = 'insforge_access_token=; path=/; max-age=0; SameSite=Lax';
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

  const signIn = useCallback(async (email: string, password: string, remember = false) => {
    const { data, error } = await insforge.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data) {
      return { error: error?.message ?? 'Sign-in failed' };
    }
    if (data.accessToken) {
      setCookie(data.accessToken, remember);
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
      setCookie(data.accessToken, true);
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
