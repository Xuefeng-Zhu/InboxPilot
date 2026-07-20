import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@insforge/sdk';

const RUN_LIVE = process.env.INBOXPILOT_LIVE_INTEGRATION === '1';
const PRODUCTION_HOST = 'https://y39ezar3.us-east.insforge.app';

interface LinkedProject {
  project_name?: string;
  oss_host?: string;
  api_key?: string;
  branched_from?: { project_id?: string };
}

function loadDisposableProject(): Required<Pick<LinkedProject, 'oss_host' | 'api_key'>> {
  const project = JSON.parse(
    readFileSync(resolve(process.cwd(), '.insforge/project.json'), 'utf8'),
  ) as LinkedProject;
  if (
    !project.branched_from?.project_id ||
    !project.project_name?.startsWith('qa-') ||
    !project.oss_host ||
    !project.api_key ||
    project.oss_host === PRODUCTION_HOST
  ) {
    throw new Error(
      'Live RLS tests require a linked disposable qa-* InsForge branch; refusing to mutate the current project.',
    );
  }
  return { oss_host: project.oss_host, api_key: project.api_key };
}

describe.skipIf(!RUN_LIVE)('Integration: RLS Policy — Two-Org Isolation', () => {
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const contactA = randomUUID();
  const contactB = randomUUID();
  const conversationB = randomUUID();
  const messageB = randomUUID();
  const auditA = randomUUID();
  const smsAccountA = randomUUID();
  const suffix = Date.now().toString(36);
  const password = `Qa-${suffix}-secure!`;

  let baseUrl: string;
  let adminKey: string;
  let clientA: ReturnType<typeof createClient>;
  let clientB: ReturnType<typeof createClient>;

  async function adminRequest(
    table: string,
    method: 'POST' | 'DELETE',
    body?: Array<Record<string, unknown>>,
    query = '',
  ): Promise<unknown> {
    const response = await fetch(`${baseUrl}/api/database/records/${table}${query}`, {
      method,
      headers: {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`Admin ${method} ${table} failed with HTTP ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  }

  beforeAll(async () => {
    ({ oss_host: baseUrl, api_key: adminKey } = loadDisposableProject());
    clientA = createClient({ baseUrl });
    clientB = createClient({ baseUrl });

    const [signupA, signupB] = await Promise.all([
      clientA.auth.signUp({
        email: `qa-rls-${suffix}-a@example.invalid`,
        password,
        name: 'QA RLS A',
      }),
      clientB.auth.signUp({
        email: `qa-rls-${suffix}-b@example.invalid`,
        password,
        name: 'QA RLS B',
      }),
    ]);
    if (signupA.error || !signupA.data?.user) throw new Error('Could not create QA RLS user A');
    if (signupB.error || !signupB.data?.user) throw new Error('Could not create QA RLS user B');

    await adminRequest('organizations', 'POST', [
      { id: organizationA, name: 'QA RLS A', slug: `qa-rls-a-${suffix}` },
      { id: organizationB, name: 'QA RLS B', slug: `qa-rls-b-${suffix}` },
    ]);
    await adminRequest('organization_members', 'POST', [
      { organization_id: organizationA, user_id: signupA.data.user.id, role: 'owner' },
      { organization_id: organizationB, user_id: signupB.data.user.id, role: 'owner' },
    ]);
    await adminRequest('contacts', 'POST', [
      { id: contactA, organization_id: organizationA, name: 'QA Contact A' },
      { id: contactB, organization_id: organizationB, name: 'QA Contact B' },
    ]);
    await adminRequest('conversations', 'POST', [{
      id: conversationB,
      organization_id: organizationB,
      contact_id: contactB,
      channel: 'sms',
      status: 'open',
      ai_state: 'idle',
      subject: 'Org B private conversation',
    }]);
    await adminRequest('messages', 'POST', [{
      id: messageB,
      conversation_id: conversationB,
      sender_type: 'contact',
      direction: 'inbound',
      channel: 'sms',
      body: 'Org B private message',
    }]);
    await adminRequest('audit_logs', 'POST', [{
      id: auditA,
      organization_id: organizationA,
      actor_type: 'system',
      action: 'qa_rls_probe',
      resource_type: 'organization',
      resource_id: organizationA,
    }]);
    await adminRequest('sms_provider_accounts', 'POST', [{
      id: smsAccountA,
      organization_id: organizationA,
      provider: 'mock',
      label: 'QA Provider',
      credentials_secret_id: `qa-secret-${suffix}`,
    }]);
  }, 30_000);

  afterAll(async () => {
    if (!baseUrl || !adminKey) return;
    await adminRequest(
      'organizations',
      'DELETE',
      undefined,
      `?id=in.(${organizationA},${organizationB})`,
    );
  }, 30_000);

  it.each([
    ['conversations', 'organization_id', organizationB],
    ['contacts', 'organization_id', organizationB],
  ] as const)('user in org A cannot select org B %s', async (table, column, value) => {
    const result = await clientA.database.from(table).select('id').eq(column, value);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('user in org A cannot select org B messages through a private conversation', async () => {
    const result = await clientA.database
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationB);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('user in org A cannot insert a conversation for org B', async () => {
    const result = await clientA.database.from('conversations').insert([{
      organization_id: organizationB,
      contact_id: contactB,
      channel: 'sms',
      status: 'open',
      ai_state: 'idle',
    }]);
    expect(result.error).not.toBeNull();
  });

  it('user in org A cannot update a conversation belonging to org B', async () => {
    const result = await clientA.database
      .from('conversations')
      .update({ subject: 'Cross-tenant update' })
      .eq('id', conversationB)
      .select('id');
    expect(result.data ?? []).toHaveLength(0);

    const ownerView = await clientB.database
      .from('conversations')
      .select('subject')
      .eq('id', conversationB)
      .limit(1);
    expect(ownerView.data?.[0]?.subject).toBe('Org B private conversation');
  });

  it('user in org A cannot delete a contact belonging to org B', async () => {
    const result = await clientA.database
      .from('contacts')
      .delete()
      .eq('id', contactB)
      .select('id');
    expect(result.data ?? []).toHaveLength(0);

    const ownerView = await clientB.database
      .from('contacts')
      .select('id')
      .eq('id', contactB)
      .limit(1);
    expect(ownerView.data?.[0]?.id).toBe(contactB);
  });

  it('audit logs reject update and delete operations', async () => {
    const update = await clientA.database
      .from('audit_logs')
      .update({ action: 'tampered' })
      .eq('id', auditA)
      .select('id');
    const deletion = await clientA.database
      .from('audit_logs')
      .delete()
      .eq('id', auditA)
      .select('id');
    expect(update.data ?? []).toHaveLength(0);
    expect(deletion.data ?? []).toHaveLength(0);

    const persisted = await clientA.database
      .from('audit_logs')
      .select('id,action')
      .eq('id', auditA)
      .limit(1);
    expect(persisted.data?.[0]).toMatchObject({ id: auditA, action: 'qa_rls_probe' });
  });

  it('provider credential references are excluded from authenticated reads', async () => {
    const safe = await clientA.database
      .from('sms_provider_accounts')
      .select('id,provider,label,is_active,metadata')
      .eq('id', smsAccountA)
      .limit(1);
    const secret = await clientA.database
      .from('sms_provider_accounts')
      .select('id,credentials_secret_id')
      .eq('id', smsAccountA)
      .limit(1);

    expect(safe.error).toBeNull();
    expect(safe.data?.[0]?.id).toBe(smsAccountA);
    expect(secret.error).not.toBeNull();
  });
});
