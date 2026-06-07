/**
 * Server-side InsForge client using the service role key.
 * Bypasses RLS — only use in API routes and server components.
 */
import { createClient } from '@insforge/sdk';

export const insforgeAdmin = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? '',
  anonKey: process.env.INSFORGE_SERVICE_ROLE_KEY ?? '',
});
