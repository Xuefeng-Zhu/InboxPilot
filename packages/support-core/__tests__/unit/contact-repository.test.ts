import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactRepository } from '../../src/repositories/contact-repository.js';
import type { DatabaseClient, QueryBuilder, QueryResult } from '../../src/interfaces/database-client.js';

/**
 * Unit tests for ContactRepository.
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
  id: 'c1',
  organization_id: 'org1',
  name: 'Alice',
  email: 'alice@example.com',
  phone: '+15551234567',
  metadata: { source: 'web' },
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

describe('ContactRepository', () => {
  let builder: QueryBuilder;
  let db: DatabaseClient;
  let repo: ContactRepository;

  describe('findByPhone', () => {
    it('returns a Contact when a matching row exists', async () => {
      builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.findByPhone('org1', '+15551234567');

      expect(db.from).toHaveBeenCalledWith('contacts');
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.eq).toHaveBeenCalledWith('organization_id', 'org1');
      expect(builder.eq).toHaveBeenCalledWith('phone', '+15551234567');
      expect(builder.maybeSingle).toHaveBeenCalled();

      expect(result).not.toBeNull();
      expect(result!.id).toBe('c1');
      expect(result!.organizationId).toBe('org1');
      expect(result!.phone).toBe('+15551234567');
      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('returns null when no matching row exists', async () => {
      builder = createMockQueryBuilder({ data: null, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.findByPhone('org1', '+10000000000');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      builder = createMockQueryBuilder({
        data: null,
        error: { message: 'connection refused' },
      });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      await expect(repo.findByPhone('org1', '+15551234567')).rejects.toThrow(
        'ContactRepository.findByPhone failed: connection refused',
      );
    });
  });

  describe('findByEmail', () => {
    it('returns a Contact when a matching row exists', async () => {
      builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.findByEmail('org1', 'alice@example.com');

      expect(builder.eq).toHaveBeenCalledWith('organization_id', 'org1');
      expect(builder.eq).toHaveBeenCalledWith('email', 'alice@example.com');
      expect(builder.maybeSingle).toHaveBeenCalled();

      expect(result).not.toBeNull();
      expect(result!.email).toBe('alice@example.com');
    });

    it('returns null when no matching row exists', async () => {
      builder = createMockQueryBuilder({ data: null, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.findByEmail('org1', 'nobody@example.com');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      builder = createMockQueryBuilder({
        data: null,
        error: { message: 'timeout' },
      });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      await expect(repo.findByEmail('org1', 'alice@example.com')).rejects.toThrow(
        'ContactRepository.findByEmail failed: timeout',
      );
    });
  });

  describe('create', () => {
    it('inserts a row with snake_case keys and returns a camelCase Contact', async () => {
      builder = createMockQueryBuilder({ data: SAMPLE_ROW, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.create({
        organizationId: 'org1',
        name: 'Alice',
        email: 'alice@example.com',
        phone: '+15551234567',
        metadata: { source: 'web' },
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org1',
          name: 'Alice',
          email: 'alice@example.com',
          phone: '+15551234567',
          metadata: { source: 'web' },
        }),
      );
      expect(builder.select).toHaveBeenCalledWith('*');
      expect(builder.single).toHaveBeenCalled();

      expect(result.id).toBe('c1');
      expect(result.organizationId).toBe('org1');
      expect(result.name).toBe('Alice');
    });

    it('creates a contact with only required fields', async () => {
      const minimalRow = {
        ...SAMPLE_ROW,
        name: null,
        email: null,
        phone: null,
        metadata: {},
      };
      builder = createMockQueryBuilder({ data: minimalRow, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.create({ organizationId: 'org1' });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'org1' }),
      );
      expect(result.name).toBeNull();
      expect(result.email).toBeNull();
      expect(result.phone).toBeNull();
    });

    it('throws on database error', async () => {
      builder = createMockQueryBuilder({
        data: null,
        error: { message: 'unique violation' },
      });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      await expect(
        repo.create({ organizationId: 'org1', phone: '+15551234567' }),
      ).rejects.toThrow('ContactRepository.create failed: unique violation');
    });
  });

  describe('update', () => {
    it('updates specified fields and returns the updated Contact', async () => {
      const updatedRow = { ...SAMPLE_ROW, name: 'Alice Updated' };
      builder = createMockQueryBuilder({ data: updatedRow, error: null });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      const result = await repo.update('c1', { name: 'Alice Updated' });

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Alice Updated',
          updated_at: expect.any(String),
        }),
      );
      expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
      expect(builder.single).toHaveBeenCalled();

      expect(result.name).toBe('Alice Updated');
    });

    it('throws on database error', async () => {
      builder = createMockQueryBuilder({
        data: null,
        error: { message: 'not found' },
      });
      db = createMockDb(builder);
      repo = new ContactRepository(db);

      await expect(repo.update('c1', { name: 'New' })).rejects.toThrow(
        'ContactRepository.update failed: not found',
      );
    });
  });
});
