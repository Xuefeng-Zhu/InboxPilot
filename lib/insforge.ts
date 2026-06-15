/**
 * InsForge client — uses the official @insforge/sdk.
 *
 * Environment variables:
 *   NEXT_PUBLIC_INSFORGE_URL      – InsForge project base URL
 *   NEXT_PUBLIC_INSFORGE_ANON_KEY – InsForge anonymous/public API key
 */

import { createClient } from '@insforge/sdk';

const INSFORGE_URL = process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
const INSFORGE_ANON_KEY = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '';

/**
 * Custom fetch wrapper for the InsForge SDK.
 *
 * The SDK auto-refreshes the access token on 401 (via the httpOnly refresh
 * cookie) and stores the new token in memory only — it does NOT update the
 * `insforge_access_token` cookie our app reads via `getAccessToken()`. After
 * ~15 minutes, the cookie is stale, the next API route call gets 401 from
 * `_auth.ts`, and the team panel (and any other cookie-authed route) falls
 * back to truncated user IDs.
 *
 * We intercept the `/api/auth/refresh` response and mirror the new access
 * token into the cookie. CSRF cookie is also mirrored (set by InsForge on
 * refresh, read by the SDK on subsequent authed calls).
 */
function withCookieSync(originalFetch: typeof fetch): typeof fetch {
  return async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await originalFetch(input, init);
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const isRefresh = url.includes('/api/auth/refresh');
      if (isRefresh && response.ok) {
        // Clone before reading — the SDK caller still needs the original.
        const clone = response.clone();
        const body = (await clone.json()) as { accessToken?: unknown };
        if (typeof body.accessToken === 'string' && body.accessToken) {
          // URL-encode the token (JWT base64url chars like . / + = are unsafe
          // inside a cookie value) and use a session cookie (no max-age) so
          // its lifetime tracks the browser session, not 7 days past expiry.
          // The SDK auto-refreshes the in-memory token on 401 and re-enters
          // this block to re-mirror the cookie — no long-lived client cookie
          // is needed.
          const encodedToken = encodeURIComponent(body.accessToken);
          document.cookie = `insforge_access_token=${encodedToken}; path=/; SameSite=Lax`;
        }
        // Mirror any Set-Cookie headers InsForge sent (notably the refreshed
        // CSRF token). Multiple Set-Cookie headers must be set individually
        // via document.cookie — concat and split on the standard separator.
        const setCookies = response.headers.getSetCookie?.() ?? [];
        for (const raw of setCookies) {
          const [pair] = raw.split(';');
          if (!pair) continue;
          // Preserve all attributes (Path, SameSite, Max-Age, Expires, etc.)
          // from the original — do NOT strip Max-Age/Expires, otherwise a
          // server-issued long-lived CSRF cookie is silently downgraded to a
          // session cookie on the client.
          const attrs = raw
            .split(';')
            .slice(1)
            .map((s) => s.trim())
            .join('; ');
          // Refresh cookie is HttpOnly — document.cookie can't set/clear it,
          // so skip HttpOnly entries.
          if (/HttpOnly/i.test(attrs)) continue;
          document.cookie = `${pair}; ${attrs}`;
        }
      }
    } catch {
      // Best-effort: never let a cookie-sync failure break a real request.
    }
    return response;
  };
}

/**
 * Browser / client-side InsForge client.
 * Uses the public anon key — safe to expose in the browser.
 */
export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: INSFORGE_ANON_KEY,
  fetch: typeof window !== 'undefined' ? withCookieSync(globalThis.fetch.bind(globalThis)) : undefined,
});

// Re-export types that components use
export type InsForgeUser = {
  id: string;
  email: string;
  emailVerified?: boolean;
  providers?: string[];
  createdAt?: string;
  updatedAt?: string;
  profile?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Get the current access token for manual fetch calls (e.g., function invocations). */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    // Read from cookie. The stored value is URL-encoded (see
    // withCookieSync) — decode it back to the raw JWT.
    const match = document.cookie.match(/insforge_access_token=([^;]+)/);
    const raw = match?.[1];
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      // Legacy value written before URL-encoding was added — return as-is.
      return raw;
    }
  } catch {
    return null;
  }
}
