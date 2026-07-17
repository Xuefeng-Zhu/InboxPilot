import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  PostDispatchError: class extends Error {
    readonly dispatchedMessage;
    readonly stage;
    readonly receipt = {
      channel: 'sms',
      provider: 'twilio',
      providerAccountId: 'sms-account-1',
      externalMessageId: 'SM123',
      deliveryStatus: 'queued',
    };

    constructor(
      message = 'provider accepted before local finalization failed',
      dispatchedMessage: Record<string, unknown> | null = null,
      stage = 'message_persistence',
    ) {
      super(message);
      this.dispatchedMessage = dispatchedMessage;
      this.stage = stage;
    }
  },
  from: vi.fn(),
  getSecret: vi.fn(),
  resolveProviderConfig: vi.fn(),
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
vi.mock('@support-core/services/outbound-provider-config', () => ({
  resolveOutboundProviderConfig: mocks.resolveProviderConfig,
}));
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
  OutboundMessagePostDispatchError: mocks.PostDispatchError,
  OutboundMessageService: class {
    sendReply = mocks.sendReply;
  },
}));

import { POST } from '../../app/api/functions/approve-ai-draft/route';
import { ProviderSendOutcomeUnknownError } from '../../packages/support-core/src/adapters/provider-send-outcome-unknown-error';

interface Scenario {
  channel: 'sms' | 'email' | 'webchat';
  tableData: Record<string, unknown>;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: unknown }>;
  claimAvailable: boolean;
  idleUpdateFailuresRemaining: number;
  operationRejections: Record<string, string>;
  operationRejectionsRemaining: Record<string, number>;
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
      const state = operation === 'update' && typeof latestUpdate?.values.ai_state === 'string'
        ? latestUpdate.values.ai_state
        : null;
      const specificKey = state ? `${table}:${operation}:${state}` : '';
      const baseKey = `${table}:${operation}`;
      const rejectionKey = specificKey && scenario.operationRejections[specificKey]
        ? specificKey
        : baseKey;
      const rejection = scenario.operationRejections[rejectionKey];
      const rejectionsRemaining = scenario.operationRejectionsRemaining[rejectionKey];
      if (rejection) {
        if (rejectionsRemaining === undefined || rejectionsRemaining > 0) {
          if (rejectionsRemaining !== undefined) {
            scenario.operationRejectionsRemaining[rejectionKey] -= 1;
          }
          return Promise.reject(new Error(rejection)).then(onfulfilled, onrejected);
        }
      }
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
    operationRejections: {},
    operationRejectionsRemaining: {},
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
    mocks.resolveProviderConfig.mockResolvedValue({
      accountSid: 'AC123',
      authToken: 'secret',
    });
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
    expect(mocks.resolveProviderConfig).toHaveBeenCalledWith(
      'org-1',
      'sms',
      expect.objectContaining({ loadSecret: expect.any(Function) }),
    );
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
    mocks.resolveProviderConfig.mockResolvedValue({ serverToken: 'postmark-token' });

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(200);
    expect(mocks.resolveProviderConfig).toHaveBeenCalledWith(
      'org-1',
      'email',
      expect.objectContaining({ loadSecret: expect.any(Function) }),
    );
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

  it('clears the draft when persistence fails after the provider accepted the reply', async () => {
    mocks.sendReply.mockRejectedValue(
      new mocks.PostDispatchError('provider accepted before persistence failed'),
    );

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      data: { message: null },
    });
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'idle' },
    });
    expect(scenario.updates).not.toContainEqual({
      table: 'conversations',
      values: { ai_state: 'drafted' },
    });
    expect(scenario.inserts).toContainEqual({
      table: 'audit_logs',
      values: [expect.objectContaining({
        action: 'ai_draft_approved',
        resource_id: 'decision-1',
        metadata: expect.objectContaining({ reconciliationRequired: true }),
      })],
    });
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

  it('retries a rejected state-transition promise before surfacing provider failure', async () => {
    mocks.sendReply.mockRejectedValue(new Error('Twilio rejected the message'));
    scenario.operationRejections['conversations:update:drafted'] = 'transient network rejection';
    scenario.operationRejectionsRemaining['conversations:update:drafted'] = 1;

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(500);
    expect(scenario.updates.filter(
      ({ values }) => values.ai_state === 'drafted',
    )).toHaveLength(2);
  });

  it('records reconciliation when conversation finalization fails after message persistence', async () => {
    mocks.sendReply.mockRejectedValue(
      new mocks.PostDispatchError(
        'conversation update failed after provider acceptance',
        SENT_MESSAGE,
        'conversation_update',
      ),
    );

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(202);
    expect(scenario.inserts).toContainEqual({
      table: 'audit_logs',
      values: [expect.objectContaining({
        action: 'ai_draft_approved',
        metadata: expect.objectContaining({
          messageId: SENT_MESSAGE.id,
          reconciliationRequired: true,
          finalizationStage: 'conversation_update',
        }),
      })],
    });
  });

  it('clears the claim and returns accepted when the provider outcome is unknown', async () => {
    mocks.sendReply.mockRejectedValue(new ProviderSendOutcomeUnknownError({
      providerId: 'twilio',
      stage: 'request',
      message: 'request failed without a provider response',
      originalError: new Error('socket closed'),
    }));

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      warning: expect.stringContaining('outcome is unknown'),
    });
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'idle' },
    });
    expect(scenario.inserts).toContainEqual({
      table: 'audit_logs',
      values: [expect.objectContaining({
        metadata: expect.objectContaining({ providerOutcomeUnknown: true }),
      })],
    });
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
    expect(mocks.resolveProviderConfig).not.toHaveBeenCalled();
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

  it('returns accepted when the post-send approval audit rejects', async () => {
    scenario.operationRejections['audit_logs:insert'] = 'audit network failure';

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      warning: expect.stringContaining('audit network failure'),
    });
    expect(mocks.sendReply).toHaveBeenCalledOnce();
  });

  it('returns accepted when webchat recipient lookup rejects after persistence', async () => {
    configureScenario('webchat');
    mocks.sendReply.mockResolvedValue({ ...SENT_MESSAGE, channel: 'webchat' });
    scenario.operationRejections['webchat_threads:select'] = 'thread lookup network failure';

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      aiDecisionId: 'decision-1',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      warning: expect.stringContaining('thread lookup network failure'),
    });
  });
});
