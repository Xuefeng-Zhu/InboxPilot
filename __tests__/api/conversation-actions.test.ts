import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserFromToken: vi.fn(),
  userHasOrgPermission: vi.fn(),
  selectData: [{ organization_id: 'org-1' }] as unknown,
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  auditError: null as { message: string } | null,
  publishRealtimeMessage: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: string; values: Array<Record<string, unknown>> }>,
  eqCalls: [] as Array<{
    operation: 'select' | 'update' | 'insert';
    column: string;
    value: unknown;
  }>,
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: { database: { from: mocks.from } },
}));

vi.mock('@/app/api/functions/_auth', () => ({
  getUserFromToken: mocks.getUserFromToken,
  userHasOrgPermission: mocks.userHasOrgPermission,
}));

vi.mock('@/lib/realtime-publisher', () => ({
  publishRealtimeMessage: mocks.publishRealtimeMessage,
}));

import { POST as escalate } from '../../app/api/functions/escalate-conversation/route';
import { POST as reopen } from '../../app/api/functions/reopen-conversation/route';
import { POST as resolve } from '../../app/api/functions/resolve-conversation/route';

function makeRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost/api/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function createBuilder(table: string) {
  let operation: 'select' | 'update' | 'insert' = 'select';
  const builder = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockImplementation((column: string, value: unknown) => {
    mocks.eqCalls.push({ operation, column, value });
    return builder;
  });
  builder.limit.mockReturnValue(builder);
  builder.update.mockImplementation((values: Record<string, unknown>) => {
    operation = 'update';
    mocks.updates.push(values);
    return builder;
  });
  builder.insert.mockImplementation((values: Array<Record<string, unknown>>) => {
    operation = 'insert';
    mocks.inserts.push({ table, values });
    return builder;
  });
  builder.then.mockImplementation((onfulfilled, onrejected) => {
    const result = operation === 'select'
      ? { data: mocks.selectData, error: mocks.selectError }
      : operation === 'update'
        ? { data: null, error: mocks.updateError }
        : { data: null, error: mocks.auditError };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  });
  return builder;
}

const routes = [
  {
    name: 'escalate-conversation',
    post: escalate,
    expectedUpdate: { status: 'escalated', ai_state: 'needs_human' },
    expectedAction: 'conversation_escalated',
    pastTense: 'escalated',
    sourceStatus: 'open',
    targetStatus: 'escalated',
    conflictStatus: 'resolved',
    conflictError: 'Only open conversations can be escalated',
  },
  {
    name: 'reopen-conversation',
    post: reopen,
    expectedUpdate: { status: 'open', ai_state: 'idle' },
    expectedAction: 'conversation_reopened',
    pastTense: 'reopened',
    sourceStatus: 'resolved',
    targetStatus: 'open',
    conflictStatus: 'escalated',
    conflictError: 'Only resolved conversations can be reopened',
  },
  {
    name: 'resolve-conversation',
    post: resolve,
    expectedUpdate: { status: 'resolved', ai_state: 'idle' },
    expectedAction: 'conversation_resolved',
    pastTense: 'resolved',
    sourceStatus: 'open',
    targetStatus: 'resolved',
    conflictStatus: 'pending',
    conflictError: 'Only open or escalated conversations can be resolved',
  },
] as const;

describe.each(routes)('$name route', ({
  name,
  post,
  expectedUpdate,
  expectedAction,
  pastTense,
  sourceStatus,
  targetStatus,
  conflictStatus,
  conflictError,
}) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectData = [{ organization_id: 'org-1', status: sourceStatus }];
    mocks.selectError = null;
    mocks.updateError = null;
    mocks.auditError = null;
    mocks.updates = [];
    mocks.inserts = [];
    mocks.eqCalls = [];
    mocks.from.mockImplementation((table: string) => createBuilder(table));
    mocks.getUserFromToken.mockResolvedValue({ id: 'user-1' });
    mocks.userHasOrgPermission.mockResolvedValue(true);
    mocks.publishRealtimeMessage.mockResolvedValue(undefined);
  });

  it('rejects anonymous callers before reading the conversation', async () => {
    mocks.getUserFromToken.mockResolvedValue(null);

    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('validates the conversation id', async () => {
    const response = await post(makeRequest(name, {}));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns not found without checking permissions', async () => {
    mocks.selectData = [];

    const response = await post(makeRequest(name, {
      conversationId: 'missing-conversation',
    }));

    expect(response.status).toBe(404);
    expect(mocks.userHasOrgPermission).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it('does not mutate conversations outside the caller permissions', async () => {
    mocks.userHasOrgPermission.mockResolvedValue(false);

    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(403);
    expect(mocks.userHasOrgPermission).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      'reply_conversations',
    );
    expect(mocks.updates).toHaveLength(0);
  });

  it('surfaces conversation lookup failures', async () => {
    mocks.selectError = { message: 'database unavailable' };

    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: `${name} failed to load conversation: database unavailable`,
    });
    expect(mocks.updates).toHaveLength(0);
  });

  it('surfaces update failures', async () => {
    mocks.updateError = { message: 'write unavailable' };

    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: `${name} failed to update conversation: write unavailable`,
    });
  });

  it('treats an already-completed transition as an idempotent success', async () => {
    mocks.selectData = [{ organization_id: 'org-1', status: targetStatus }];

    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.publishRealtimeMessage).not.toHaveBeenCalled();
  });

  it('rejects an invalid source state without mutating or auditing', async () => {
    mocks.selectData = [{ organization_id: 'org-1', status: conflictStatus }];

    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: conflictError });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.publishRealtimeMessage).not.toHaveBeenCalled();
  });

  it('updates the authorized conversation to the requested state', async () => {
    const response = await post(makeRequest(name, {
      conversationId: 'conversation-1',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject(expectedUpdate);
    expect(mocks.updates[0].updated_at).toEqual(expect.any(String));
    expect(mocks.eqCalls).toContainEqual({
      operation: 'update',
      column: 'id',
      value: 'conversation-1',
    });
    expect(mocks.publishRealtimeMessage).toHaveBeenCalledWith(
      'org:org-1',
      'conversation_updated',
      {
        conversationId: 'conversation-1',
        status: expectedUpdate.status,
        aiState: expectedUpdate.ai_state,
      },
    );
    expect(mocks.inserts).toEqual([{
      table: 'audit_logs',
      values: [{
        organization_id: 'org-1',
        actor_id: 'user-1',
        actor_type: 'user',
        action: expectedAction,
        resource_type: 'conversation',
        resource_id: 'conversation-1',
        metadata: {},
      }],
    }]);
  });

  it('surfaces audit failures without reporting a persisted state change as failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.auditError = { message: 'audit unavailable' };

    try {
      const response = await post(makeRequest(name, {
        conversationId: 'conversation-1',
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: 'accepted',
        warning: `Conversation was ${pastTense}, but its audit log failed: audit unavailable`,
      });
      expect(mocks.updates).toHaveLength(1);
      expect(error).toHaveBeenCalledWith(
        `${name}: failed to write audit log`,
        'audit unavailable',
      );
    } finally {
      error.mockRestore();
    }
  });

  it('keeps a persisted state change successful when realtime publishing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.publishRealtimeMessage.mockRejectedValueOnce(new Error('realtime unavailable'));

    try {
      const response = await post(makeRequest(name, {
        conversationId: 'conversation-1',
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
      expect(mocks.updates).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        `${name}: failed to publish realtime update`,
        'realtime unavailable',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
