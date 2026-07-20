import { describe, it, expect, vi } from 'vitest';
import { MessageRepository } from '../../src/repositories/message-repository.js';
import type { DatabaseClient, QueryBuilder, QueryResult } from '../../src/interfaces/database-client.js';

/**
 * Unit tests for MessageRepository.
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
  id: 'msg1',
  conversation_id: 'conv1',
  sender_type: 'contact' as const,
  sender_id: null,
  direction: 'inbound' as const,
  channel: 'sms' as const,
  body: 'Hello, I need help with my order',
  subject: null,
  raw_payload: { original: true },
  provider: 'twilio',
  provider_account_id: 'acct1',
  external_message_id: 'SM123abc',
  delivery_status: 'delivered' as const,
  created_at: '2024-01-15T10:30:00.000Z',
  updated_at: '2024-01-15T10:30:00.000Z',
};

describe('MessageRepository', () => {
  describe('findById', () => {
    it('loads an immutable source message by ID', async () => {
      const builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.findById('msg1');

      expect(builder.eq).toHaveBeenCalledWith('id', 'msg1');
      expect(builder.maybeSingle).toHaveBeenCalled();
      expect(result?.id).toBe('msg1');
    });
  });

  describe('findByExternalId', () => {
    it('returns a Message when a matching row exists', async () => {
      const builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.findByExternalId('twilio', 'SM123abc');

      expect(db.from).toHaveBeenCalledWith('messages');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenCalledWith('provider', 'twilio');
      expect(builder.eq).toHaveBeenCalledWith('external_message_id', 'SM123abc');
      expect(builder.maybeSingle).toHaveBeenCalled();

      expect(result).not.toBeNull();
      expect(result!.id).toBe('msg1');
      expect(result!.conversationId).toBe('conv1');
      expect(result!.senderType).toBe('contact');
      expect(result!.senderId).toBeNull();
      expect(result!.direction).toBe('inbound');
      expect(result!.channel).toBe('sms');
      expect(result!.body).toBe('Hello, I need help with my order');
      expect(result!.provider).toBe('twilio');
      expect(result!.providerAccountId).toBe('acct1');
      expect(result!.externalMessageId).toBe('SM123abc');
      expect(result!.deliveryStatus).toBe('delivered');
      expect(result!.rawPayload).toEqual({ original: true });
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });

    it('returns null when no matching row exists', async () => {
      const builder = createMockQueryBuilder({ data: null, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.findByExternalId('twilio', 'nonexistent');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'connection refused' },
      });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      await expect(repo.findByExternalId('twilio', 'SM123abc')).rejects.toThrow(
        'MessageRepository.findByExternalId failed: connection refused',
      );
    });
  });

  describe('create', () => {
    it('inserts a row with snake_case keys and returns a camelCase Message', async () => {
      const builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.create({
        conversationId: 'conv1',
        senderType: 'contact',
        senderId: null,
        direction: 'inbound',
        channel: 'sms',
        body: 'Hello, I need help with my order',
        rawPayload: { original: true },
        provider: 'twilio',
        providerAccountId: 'acct1',
        externalMessageId: 'SM123abc',
        deliveryStatus: 'delivered',
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conv1',
          sender_type: 'contact',
          sender_id: null,
          direction: 'inbound',
          channel: 'sms',
          body: 'Hello, I need help with my order',
          raw_payload: { original: true },
          provider: 'twilio',
          provider_account_id: 'acct1',
          external_message_id: 'SM123abc',
          delivery_status: 'delivered',
        }),
      );
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.single).toHaveBeenCalled();

      expect(result.id).toBe('msg1');
      expect(result.conversationId).toBe('conv1');
      expect(result.senderType).toBe('contact');
      expect(result.direction).toBe('inbound');
      expect(result.channel).toBe('sms');
    });

    it('creates a message with only required fields', async () => {
      const minimalRow = {
        ...SAMPLE_ROW,
        sender_id: null,
        subject: null,
        raw_payload: {},
        provider: null,
        provider_account_id: null,
        external_message_id: null,
        delivery_status: 'pending' as const,
      };
      const builder = createMockQueryBuilder({ data: minimalRow, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.create({
        conversationId: 'conv1',
        senderType: 'contact',
        direction: 'inbound',
        channel: 'sms',
        body: 'Hi',
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conv1',
          sender_type: 'contact',
          direction: 'inbound',
          channel: 'sms',
          body: 'Hi',
        }),
      );

      expect(result.provider).toBeNull();
      expect(result.providerAccountId).toBeNull();
      expect(result.externalMessageId).toBeNull();
    });

    it('creates an email message with subject', async () => {
      const emailRow = {
        ...SAMPLE_ROW,
        channel: 'email' as const,
        direction: 'outbound' as const,
        sender_type: 'user' as const,
        sender_id: 'usr_abc',
        subject: 'Re: Order #1234',
        provider: 'postmark',
      };
      const builder = createMockQueryBuilder({ data: emailRow, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.create({
        conversationId: 'conv1',
        senderType: 'user',
        senderId: 'usr_abc',
        direction: 'outbound',
        channel: 'email',
        body: 'Your order has shipped.',
        subject: 'Re: Order #1234',
        provider: 'postmark',
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sender_id: 'usr_abc',
          subject: 'Re: Order #1234',
          provider: 'postmark',
        }),
      );

      expect(result.subject).toBe('Re: Order #1234');
      expect(result.senderType).toBe('user');
      expect(result.senderId).toBe('usr_abc');
      expect(result.channel).toBe('email');
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'unique violation' },
      });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      await expect(
        repo.create({
          conversationId: 'conv1',
          senderType: 'contact',
          direction: 'inbound',
          channel: 'sms',
          body: 'Hello',
          provider: 'twilio',
          externalMessageId: 'SM123abc',
        }),
      ).rejects.toThrow('MessageRepository.create failed: unique violation');
    });
  });

  describe('listByConversation', () => {
    it('returns messages ordered by created_at ASC', async () => {
      const rows = [
        SAMPLE_ROW,
        { ...SAMPLE_ROW, id: 'msg2', created_at: '2024-01-15T10:35:00.000Z' },
      ];
      const builder = createMockQueryBuilder({ data: rows, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.listByConversation('conv1');

      expect(db.from).toHaveBeenCalledWith('messages');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenCalledWith('conversation_id', 'conv1');
      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
      expect(builder.order).toHaveBeenCalledWith('id', { ascending: true });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg1');
      expect(result[1].id).toBe('msg2');
    });

    it('queries newest first when limited and returns that tail chronologically', async () => {
      const latestRow = {
        ...SAMPLE_ROW,
        id: 'msg3',
        created_at: '2024-01-15T10:40:00.000Z',
      };
      const previousRow = {
        ...SAMPLE_ROW,
        id: 'msg2',
        created_at: '2024-01-15T10:35:00.000Z',
      };
      const builder = createMockQueryBuilder({ data: [latestRow, previousRow], error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.listByConversation('conv1', 2);

      expect(builder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
      expect(builder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(2);
      expect(result.map(({ id }) => id)).toEqual(['msg2', 'msg3']);
    });

    it('does not apply limit when not provided', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      await repo.listByConversation('conv1');

      expect(builder.limit).not.toHaveBeenCalled();
    });

    it('returns empty array when no messages exist', async () => {
      const builder = createMockQueryBuilder({ data: [], error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.listByConversation('conv1');
      expect(result).toEqual([]);
    });

    it('returns empty array when data is null', async () => {
      const builder = createMockQueryBuilder({ data: null, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.listByConversation('conv1');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'timeout' },
      });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      await expect(repo.listByConversation('conv1')).rejects.toThrow(
        'MessageRepository.listByConversation failed: timeout',
      );
    });
  });

  describe('source-bound conversation history', () => {
    it('loads the latest message with deterministic descending order', async () => {
      const builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.findLatestByConversation('conv1');

      expect(builder.eq).toHaveBeenCalledWith('conversation_id', 'conv1');
      expect(builder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
      expect(builder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
      expect(builder.limit).toHaveBeenCalledWith(1);
      expect(result?.id).toBe('msg1');
    });

    it('returns a database-bounded chronological tail ending at the exact source', async () => {
      const sourceRow = {
        ...SAMPLE_ROW,
        id: 'msg-30',
        created_at: '2024-01-15T11:00:00.000Z',
      };
      const sameTimestampBeforeSource = { ...sourceRow, id: 'msg-29' };
      const sameTimestampAfterSource = { ...sourceRow, id: 'msg-31' };
      const earlierRows = Array.from({ length: 25 }, (_, index) => ({
        ...SAMPLE_ROW,
        id: `msg-${String(28 - index).padStart(2, '0')}`,
        created_at: new Date(Date.parse(sourceRow.created_at) - (index + 1) * 60_000).toISOString(),
      }));
      const sameTimestampBuilder = createMockQueryBuilder({
        // The database's id <= source filter excludes msg-31.
        data: [sourceRow, sameTimestampBeforeSource],
        error: null,
      });
      const earlierBuilder = createMockQueryBuilder({
        // The database limit returns only the 18 newest earlier rows.
        data: earlierRows.slice(0, 18),
        error: null,
      });
      const db: DatabaseClient = {
        from: vi.fn()
          .mockReturnValueOnce(sameTimestampBuilder)
          .mockReturnValueOnce(earlierBuilder),
        rpc: vi.fn(),
      };
      const repo = new MessageRepository(db);

      const result = await repo.listByConversationThroughMessage(
        'conv1',
        { id: sourceRow.id, createdAt: new Date(sourceRow.created_at) },
        20,
      );

      expect(sameTimestampBuilder.eq).toHaveBeenCalledWith('created_at', sourceRow.created_at);
      expect(sameTimestampBuilder.lte).toHaveBeenCalledWith('id', sourceRow.id);
      expect(sameTimestampBuilder.order).toHaveBeenNthCalledWith(
        1,
        'created_at',
        { ascending: false },
      );
      expect(sameTimestampBuilder.order).toHaveBeenNthCalledWith(
        2,
        'id',
        { ascending: false },
      );
      expect(sameTimestampBuilder.limit).toHaveBeenCalledWith(20);
      expect(earlierBuilder.lt).toHaveBeenCalledWith('created_at', sourceRow.created_at);
      expect(earlierBuilder.limit).toHaveBeenCalledWith(18);
      expect(result).toHaveLength(20);
      expect(result.at(-2)?.id).toBe(sameTimestampBeforeSource.id);
      expect(result.at(-1)?.id).toBe(sourceRow.id);
      expect(result.some(({ id }) => id === sameTimestampAfterSource.id)).toBe(false);
    });

    it('fails when the immutable source is absent from the bounded history', async () => {
      const builder = createMockQueryBuilder({ data: [SAMPLE_ROW], error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      await expect(repo.listByConversationThroughMessage(
        'conv1',
        { id: 'missing', createdAt: new Date(SAMPLE_ROW.created_at) },
        20,
      )).rejects.toThrow(
        'MessageRepository.listByConversationThroughMessage source not found: missing',
      );
    });
  });

  describe('updateDeliveryStatus', () => {
    it('updates delivery_status and returns the updated Message', async () => {
      const updatedRow = { ...SAMPLE_ROW, delivery_status: 'delivered' as const };
      const builder = createMockQueryBuilder({ data: updatedRow, error: null });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      const result = await repo.updateDeliveryStatus('msg1', 'delivered');

      expect(db.from).toHaveBeenCalledWith('messages');
      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ delivery_status: 'delivered' }),
      );
      expect(builder.eq).toHaveBeenCalledWith('id', 'msg1');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.single).toHaveBeenCalled();

      expect(result.id).toBe('msg1');
      expect(result.deliveryStatus).toBe('delivered');
    });

    it('throws on database error', async () => {
      const builder = createMockQueryBuilder({
        data: null,
        error: { message: 'row not found' },
      });
      const db = createMockDb(builder);
      const repo = new MessageRepository(db);

      await expect(repo.updateDeliveryStatus('msg1', 'failed')).rejects.toThrow(
        'MessageRepository.updateDeliveryStatus failed: row not found',
      );
    });
  });
});
