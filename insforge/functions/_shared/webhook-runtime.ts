type DenoGlobal = {
  env?: {
    get(key: string): string | undefined;
  };
};

type ProcessGlobal = {
  env?: Record<string, string | undefined>;
};

export interface WebhookRuntimeConfig {
  baseUrl: string;
  serviceRoleKey: string;
  localMockOptIn: string | undefined;
}

function getRuntimeEnv(key: string): string | undefined {
  const deno = (globalThis as { Deno?: DenoGlobal }).Deno;
  const denoValue = deno?.env?.get(key);
  if (denoValue !== undefined) {
    return denoValue;
  }

  const processGlobal = (globalThis as { process?: ProcessGlobal }).process;
  return processGlobal?.env?.[key];
}

/**
 * Reads the common webhook configuration once so every handler supports the
 * same production and local-development environment aliases.
 */
export function getWebhookRuntimeConfig(): WebhookRuntimeConfig {
  return {
    baseUrl: getRuntimeEnv('INSFORGE_BASE_URL') ??
      getRuntimeEnv('NEXT_PUBLIC_INSFORGE_URL') ??
      '',
    serviceRoleKey: getRuntimeEnv('INSFORGE_SERVICE_ROLE_KEY') ??
      getRuntimeEnv('SERVICE_ROLE_KEY') ??
      '',
    localMockOptIn: getRuntimeEnv('INBOXPILOT_ALLOW_LOCAL_MOCK_WEBHOOKS'),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
