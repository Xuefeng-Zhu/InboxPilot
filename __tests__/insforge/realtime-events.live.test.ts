import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
      'Live realtime tests require a linked disposable qa-* InsForge branch; refusing to mutate the current project.',
    );
  }
  return { oss_host: project.oss_host, api_key: project.api_key };
}

describe.skipIf(!RUN_LIVE)('Integration: Realtime Event Publishing', () => {
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const suffix = Date.now().toString(36);
  const password = `Qa-${suffix}-secure!`;

  let baseUrl: string;
  let adminKey: string;
  let clientA: ReturnType<typeof createClient>;
  let clientB: ReturnType<typeof createClient>;
  let adminClient: ReturnType<typeof createClient>;

  async function adminRequest(
    table: string,
    method: 'POST' | 'DELETE',
    body?: Array<Record<string, unknown>>,
    query = '',
  ): Promise<void> {
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
  }

  async function publish(event: string, payload: Record<string, unknown>): Promise<void> {
    const result = await adminClient.database.rpc('publish_realtime_message', {
      p_channel_name: `org:${organizationA}`,
      p_event_name: event,
      p_payload: payload,
    });
    if (result.error) throw new Error(`Realtime publish failed: ${result.error.message}`);
  }

  async function receiveEvent(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => {
        clientA.realtime.off(event, handler);
        reject(new Error(`Timed out waiting for ${event}`));
      }, 5_000);
      const handler = (received: Record<string, unknown>) => {
        if (received.probe !== payload.probe) return;
        clearTimeout(timeout);
        clientA.realtime.off(event, handler);
        resolveEvent(received);
      };
      clientA.realtime.on(event, handler);
      void publish(event, payload).catch((error: unknown) => {
        clearTimeout(timeout);
        clientA.realtime.off(event, handler);
        reject(error);
      });
    });
  }

  beforeAll(async () => {
    ({ oss_host: baseUrl, api_key: adminKey } = loadDisposableProject());
    clientA = createClient({ baseUrl });
    clientB = createClient({ baseUrl });
    adminClient = createClient({ baseUrl, anonKey: adminKey });

    const [signupA, signupB] = await Promise.all([
      clientA.auth.signUp({
        email: `qa-events-${suffix}-a@example.invalid`,
        password,
        name: 'QA Events A',
      }),
      clientB.auth.signUp({
        email: `qa-events-${suffix}-b@example.invalid`,
        password,
        name: 'QA Events B',
      }),
    ]);
    if (signupA.error || !signupA.data?.user) throw new Error('Could not create QA realtime user A');
    if (signupB.error || !signupB.data?.user) throw new Error('Could not create QA realtime user B');

    await adminRequest('organizations', 'POST', [
      { id: organizationA, name: 'QA Events A', slug: `qa-events-a-${suffix}` },
      { id: organizationB, name: 'QA Events B', slug: `qa-events-b-${suffix}` },
    ]);
    await adminRequest('organization_members', 'POST', [
      { organization_id: organizationA, user_id: signupA.data.user.id, role: 'owner' },
      { organization_id: organizationB, user_id: signupB.data.user.id, role: 'owner' },
    ]);

    await Promise.all([clientA.realtime.connect(), clientB.realtime.connect()]);
    const [subscriptionA, subscriptionB] = await Promise.all([
      clientA.realtime.subscribe(`org:${organizationA}`),
      clientB.realtime.subscribe(`org:${organizationB}`),
    ]);
    if (!subscriptionA.ok || !subscriptionB.ok) {
      throw new Error('Could not subscribe QA users to their own organization channels');
    }
  }, 30_000);

  afterAll(async () => {
    clientA?.realtime.disconnect();
    clientB?.realtime.disconnect();
    if (!baseUrl || !adminKey) return;
    await adminRequest(
      'organizations',
      'DELETE',
      undefined,
      `?id=in.(${organizationA},${organizationB})`,
    );
  }, 30_000);

  it.each([
    'new_message',
    'conversation_updated',
    'knowledge_document_updated',
  ])('delivers %s payloads to an authenticated organization subscriber', async (event) => {
    const payload = { probe: randomUUID(), organizationId: organizationA };
    await expect(receiveEvent(event, payload)).resolves.toMatchObject(payload);
  });

  it('does not leak an organization event to another organization channel', async () => {
    const payload = { probe: randomUUID(), organizationId: organizationA };
    const crossOrgHandler = vi.fn();
    clientB.realtime.on('conversation_updated', crossOrgHandler);
    try {
      await expect(receiveEvent('conversation_updated', payload)).resolves.toMatchObject(payload);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      expect(crossOrgHandler).not.toHaveBeenCalled();
    } finally {
      clientB.realtime.off('conversation_updated', crossOrgHandler);
    }
  });
});
