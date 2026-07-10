import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSecret: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  publishRealtimeMessage: vi.fn(),
  createProviderRegistry: vi.fn(),
  createInsforgeDbAdapter: vi.fn(),
  sendReply: vi.fn(),
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
}));
vi.mock('@/lib/insforge-secrets', () => ({ getSecret: mocks.getSecret }));
vi.mock('@/lib/realtime-publisher', () => ({
  publishRealtimeMessage: mocks.publishRealtimeMessage,
}));
vi.mock('@/lib/provider-registry', () => ({
  createProviderRegistry: mocks.createProviderRegistry,
}));
vi.mock('@/app/api/functions/_auth', () => ({
  getUserFromToken: mocks.getUserFromToken,
  userHasOrgPermission: mocks.userHasOrgPermission,
}));
vi.mock('@/app/api/functions/_insforge-db-adapter', () => ({
  createInsforgeDbAdapter: mocks.createInsforgeDbAdapter,
}));
vi.mock('@support-core/services/outbound-message-service', () => ({
  OutboundMessageService: class {
    sendReply = mocks.sendReply;
  },
}));

import { POST } from '../../app/api/functions/approve-ai-draft/route';

interface Scenario {
  channel: 'sms' | 'email' | 'webchat';
  tableData: Record<string, unknown>;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: unknown }>;
  claimAvailable: boolean;
  idleUpdateFailuresRemaining: number;
}

let scenario: Scenario;

function createBuilder(table: string) {
  let operation: 'select' | 'update' | 'insert' = 'select';

  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.update.mockImplementation((values: Record<string, unknown>) => {
      operation = 'update';
      scenario.updates.push({ table, values });
      return builder;
    });
  builder.insert.mockImplementation((values: unknown) => {
      operation = 'insert';
      scenario.inserts.push({ table, values });
      return builder;
    });
  builder.then.mockImplementation((onfulfilled, onrejected) => {
      const latestUpdate = scenario.updates.at(-1);
      const idleUpdateFailed = operation === 'update'
        && latestUpdate?.values.ai_state === 'idle'
        && scenario.idleUpdateFailuresRemaining > 0;
      if (idleUpdateFailed) scenario.idleUpdateFailuresRemaining -= 1;
      const result = operation === 'select'
        ? { data: scenario.tableData[table] ?? null, error: null }
        : idleUpdateFailed
          ? { data: null, error: { message: 'transient conversation update failure' } }
        : operation === 'update' && latestUpdate?.values.ai_state === 'thinking'
          ? { data: scenario.claimAvailable ? [{ id: 'conversation-1' }] : [], error: null }
          : { data: null, error: null };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    });

  return builder;
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/functions/approve-ai-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function configureScenario(channel: Scenario['channel']): void {
  scenario = {
    channel,
    tableData: {
      ai_decisions: [{ id: 'decision-1', response_text: 'Draft response' }],
      conversations: [{
        id: 'conversation-1',
        organization_id: 'org-1',
        channel,
      }],
    },
    updates: [],
    inserts: [],
    claimAvailable: true,
    idleUpdateFailuresRemaining: 0,
  };

  if (channel === 'sms') {
    scenario.tableData.sms_phone_numbers = [{ provider_account_id: 'sms-account-1' }];
    scenario.tableData.sms_provider_accounts = [{
      provider: 'twilio',
      credentials_secret_id: 'twilio-secret',
      is_active: true,
    }];
  } else if (channel === 'email') {
    scenario.tableData.email_addresses = [{ provider_account_id: 'email-account-1' }];
    scenario.tableData.email_provider_accounts = [{
      provider: 'postmark',
      credentials_secret_id: 'postmark-secret',
      is_active: true,
    }];
  } else {
    scenario.tableData.webchat_threads = [{
      widget_id: 'widget-1',
      visitor_token_jti: 'visitor-jti-1',
    }];
  }
}

const SENT_MESSAGE = {
  id: 'message-1',
  conversationId: 'conversation-1',
  senderType: 'ai',
  senderId: 'user-1',
  channel: 'sms',
  body: 'Edited response',
};

describe('approve-ai-draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureScenario('sms');
    mocks.from.mockImplementation((table: string) => createBuilder(table));
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    mocks.getSecret.mockResolvedValue({ accountSid: 'AC123', authToken: 'secret' });
    mocks.createProviderRegistry.mockReturnValue({});
    mocks.createInsforgeDbAdapter.mockReturnValue({});
    mocks.sendReply.mockResolvedValue(SENT_MESSAGE);
  });

  it('dispatches an approved SMS draft through the outbound service with credentials', async () => {
    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
      body: 'Edited response',
    }));

    expect(response.status).toBe(200);
    expect(mocks.getSecret).toHaveBeenCalledWith('twilio-secret');
    expect(mocks.sendReply).toHaveBeenCalledWith(
      'conversation-1',
      'Edited response',
      { type: 'ai', id: 'user-1' },
      { accountSid: 'AC123', authToken: 'secret' },
      { writeAuditLog: false },
    );
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'idle' },
    });
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'thinking' },
    });
  });

  it('loads the configured email provider credentials before dispatch', async () => {
    configureScenario('email');
    mocks.getSecret.mockResolvedValue({ serverToken: 'postmark-token' });

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(200);
    expect(mocks.getSecret).toHaveBeenCalledWith('postmark-secret');
    expect(mocks.sendReply).toHaveBeenCalledWith(
      'conversation-1',
      'Draft response',
      { type: 'ai', id: 'user-1' },
      { serverToken: 'postmark-token' },
      { writeAuditLog: false },
    );
  });

  it('keeps the draft pending when provider dispatch fails', async () => {
    mocks.sendReply.mockRejectedValue(new Error('Twilio rejected the message'));

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Twilio rejected the message' });
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'drafted' },
    });
    expect(scenario.inserts).not.toContainEqual(
      expect.objectContaining({ table: 'audit_logs' }),
    );
  });

  it('retries the final state transition after delivery instead of stranding the claim', async () => {
    scenario.idleUpdateFailuresRemaining = 1;

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(200);
    expect(scenario.updates.filter(
      ({ values }) => values.ai_state === 'idle',
    )).toHaveLength(2);
  });

  it('preserves webchat realtime delivery without loading provider secrets', async () => {
    configureScenario('webchat');
    const webchatMessage = { ...SENT_MESSAGE, channel: 'webchat' };
    mocks.sendReply.mockResolvedValue(webchatMessage);

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(200);
    expect(mocks.getSecret).not.toHaveBeenCalled();
    expect(mocks.sendReply).toHaveBeenCalledWith(
      'conversation-1',
      'Draft response',
      { type: 'ai', id: 'user-1' },
      {},
      { writeAuditLog: false },
    );
    expect(mocks.publishRealtimeMessage).toHaveBeenCalledWith(
      'widget:widget-1:visitor-jti-1',
      'new_message',
      { message: webchatMessage, conversationId: 'conversation-1' },
    );
  });

  it('rejects a duplicate approval before dispatching it', async () => {
    scenario.claimAvailable = false;

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(409);
    expect(mocks.sendReply).not.toHaveBeenCalled();
  });
});
