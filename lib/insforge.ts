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
 * Browser / client-side InsForge client.
 * Uses the public anon key — safe to expose in the browser.
 */
export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: INSFORGE_ANON_KEY,
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
    // Read from cookie
    const match = document.cookie.match(/insforge_access_token=([^;]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
