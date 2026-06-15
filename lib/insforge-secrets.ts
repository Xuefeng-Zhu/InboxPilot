/**
 * InsForge Secrets API client (Node runtime).
 *
 * Thin wrapper around the canonical implementation in support-core.
 * Reads config from `process.env` (Next.js runtime) and delegates.
 *
 * For error model and usage see: packages/support-core/src/utils/insforge-secrets.ts
 */

import { getSecret as getSecretCore, getSecretRaw as getSecretRawCore } from '@support-core/utils';

const INSFORGE_URL_ENV = 'NEXT_PUBLIC_INSFORGE_URL';
const INSFORGE_KEY_ENV = 'INSFORGE_SERVICE_ROLE_KEY';

function getConfig(): { baseUrl: string; serviceRoleKey: string } {
  const baseUrl = process.env[INSFORGE_URL_ENV];
  const serviceRoleKey = process.env[INSFORGE_KEY_ENV];
  if (!baseUrl) {
    throw new Error(`getSecret: ${INSFORGE_URL_ENV} not set`);
  }
  if (!serviceRoleKey) {
    throw new Error(`getSecret: ${INSFORGE_KEY_ENV} not set`);
  }
  return { baseUrl, serviceRoleKey };
}

export async function getSecretRaw(secretId: string): Promise<string | null> {
  const { baseUrl, serviceRoleKey } = getConfig();
  return getSecretRawCore(secretId, baseUrl, serviceRoleKey);
}

export async function getSecret<T = unknown>(secretId: string): Promise<T | null> {
  const { baseUrl, serviceRoleKey } = getConfig();
  return getSecretCore<T>(secretId, baseUrl, serviceRoleKey);
}