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
// Storage helpers (access token persistence)
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'insforge_access_token';
const REFRESH_KEY = 'insforge_refresh_token';

function persistTokens(access: string, refresh: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    // Also set a cookie so the Next.js middleware can detect auth state
    document.cookie = `insforge_access_token=${access}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  } catch {
    // SSR or storage unavailable — ignore
  }
}

function clearTokens(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    // Clear the auth cookie
    document.cookie =
      'insforge_access_token=; path=/; max-age=0; SameSite=Lax';
  } catch {
    // ignore
  }
}

function loadAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  // Hydrate session from persisted token on mount
  useEffect(() => {
    const token = loadAccessToken();
    if (!token) {
      setState({ user: null, loading: false });
      return;
    }
    insforge.setAccessToken(token);
    insforge.getUser().then(({ data, error }) => {
      if (error || !data) {
        clearTokens();
        insforge.setAccessToken(null);
        setState({ user: null, loading: false });
      } else {
        setState({ user: data, loading: false });
      }
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.signIn(email, password);
    if (error || !data) {
      return { error: error?.message ?? 'Sign-in failed' };
    }
    persistTokens(data.access_token, data.refresh_token);
    setState({ user: data.user, loading: false });
    return { error: null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.signUp(email, password);
    if (error || !data) {
      return { error: error?.message ?? 'Sign-up failed' };
    }
    persistTokens(data.access_token, data.refresh_token);
    setState({ user: data.user, loading: false });
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await insforge.signOut();
    clearTokens();
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
