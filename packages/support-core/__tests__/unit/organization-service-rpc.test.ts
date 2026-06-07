/**
 * Unit tests for OrganizationService.createOrganization (CRITICAL-1 fix).
 *
 * Background
 * ----------
 * The `organizations` table's INSERT policy is `WITH CHECK (false)` (after
 * migration 007_org_rpc_functions.sql). The only sanctioned bootstrap path
 * is the SECURITY DEFINER RPC `public.create_organization(name, slug)`.
 * This RPC, in one transaction:
 *   1. inserts the `organizations` row,
 *   2. inserts the matching `organization_members` row (role = 'owner',
 *      user_id = auth.uid() from the JWT 'sub' claim),
 *   3. appends an `audit_logs` row (action = 'organization_created').
 *
 * These tests verify the service's contract with that RPC:
 *   - It calls `db.rpc('create_organization', {name, slug})` — NOT
 *     `orgRepo.create` (which would now be blocked by RLS).
 *   - It does NOT call `memberRepo.create` or `auditLog.create` for the
 *     bootstrap (the RPC does those in a single transaction).
 *   - It does NOT trust the caller's `userId` to set the owner — the
 *     owner is always the JWT 'sub', and the service uses the passed
 *     `userId` only to re-fetch the just-created membership.
 *   - The unique-slug violation surfaces as a thrown error (the service
 *     should not silently swallow it; LOW-5 in docs/QA_BUG_HUNT.md tracks
 *     adding a retry loop at the caller layer).
 *
 * The test name and id follow the convention used by other P0 fix
 * tests in this repo (e.g. t_07898437 → CRITICAL-2).
 */

import { describe, it, expect, vi } from 'vitest';
import { OrganizationService } from '../../src/services/organization-service.js';
import type { OrganizationRepository } from '../../src/repositories/organization-repository.js';
import type { MemberRepository } from '../../src/repositories/member-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type {
  DatabaseClient,
  QueryResult,
  QueryError,
} from '../../src/interfaces/database-client.js';

function makeMockDb(rpcResult: QueryResult): { db: DatabaseClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const db = { from: vi.fn(), rpc } as unknown as DatabaseClient;
  return { db, rpc };
}

function makeMockOrgRepo(): { repo: OrganizationRepository; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  const repo = {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create,
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as OrganizationRepository;
  return { repo, create };
}

function makeMockMemberRepo(): { repo: MemberRepository; create: ReturnType<typeof vi.fn>; findByOrgAndUser: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  const findByOrgAndUser = vi.fn();
  const repo = {
    findByOrgAndUser,
    listByOrg: vi.fn(),
    create,
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as MemberRepository;
  return { repo, create, findByOrgAndUser };
}

function makeMockAuditRepo(): { repo: AuditLogRepository; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  const repo = { create } as unknown as AuditLogRepository;
  return { repo, create };
}

describe('OrganizationService.createOrganization — CRITICAL-1 RPC path', () => {
  it('calls db.rpc("create_organization", { name, slug }) and returns {organization, member}', async () => {
    const orgId = '00000000-0000-0000-0000-000000000abc';
    const userId = 'usr_alice';
    const rpcReturn = {
      data: {
        id: orgId,
        name: 'Acme Co',
        slug: 'acme',
        metadata: {},
        created_at: '2026-06-07T00:00:00.000Z',
        updated_at: '2026-06-07T00:00:00.000Z',
      },
      error: null,
    };
    const { db, rpc } = makeMockDb(rpcReturn);
    const { repo: orgRepo, create: orgCreate } = makeMockOrgRepo();
    const { repo: memberRepo, create: memberCreate, findByOrgAndUser } = makeMockMemberRepo();
    const { repo: auditRepo, create: auditCreate } = makeMockAuditRepo();

    findByOrgAndUser.mockResolvedValue({
      id: 'member-1',
      organizationId: orgId,
      userId,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new OrganizationService(orgRepo, memberRepo, auditRepo, db);
    const result = await service.createOrganization('Acme Co', 'acme', userId);

    // The RPC was called exactly once with {name, slug} and no userId.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_organization', { name: 'Acme Co', slug: 'acme' });

    // orgRepo.create / memberRepo.create / auditLog.create are NOT called —
    // the RPC is the single source of truth for the bootstrap transaction.
    expect(orgCreate).not.toHaveBeenCalled();
    expect(memberCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();

    // The service's return value matches the RPC's data shape.
    expect(result.organization.id).toBe(orgId);
    expect(result.organization.name).toBe('Acme Co');
    expect(result.organization.slug).toBe('acme');
    expect(result.organization.createdAt).toBeInstanceOf(Date);
    expect(result.member.organizationId).toBe(orgId);
    expect(result.member.userId).toBe(userId);
    expect(result.member.role).toBe('owner');
  });

  it('surfaces a unique_violation from the RPC as a thrown error (no silent swallow)', async () => {
    const error: QueryError = {
      message: 'duplicate key value violates unique constraint "organizations_slug_key"',
      code: '23505',
      details: 'Key (slug)=(acme) already exists.',
    };
    const { db, rpc } = makeMockDb({ data: null, error });
    const { repo: orgRepo } = makeMockOrgRepo();
    const { repo: memberRepo } = makeMockMemberRepo();
    const { repo: auditRepo } = makeMockAuditRepo();

    const service = new OrganizationService(orgRepo, memberRepo, auditRepo, db);

    await expect(
      service.createOrganization('Acme Co', 'acme', 'usr_alice'),
    ).rejects.toThrow(/create_organization.*duplicate key/i);
  });

  it('surfaces insufficient_privilege from the RPC when the JWT is missing', async () => {
    const error: QueryError = {
      message:
        'create_organization: caller must be authenticated (auth.uid() is empty)',
      code: '42501',
    };
    const { db, rpc } = makeMockDb({ data: null, error });
    const { repo: orgRepo } = makeMockOrgRepo();
    const { repo: memberRepo } = makeMockMemberRepo();
    const { repo: auditRepo } = makeMockAuditRepo();

    const service = new OrganizationService(orgRepo, memberRepo, auditRepo, db);

    await expect(
      service.createOrganization('Acme Co', 'acme', 'usr_alice'),
    ).rejects.toThrow(/must be authenticated/);
  });

  it('throws when memberRepo.findByOrgAndUser returns null (caller userId ≠ JWT sub)', async () => {
    // RPC succeeded (org was created), but findByOrgAndUser didn't find
    // the (org, userId) pair — this happens when the route handler passed
    // a userId that doesn't match the JWT 'sub'. Surface loudly.
    const orgId = '00000000-0000-0000-0000-000000000def';
    const { db, rpc } = makeMockDb({
      data: {
        id: orgId,
        name: 'Acme Co',
        slug: 'acme',
        metadata: {},
        created_at: '2026-06-07T00:00:00.000Z',
        updated_at: '2026-06-07T00:00:00.000Z',
      },
      error: null,
    });
    const { repo: orgRepo } = makeMockOrgRepo();
    const { repo: memberRepo, findByOrgAndUser } = makeMockMemberRepo();
    const { repo: auditRepo } = makeMockAuditRepo();
    findByOrgAndUser.mockResolvedValue(null);

    const service = new OrganizationService(orgRepo, memberRepo, auditRepo, db);

    await expect(
      service.createOrganization('Acme Co', 'acme', 'usr_bob'),
    ).rejects.toThrow(/owner membership not found.*usr_bob/);
  });

  it('throws when the RPC returns neither data nor error (defensive — should not happen)', async () => {
    const { db, rpc } = makeMockDb({ data: null, error: null });
    const { repo: orgRepo } = makeMockOrgRepo();
    const { repo: memberRepo } = makeMockMemberRepo();
    const { repo: auditRepo } = makeMockAuditRepo();

    const service = new OrganizationService(orgRepo, memberRepo, auditRepo, db);

    await expect(
      service.createOrganization('Acme Co', 'acme', 'usr_alice'),
    ).rejects.toThrow(/RPC returned no data/);
  });
});
