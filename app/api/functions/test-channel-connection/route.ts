import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { channelType, providerAccountId } = await req.json();
    if (!channelType || !providerAccountId) {
      return NextResponse.json({ error: 'Missing channelType or providerAccountId' }, { status: 400 });
    }

    const table = channelType === 'sms' ? 'sms_provider_accounts' : 'email_provider_accounts';
    const { data: account } = await insforge.database
      .from(table)
      .select('id,organization_id,provider,is_active')
      .eq('id', providerAccountId)
      .limit(1);

    const acct = Array.isArray(account) ? account[0] : account;
    if (!acct) return NextResponse.json({ error: 'Provider account not found' }, { status: 404 });

    const allowed = await userHasOrgPermission(
      user.id,
      acct.organization_id as string,
      'manage_settings',
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json({ status: 'ok', data: { provider: acct.provider, active: acct.is_active } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
