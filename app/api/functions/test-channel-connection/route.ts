/**
 * POST /api/functions/test-channel-connection
 *
 * Body: { channelType: 'sms' | 'email', providerAccountId: string }
 * Required permission: `manage_settings` on the account's organization.
 *
 * Verifies that a configured SMS or email provider can actually be reached.
 * Replaces the legacy "read the DB row, return {provider, active}" stub with
 * a real per-provider health check (mock / twilio / telnyx / postmark / stubs).
 *
 * Flow:
 *   1. Authenticate the caller via `_auth.ts` (401 if anonymous).
 *   2. Load the provider account from `sms_provider_accounts` or
 *      `email_provider_accounts` (404 if missing).
 *   3. Verify the caller has `manage_settings` on the account's org (403).
 *   4. Resolve the adapter via `createProviderRegistry()` (400 if unknown).
 *   5. Load credentials from InsForge secrets via `getSecret`. The mock
 *      provider short-circuits to an empty config (no remote ping). A 404
 *      from the secrets API surfaces as 422 so the caller knows the account
 *      references a missing secret.
 *   6. Run `healthCheck(adapter, providerConfig)`. The function never
 *      throws — it always returns a `HealthCheckResult` — so we never need
 *      to guard against it bubbling. A defensive try/catch is kept for
 *      programmer-error safety.
 *
 * Response:
 *   200: { status: 'ok', data: { ok, message?, reason?, provider, active } }
 *   401: unauthenticated
 *   403: missing `manage_settings` on the account's org
 *   404: provider account not found
 *   422: credentials secret referenced by the account does not exist
 *   500: unexpected error
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRequestJsonObject } from '@/lib/http-json';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { createProviderRegistry } from '@/lib/provider-registry';
import { getSecret } from '@/lib/insforge-secrets';
import { healthCheck } from '@support-core/health-check';
import type { SmsProviderAdapter } from '@support-core/interfaces/sms-provider-adapter';
import type { EmailProviderAdapter } from '@support-core/interfaces/email-provider-adapter';

type ProviderAdapter = SmsProviderAdapter | EmailProviderAdapter;

interface ProviderAccountRow {
  id: string;
  organization_id: string;
  provider: string;
  is_active: boolean;
  credentials_secret_id: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readRequestJsonObject(req);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const channelType = body.channelType;
    const providerAccountId = body.providerAccountId;
    if (channelType !== 'sms' && channelType !== 'email') {
      return NextResponse.json(
        { error: 'channelType must be "sms" or "email"' },
        { status: 400 },
      );
    }
    if (typeof providerAccountId !== 'string' || !providerAccountId) {
      return NextResponse.json(
        { error: 'providerAccountId is required' },
        { status: 400 },
      );
    }

    // Load the provider account (read-only).
    const table = channelType === 'sms' ? 'sms_provider_accounts' : 'email_provider_accounts';
    const { data: accountRows, error: accountErr } = await insforge.database
      .from(table)
      .select('id, organization_id, provider, is_active, credentials_secret_id')
      .eq('id', providerAccountId)
      .limit(1);

    if (accountErr) {
      return NextResponse.json({ error: accountErr.message }, { status: 500 });
    }

    const acct = (Array.isArray(accountRows) ? accountRows[0] : accountRows) as
      | ProviderAccountRow
      | undefined;
    if (!acct) {
      return NextResponse.json({ error: 'Provider account not found' }, { status: 404 });
    }

    // RBAC: caller must have `manage_settings` on the account's org.
    const allowed = await userHasOrgPermission(
      user.id,
      acct.organization_id,
      'manage_settings',
    );
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Resolve the adapter via the shared registry (returns a fresh registry
    // per call — no module-level state).
    const registry = createProviderRegistry();
    let adapter: ProviderAdapter;
    try {
      adapter =
        channelType === 'sms'
          ? registry.getSmsAdapter(acct.provider)
          : registry.getEmailAdapter(acct.provider);
    } catch {
      return NextResponse.json(
        { error: `Unknown provider: ${acct.provider}` },
        { status: 400 },
      );
    }

    // Load credentials. Mock has no secret — short-circuit to {} so
    // healthCheck can return its `Mock provider (no remote ping)` result
    // without us having to persist a fake secret row.
    let providerConfig: Record<string, unknown> = {};
    if (acct.provider !== 'mock') {
      const secret = await getSecret<Record<string, unknown>>(acct.credentials_secret_id);
      if (secret === null) {
        return NextResponse.json(
          { error: `Credentials secret not found: ${acct.credentials_secret_id}` },
          { status: 422 },
        );
      }
      providerConfig = secret;
    }

    // healthCheck never throws (per its contract); the try/catch is purely
    // defensive in case a future contributor changes that contract.
    const result = await healthCheck(adapter, providerConfig);

    return NextResponse.json({
      status: 'ok',
      data: {
        ok: result.ok,
        ...(result.message !== undefined && { message: result.message }),
        ...(result.reason !== undefined && { reason: result.reason }),
        provider: acct.provider,
        active: acct.is_active,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
