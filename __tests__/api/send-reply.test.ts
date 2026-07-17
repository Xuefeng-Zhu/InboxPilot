import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  PostDispatchError: class extends Error {
    readonly dispatchedMessage = null;
    readonly stage = 'message_persistence';
    readonly receipt = {
      channel: 'sms',
      provider: 'twilio',
      providerAccountId: 'account-1',
      externalMessageId: 'SM123',
      deliveryStatus: 'queued',
    };
  },
  from: vi.fn(),
  getSecret: vi.fn(),
  resolveProviderConfig: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  createProviderRegistry: vi.fn(),
  createInsforgeDbAdapter: vi.fn(),
  sendReply: vi.fn(),
  publishRealtimeMessage: vi.fn(),
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
}));
vi.mock('@/lib/insforge-secrets', () => ({ getSecret: mocks.getSecret }));
vi.mock('@support-core/services/outbound-provider-config', () => ({
  resolveOutboundProviderConfig: mocks.resolveProviderConfig,
}));
vi.mock('@/lib/provider-registry', () => ({
  createProviderRegistry: mocks.createProviderRegistry,
}));
vi.mock('@/lib/realtime-publisher', () => ({
  publishRealtimeMessage: mocks.publishRealtimeMessage,
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

import { POST } from '../../app/api/functions/send-reply/route';
import { ProviderSendOutcomeUnknownError } from '../../packages/support-core/src/adapters/provider-send-outcome-unknown-error';

interface Scenario {
  tableData: Record<string, unknown>;
  tableErrors: Record<string, string>;
  operationRejections: Record<string, string>;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: unknown }>;
  draftUpdateFailuresRemaining: number;
}

let scenario: Scenario;

function createBuilder(table: string) {
  let operation: 'select' | 'update' | 'insert' = 'select';
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
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
    const rejection = scenario.operationRejections[`${table}:${operation}`];
    if (rejection) {
      return Promise.reject(new Error(rejection)).then(onfulfilled, onrejected);
    }
    const updateFailed = operation === 'update'
      && scenario.draftUpdateFailuresRemaining > 0;
    if (updateFailed) scenario.draftUpdateFailuresRemaining -= 1;
    const tableError = scenario.tableErrors[table];
    const result = updateFailed
      ? { data: null, error: { message: 'draft update unavailable' } }
      : tableError
        ? { data: null, error: { message: tableError } }
        : { data: operation === 'select' ? scenario.tableData[table] ?? null : null, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  });
  return builder;
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/functions/send-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

const SENT_MESSAGE = {
  id: 'message-1',
  organizationId: 'org-1',
  conversationId: 'conversation-1',
  senderType: 'user',
  senderId: 'user-1',
  channel: 'sms',
  body: 'Hello',
  direction: 'outbound',
  deliveryStatus: 'queued',
  provider: 'twilio',
  providerAccountId: 'account-1',
  externalMessageId: 'SM123',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('send-reply route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scenario = {
      tableData: {
        conversations: [{
          id: 'conversation-1',
          organization_id: 'org-1',
          channel: 'sms',
        }],
        sms_phone_numbers: [{ provider_account_id: 'account-1' }],
        sms_provider_accounts: [{
          provider: 'twilio',
          credentials_secret_id: 'secret-1',
          is_active: true,
        }],
      },
      tableErrors: {},
      operationRejections: {},
      updates: [],
      inserts: [],
      draftUpdateFailuresRemaining: 0,
    };
    mocks.from.mockImplementation((table: string) => createBuilder(table));
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    mocks.getSecret.mockResolvedValue({ accountSid: 'AC123', authToken: 'token' });
    mocks.resolveProviderConfig.mockResolvedValue({
      accountSid: 'AC123',
      authToken: 'token',
    });
    mocks.createProviderRegistry.mockReturnValue({});
    mocks.createInsforgeDbAdapter.mockReturnValue({});
    mocks.sendReply.mockResolvedValue(SENT_MESSAGE);
  });

  it('uses the shared provider resolver and clears the consumed draft', async () => {
    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(200);
    expect(mocks.resolveProviderConfig).toHaveBeenCalledWith(
      'org-1',
      'sms',
      expect.objectContaining({ loadSecret: expect.any(Function) }),
    );
    expect(mocks.sendReply).toHaveBeenCalledWith(
      'conversation-1',
      'Hello',
      { type: 'user', id: 'user-1' },
      { accountSid: 'AC123', authToken: 'token' },
    );
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'idle' },
    });
  });

  it('surfaces provider-account lookup failures instead of dispatching with empty credentials', async () => {
    mocks.resolveProviderConfig.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'database unavailable',
    });
    expect(mocks.sendReply).not.toHaveBeenCalled();
  });

  it('returns accepted after external dispatch so clients do not retry a delivered reply', async () => {
    mocks.sendReply.mockRejectedValue(
      new mocks.PostDispatchError('provider accepted before message persistence failed'),
    );

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      data: null,
    });
    expect(scenario.updates).toContainEqual({
      table: 'conversations',
      values: { ai_state: 'idle' },
    });
    expect(scenario.inserts).toContainEqual({
      table: 'audit_logs',
      values: [expect.objectContaining({
        action: 'message_sent',
        resource_id: null,
        metadata: expect.objectContaining({ reconciliationRequired: true }),
      })],
    });
  });

  it('returns accepted and records reconciliation when the provider outcome is unknown', async () => {
    mocks.sendReply.mockRejectedValue(new ProviderSendOutcomeUnknownError({
      providerId: 'twilio',
      stage: 'request',
      message: 'request failed without a provider response',
      originalError: new Error('socket closed'),
    }));

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      warning: expect.stringContaining('outcome is unknown'),
      data: null,
    });
    expect(scenario.inserts).toContainEqual({
      table: 'audit_logs',
      values: [expect.objectContaining({
        metadata: expect.objectContaining({ providerOutcomeUnknown: true }),
      })],
    });
  });

  it('does not turn post-send draft cleanup failure into a retryable 500', async () => {
    scenario.draftUpdateFailuresRemaining = 2;

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: 'accepted' });
    expect(mocks.sendReply).toHaveBeenCalledOnce();
  });

  it('keeps an accepted dispatch non-retryable when reconciliation and cleanup reject', async () => {
    mocks.sendReply.mockRejectedValue(
      new mocks.PostDispatchError('provider accepted before message persistence failed'),
    );
    scenario.operationRejections['audit_logs:insert'] = 'audit network failure';
    scenario.operationRejections['conversations:update'] = 'cleanup network failure';

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      warning: expect.stringContaining('audit network failure'),
    });
  });

  it('treats a rejected webchat recipient lookup as a post-send warning', async () => {
    scenario.tableData.conversations = [{
      id: 'conversation-1',
      organization_id: 'org-1',
      channel: 'webchat',
    }];
    mocks.resolveProviderConfig.mockResolvedValue({});
    mocks.sendReply.mockResolvedValue({ ...SENT_MESSAGE, channel: 'webchat' });
    scenario.operationRejections['webchat_threads:select'] = 'thread lookup network failure';

    const response = await POST(makeRequest({
      conversationId: 'conversation-1',
      body: 'Hello',
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      warning: expect.stringContaining('thread lookup network failure'),
    });
  });
});
