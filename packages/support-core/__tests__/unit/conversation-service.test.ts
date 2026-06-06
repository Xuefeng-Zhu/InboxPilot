import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { Conversation, CreateConversationInput } from '../../src/types/index.js';

/**
 * Unit tests for conversation state transitions.
 *
 * Tests create new, append to existing, resolve/reopen/escalate state transitions.
 * Uses a mock DatabaseClient to verify the correct queries are made.
 */

// ─── Fixtures ─────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const CONTACT_ID = 'contact-001';

const OPEN_CONVERSATION: Conversation = {
  id: 'conv-001',
  organizationId: ORG_ID,
  contactId: CONTACT_ID,
  channel: 'sms',
  status: 'open',
  aiState: 'idle',
  subject: null,
  assignedTo: null,
  lastMessageAt: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ─── Mock Database Client ─────────────────────────────────────────

function createMockQueryBuilder(returnData: unknown = null, returnError: unknown = null) {
  const builder: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'is', 'in', 'contains',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ];

  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  // Make it thenable (Promise-like)
  builder.then = vi.fn().mockImplementation((resolve: (value: unknown) => void) => {
    return Promise.resolve(resolve({ data: returnData, error: returnError }));
  });

  return builder;
}

function createMockDb(returnData: unknown = null, returnError: unknown = null) {
  const queryBuilder = createMockQueryBuilder(returnData, returnError);
  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    _queryBuilder: queryBuilder,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('ConversationRepository — State Transitions', () => {
  describe('create', () => {
    it('creates a new conversation with default status "open" and ai_state "idle"', async () => {
      const row = {
        id: 'conv-new',
        organization_id: ORG_ID,
        contact_id: CONTACT_ID,
        channel: 'sms',
        status: 'open',
        ai_state: 'idle',
        subject: null,
        assigned_to: null,
        last_message_at: null,
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const db = createMockDb(row);
      const repo = new ConversationRepository(db as never);

      const input: CreateConversationInput = {
        organizationId: ORG_ID,
        contactId: CONTACT_ID,
        channel: 'sms',
        status: 'open',
        aiState: 'idle',
      };

      const result = await repo.create(input);

      expect(result.id).toBe('conv-new');
      expect(result.status).toBe('open');
      expect(result.aiState).toBe('idle');
      expect(db.from).toHaveBeenCalledWith('conversations');
    });
  });

  describe('resolve', () => {
    it('sets status to "resolved" and ai_state to "idle"', async () => {
      const resolvedRow = {
        ...OPEN_CONVERSATION,
        id: OPEN_CONVERSATION.id,
        organization_id: OPEN_CONVERSATION.organizationId,
        contact_id: OPEN_CONVERSATION.contactId,
        ai_state: 'idle',
        status: 'resolved',
        assigned_to: null,
        last_message_at: null,
        created_at: OPEN_CONVERSATION.createdAt.toISOString(),
        updated_at: new Date().toISOString(),
      };
      const db = createMockDb(resolvedRow);
      const repo = new ConversationRepository(db as never);

      const result = await repo.update('conv-001', {
        status: 'resolved',
        aiState: 'idle',
      });

      expect(result.status).toBe('resolved');
      expect(result.aiState).toBe('idle');
    });
  });

  describe('reopen', () => {
    it('sets status to "open" from "resolved"', async () => {
      const reopenedRow = {
        id: 'conv-001',
        organization_id: ORG_ID,
        contact_id: CONTACT_ID,
        channel: 'sms',
        status: 'open',
        ai_state: 'idle',
        subject: null,
        assigned_to: null,
        last_message_at: null,
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      };
      const db = createMockDb(reopenedRow);
      const repo = new ConversationRepository(db as never);

      const result = await repo.update('conv-001', { status: 'open' });

      expect(result.status).toBe('open');
    });
  });

  describe('escalate', () => {
    it('sets status to "escalated" and ai_state to "needs_human"', async () => {
      const escalatedRow = {
        id: 'conv-001',
        organization_id: ORG_ID,
        contact_id: CONTACT_ID,
        channel: 'sms',
        status: 'escalated',
        ai_state: 'needs_human',
        subject: null,
        assigned_to: null,
        last_message_at: null,
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
      };
      const db = createMockDb(escalatedRow);
      const repo = new ConversationRepository(db as never);

      const result = await repo.update('conv-001', {
        status: 'escalated',
        aiState: 'needs_human',
      });

      expect(result.status).toBe('escalated');
      expect(result.aiState).toBe('needs_human');
    });
  });

  describe('findOpenByContactAndChannel', () => {
    it('returns null when no open conversation exists', async () => {
      const db = createMockDb(null);
      const repo = new ConversationRepository(db as never);

      const result = await repo.findOpenByContactAndChannel(CONTACT_ID, 'sms');

      expect(result).toBeNull();
    });

    it('returns the open conversation when one exists', async () => {
      const row = {
        id: 'conv-001',
        organization_id: ORG_ID,
        contact_id: CONTACT_ID,
        channel: 'sms',
        status: 'open',
        ai_state: 'idle',
        subject: null,
        assigned_to: null,
        last_message_at: null,
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const db = createMockDb(row);
      const repo = new ConversationRepository(db as never);

      const result = await repo.findOpenByContactAndChannel(CONTACT_ID, 'sms');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv-001');
      expect(result!.status).toBe('open');
    });
  });
});
