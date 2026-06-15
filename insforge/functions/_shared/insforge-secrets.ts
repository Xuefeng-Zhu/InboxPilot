/**
 * InsForge Secrets API client (Deno runtime).
 *
 * Thin wrapper around the canonical implementation in support-core.
 * Injects `baseUrl` and `serviceRoleKey` as parameters per the
 * Deno-safety convention (no `Deno.env.get()` inside the function body),
 * mirroring `_shared/create-db-client.ts` and `_shared/create-realtime-publisher.ts`.
 *
 * For error model and usage see: packages/support-core/src/utils/insforge-secrets.ts
 */

export { getSecretRaw, getSecret } from '../../../packages/support-core/src/utils/insforge-secrets.ts';