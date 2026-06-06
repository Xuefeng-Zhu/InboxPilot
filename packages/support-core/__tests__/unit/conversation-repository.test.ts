import { describe, it, expect, vi } from 'vitest';
import { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { DatabaseClient, QueryBuilder, QueryResult } from '../../src/interfaces/database-client.js';

/**
 * Unit tests for ConversationRepository.
 *
 * Uses a mock DatabaseClient to verify query construction and
 * snake_case ↔ camelCase mapping without a real database.
 */

/** Helper: build a mock QueryBuilder that chains and resolves to a given result. */
function createMockQueryBuilder(result: QueryResult): QueryBuilder {
  const builder: QueryBuilder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((resolve) => Promise.resolve(resolve?.(result))),
  };
  return builder;
}

function createMockDb(builder: QueryBuilder): DatabaseClient {
  return {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn(),
  };
}

const SAMPLE_ROW = {
  id: 'conv1',
  organization_id: 'org1',
  contact_id: 'c1',
  channel: 'sms' as const,
  status: 'open' as const,
  ai_state: 'idle' as const,
  subject: null,
  assigned_to: null,
  last_message_at: '2024-01-15T10:30:00.000Z',
  metadata: {},
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-15T10:30:00.000Z',
};

describe('ConversationRepository', () => {
  describe('findOpenByContactAndChannel', () => {
    it('returns a Conversation when a matching open conversation exists', async () => {
      const builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.findOpenByContactAndChannel('c1', 'sms');

      expect(db.from).toHaveBeenCalledWith('conversations');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenCalledWith('contact_id', 'c1');
      expect(builder.eq).toHaveBeenCalledWith('channel', 'sms');
      expect(builder.eq).toHaveBeenCalledWith('status', 'open');
      expect(builder.maybeSingle).toHaveBeenCalled();

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv1');
      expect(result!.organizationId).toBe('org1');
      expect(result!.contactId).toBe('c1');
      expect(result!.channel).toBe('sms');
      expect(result!.status).toBe('open');
      expect(result!.aiState).toBe('idle');
      expect(result!.lastMessageAt).toBeInstanceOf(Date);
      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('returns null when no open conversation exists', async () => {
      const builder = createMockQueryBuilder({ data: null, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.findOpenByContactAndChannel('c1', 'email');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'connection refused' },
      });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await expect(repo.findOpenByContactAndChannel('c1', 'sms')).rejects.toThrow(
        'ConversationRepository.findOpenByContactAndChannel failed: connection refused',
      );
    });
  });

  describe('create', () => {
    it('inserts a row with snake_case keys and returns a camelCase Conversation', async () => {
      const builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.create({
        organizationId: 'org1',
        contactId: 'c1',
        channel: 'sms',
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org1',
          contact_id: 'c1',
          channel: 'sms',
        }),
      );
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.single).toHaveBeenCalled();

      expect(result.id).toBe('conv1');
      expect(result.organizationId).toBe('org1');
      expect(result.contactId).toBe('c1');
      expect(result.channel).toBe('sms');
    });

    it('creates a conversation with optional fields', async () => {
      const emailRow = {
        ...SAMPLE_ROW,
        channel: 'email' as const,
        status: 'pending' as const,
        ai_state: 'thinking' as const,
        subject: 'Help with order',
      };
      const builder = createMockQueryBuilder({ data: emailRow, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.create({
        organizationId: 'org1',
        contactId: 'c1',
        channel: 'email',
        status: 'pending',
        aiState: 'thinking',
        subject: 'Help with order',
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org1',
          contact_id: 'c1',
          channel: 'email',
          status: 'pending',
          ai_state: 'thinking',
          subject: 'Help with order',
        }),
      );

      expect(result.channel).toBe('email');
      expect(result.status).toBe('pending');
      expect(result.aiState).toBe('thinking');
      expect(result.subject).toBe('Help with order');
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'unique violation' },
      });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await expect(
        repo.create({ organizationId: 'org1', contactId: 'c1', channel: 'sms' }),
      ).rejects.toThrow('ConversationRepository.create failed: unique violation');
    });
  });

  describe('update', () => {
    it('updates specified fields and returns the updated Conversation', async () => {
      const updatedRow = { ...SAMPLE_ROW, status: 'resolved' as const, ai_state: 'idle' as const };
      const builder = createMockQueryBuilder({ data: updatedRow, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.update('conv1', { status: 'resolved', aiState: 'idle' });

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'resolved',
          ai_state: 'idle',
          updated_at: expect.any(String),
        }),
      );
      expect(builder.eq).toHaveBeenCalledWith('id', 'conv1');
      expect(builder.single).toHaveBeenCalled();

      expect(result.status).toBe('resolved');
      expect(result.aiState).toBe('idle');
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'not found' },
      });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await expect(repo.update('conv1', { status: 'resolved' })).rejects.toThrow(
        'ConversationRepository.update failed: not found',
      );
    });
  });

  describe('listByOrg', () => {
    it('returns conversations for an organization ordered by last_message_at DESC', async () => {
      const rows = [SAMPLE_ROW, { ...SAMPLE_ROW, id: 'conv2', channel: 'email' as const }];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.listByOrg('org1');

      expect(db.from).toHaveBeenCalledWith('conversations');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenCalledWith('organization_id', 'org1');
      expect(builder.order).toHaveBeenCalledWith('last_message_at', { ascending: false });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('conv1');
      expect(result[1].id).toBe('conv2');
    });

    it('applies status filter when provided', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await repo.listByOrg('org1', { status: 'open' });

      expect(builder.eq).toHaveBeenCalledWith('status', 'open');
    });

    it('applies channel filter when provided', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await repo.listByOrg('org1', { channel: 'sms' });

      expect(builder.eq).toHaveBeenCalledWith('channel', 'sms');
    });

    it('applies assignedTo filter when provided', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await repo.listByOrg('org1', { assignedTo: 'member1' });

      expect(builder.eq).toHaveBeenCalledWith('assigned_to', 'member1');
    });

    it('applies limit when provided', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await repo.listByOrg('org1', { limit: 10 });

      expect(builder.limit).toHaveBeenCalledWith(10);
    });

    it('applies range when both limit and offset are provided', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await repo.listByOrg('org1', { limit: 10, offset: 20 });

      expect(builder.range).toHaveBeenCalledWith(20, 29);
    });

    it('returns empty array when no conversations exist', async () => {
      const builder = createMockQueryBuilder({ data: [], error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.listByOrg('org1');
      expect(result).toEqual([]);
    });

    it('returns empty array when data is null', async () => {
      const builder = createMockQueryBuilder({ data: null, error: null });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      const result = await repo.listByOrg('org1');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'timeout' },
      });
      const db = createMockDb(builder);
      const repo = new ConversationRepository(db);

      await expect(repo.listByOrg('org1')).rejects.toThrow(
        'ConversationRepository.listByOrg failed: timeout',
      );
    });
  });
});
