/**
 * test-channel-connection — Tests a provider account connection.
 *
 * Auth: JWT verification (Bearer token in Authorization header).
 *
 * Flow:
 * 1. Parse request body as JSON — expect { channelType, providerAccountId }
 * 2. Verify JWT authentication — return 401 if invalid
 * 3. Look up the provider account and verify it exists and is active
 * 4. Return success/failure result
 *
 * Requirements: 16.1, 20.5
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { log, logError, newRequestContext, withRequest, withRequestIdHeader } from '../_shared/logger.js';
import { verifyJwt } from '../_shared/verify-jwt.js';

// ---------------------------------------------------------------------------
// Helper: JSON response builder
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  const ctx = newRequestContext('test-channel-connection', req);
  try {
    const response = await withRequest(ctx, async () => {
      // 1. Parse request body
      let payload: { channelType?: string; providerAccountId?: string };
      try {
        payload = await req.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const { channelType, providerAccountId } = payload;

      if (!channelType || !['sms', 'email'].includes(channelType)) {
        return jsonResponse({ error: 'Missing or invalid channelType (must be "sms" or "email")' }, 400);
      }

      if (!providerAccountId || typeof providerAccountId !== 'string') {
        return jsonResponse({ error: 'Missing or invalid providerAccountId' }, 400);
      }

      // 2. Verify JWT authentication
      const baseUrl =
        (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
        process.env.NEXT_PUBLIC_INSFORGE_URL ??
        '';
      const serviceRoleKey =
        (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
        process.env.INSFORGE_SERVICE_ROLE_KEY ??
        '';

      const verifiedUser = await verifyJwt(req, baseUrl, serviceRoleKey);
      if (!verifiedUser) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      ctx.user_id = verifiedUser.userId;

      // 3. Look up the provider account
      const db = createDbClient(baseUrl, serviceRoleKey);

      const table = channelType === 'sms' ? 'sms_provider_accounts' : 'email_provider_accounts';

      const { data: account, error: queryError } = await db
        .from(table)
        .select('id,organization_id,provider,label,is_active')
        .eq('id', providerAccountId)
        .maybeSingle();

      if (queryError) {
        return jsonResponse(
          { error: 'Failed to look up provider account', details: queryError.message },
          500,
        );
      }

      if (!account) {
        return jsonResponse({ error: 'Provider account not found' }, 404);
      }

      const acct = account as { id: string; organization_id: string; provider: string; label: string; is_active: boolean };
      if (acct.organization_id) ctx.org_id = acct.organization_id;

      // 4. Verify the account is active
      if (!acct.is_active) {
        log({ ...ctx, level: 'warn', msg: 'test-channel-connection: account inactive', provider_account_id: acct.id, provider: acct.provider });
        return jsonResponse({
          status: 'error',
          error: 'Provider account is inactive',
          provider: acct.provider,
          label: acct.label,
        });
      }

      // For now, verifying the account exists and is active constitutes a successful test.
      // Future: actually ping the provider API to verify credentials.
      log({ ...ctx, level: 'info', msg: 'test-channel-connection ok', provider_account_id: acct.id, provider: acct.provider });
      return jsonResponse({
        status: 'ok',
        provider: acct.provider,
        label: acct.label,
        message: `Connection to ${acct.provider} account "${acct.label}" is active`,
      });
    });
    return withRequestIdHeader(ctx, response);
  } catch (err) {
    return jsonResponse(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
}
