import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { MemberRole, OrganizationMember } from '../../src/types/index.js';
import {
  hasPermission,
  checkPermission,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
} from '../../src/services/rbac.js';
import type { Permission } from '../../src/services/rbac.js';
import { OrganizationService } from '../../src/services/organization-service.js';
import type { OrganizationRepository } from '../../src/repositories/organization-repository.js';
import type { MemberRepository } from '../../src/repositories/member-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';

/**
 * Property-based tests for organization owner invariant and RBAC permission enforcement.
 *
 * Feature: ai-customer-support
 */

// ─── Constants ───────────────────────────────────────────────────────

const ALL_ROLES: MemberRole[] = ['owner', 'admin', 'agent', 'viewer'];
const NON_OWNER_ROLES: MemberRole[] = ['admin', 'agent', 'viewer'];

// ─── Arbitraries ─────────────────────────────────────────────────────

const roleArb = fc.constantFrom<MemberRole>(...ALL_ROLES);
const nonOwnerRoleArb = fc.constantFrom<MemberRole>(...NON_OWNER_ROLES);
const permissionArb = fc.constantFrom<Permission>(...ALL_PERMISSIONS);

// ─── In-memory member store for simulating org operations ────────────

interface InMemoryMember {
  id: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
}

type MemberOp =
  | { type: 'invite'; userId: string; role: MemberRole }
  | { type: 'changeRole'; targetIndex: number; newRole: MemberRole }
  | { type: 'remove'; targetIndex: number };

/**
 * Arbitrary that generates a sequence of member operations.
 * Operations are constrained to be plausible (invite non-owner roles,
 * change/remove existing members by index).
 */
const memberOpArb: fc.Arbitrary<MemberOp> = fc.oneof(
  // Invite a new member with a non-owner role
  fc.record({
    type: fc.constant('invite' as const),
    userId: fc.uuid(),
    role: nonOwnerRoleArb,
  }),
  // Change role of an existing member (by index into current members list)
  fc.record({
    type: fc.constant('changeRole' as const),
    targetIndex: fc.nat({ max: 20 }),
    newRole: roleArb,
  }),
  // Remove an existing member (by index into current members list)
  fc.record({
    type: fc.constant('remove' as const),
    targetIndex: fc.nat({ max: 20 }),
  }),
);

const memberOpsArb = fc.array(memberOpArb, { minLength: 0, maxLength: 15 });

// ─── Mock helpers for OrganizationService tests ──────────────────────

function createMockOrgRepo(): OrganizationRepository {
  return {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn().mockImplementation(async (input: { name: string; slug: string }) => ({
      id: 'org-' + Math.random().toString(36).slice(2, 8),
      name: input.name,
      slug: input.slug,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as OrganizationRepository;
}

function createMockAuditLogRepo(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'audit-' + Math.random().toString(36).slice(2, 8),
      organizationId: 'org-1',
      actorId: null,
      actorType: 'user',
      action: 'test',
      resourceType: 'test',
      resourceId: null,
      metadata: {},
      createdAt: new Date(),
    }),
  } as unknown as AuditLogRepository;
}

/**
 * Create a mock MemberRepository backed by an in-memory array.
 * This lets us simulate real member operations for the owner invariant test.
 */
function createInMemoryMemberRepo(members: InMemoryMember[]) {
  let idCounter = members.length;

  const repo = {
    findByOrgAndUser: vi.fn().mockImplementation(
      async (orgId: string, userId: string) =>
        members.find((m) => m.organizationId === orgId && m.userId === userId) ?? null,
    ),
    listByOrg: vi.fn().mockImplementation(async (orgId: string) =>
      members
        .filter((m) => m.organizationId === orgId)
        .map((m) => ({
          ...m,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
    ),
    create: vi.fn().mockImplementation(
      async (input: { organizationId: string; userId: string; role: MemberRole }) => {
        const member: InMemoryMember = {
          id: `member-${++idCounter}`,
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
        };
        members.push(member);
        return { ...member, createdAt: new Date(), updatedAt: new Date() };
      },
    ),
    update: vi.fn().mockImplementation(
      async (id: string, updates: Partial<{ role: MemberRole }>) => {
        const member = members.find((m) => m.id === id);
        if (!member) throw new Error(`Member ${id} not found`);
        if (updates.role !== undefined) member.role = updates.role;
        return { ...member, createdAt: new Date(), updatedAt: new Date() };
      },
    ),
    delete: vi.fn().mockImplementation(async (id: string) => {
      const idx = members.findIndex((m) => m.id === id);
      if (idx >= 0) members.splice(idx, 1);
    }),
  } as unknown as MemberRepository;

  return repo;
}

// ─── Property Tests ──────────────────────────────────────────────────

describe('RBAC property tests', () => {
  /**
   * Property 13: Organization owner invariant
   *
   * For any sequence of member operations (invite, role change, remove),
   * there is always exactly one owner. Operations that would violate this
   * invariant are rejected.
   *
   * **Validates: Requirements 2.2**
   *
   * Feature: ai-customer-support, Property 13: Organization owner invariant
   */
  it('Property 13: Organization owner invariant — always exactly one owner after any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(memberOpsArb, async (ops) => {
        const orgId = 'org-test';
        const ownerUserId = 'user-owner';

        // Start with a single owner member
        const members: InMemoryMember[] = [
          { id: 'member-0', organizationId: orgId, userId: ownerUserId, role: 'owner' },
        ];

        const memberRepo = createInMemoryMemberRepo(members);
        const orgRepo = createMockOrgRepo();
        const auditRepo = createMockAuditLogRepo();
        const service = new OrganizationService(orgRepo, memberRepo, auditRepo);

        // Apply each operation, catching expected errors
        for (const op of ops) {
          try {
            switch (op.type) {
              case 'invite':
                await service.inviteMember(orgId, op.userId, op.role);
                break;
              case 'changeRole': {
                const currentMembers = members.filter((m) => m.organizationId === orgId);
                if (currentMembers.length === 0) break;
                const target = currentMembers[op.targetIndex % currentMembers.length];
                await service.changeMemberRole(orgId, target.id, op.newRole);
                break;
              }
              case 'remove': {
                const currentMembers = members.filter((m) => m.organizationId === orgId);
                if (currentMembers.length === 0) break;
                const target = currentMembers[op.targetIndex % currentMembers.length];
                await service.removeMember(orgId, target.id);
                break;
              }
            }
          } catch {
            // Expected: operations that would violate the invariant are rejected
          }

          // INVARIANT: After every operation, there must be exactly one owner
          const currentMembers = members.filter((m) => m.organizationId === orgId);
          const owners = currentMembers.filter((m) => m.role === 'owner');
          expect(owners.length).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 14: RBAC permission enforcement
   *
   * For any member with a given role and any operation, permission is granted
   * if and only if the operation is in the role's permitted set.
   *
   * Specifically:
   * - owner has full access (all permissions)
   * - admin has all except 'delete_org'
   * - agent has view_conversations, reply_conversations, view_knowledge, view_settings
   * - viewer has view_conversations, view_knowledge
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * Feature: ai-customer-support, Property 14: RBAC permission enforcement
   */
  it('Property 14: RBAC permission enforcement — hasPermission matches role permission set', () => {
    fc.assert(
      fc.property(roleArb, permissionArb, (role, permission) => {
        const permitted = ROLE_PERMISSIONS[role];
        const expected = permitted.includes(permission);
        const actual = hasPermission(role, permission);

        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: RBAC — checkPermission throws iff permission is not in role set', () => {
    fc.assert(
      fc.property(roleArb, permissionArb, (role, permission) => {
        const permitted = ROLE_PERMISSIONS[role];
        const shouldBeAllowed = permitted.includes(permission);

        if (shouldBeAllowed) {
          expect(() => checkPermission(role, permission)).not.toThrow();
        } else {
          expect(() => checkPermission(role, permission)).toThrow(/Insufficient permissions/);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: RBAC — owner has all permissions', () => {
    fc.assert(
      fc.property(permissionArb, (permission) => {
        expect(hasPermission('owner', permission)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: RBAC — admin has all permissions except delete_org', () => {
    fc.assert(
      fc.property(permissionArb, (permission) => {
        if (permission === 'delete_org') {
          expect(hasPermission('admin', permission)).toBe(false);
        } else {
          expect(hasPermission('admin', permission)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: RBAC — agent permissions are exactly {view_conversations, reply_conversations, view_knowledge, view_settings}', () => {
    const agentPermissions = new Set<Permission>([
      'view_conversations',
      'reply_conversations',
      'view_knowledge',
      'view_settings',
    ]);

    fc.assert(
      fc.property(permissionArb, (permission) => {
        expect(hasPermission('agent', permission)).toBe(agentPermissions.has(permission));
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: RBAC — viewer permissions are exactly {view_conversations, view_knowledge}', () => {
    const viewerPermissions = new Set<Permission>([
      'view_conversations',
      'view_knowledge',
    ]);

    fc.assert(
      fc.property(permissionArb, (permission) => {
        expect(hasPermission('viewer', permission)).toBe(viewerPermissions.has(permission));
      }),
      { numRuns: 100 },
    );
  });

  it('Property 14: RBAC — role hierarchy: owner ⊇ admin ⊇ agent, owner ⊇ admin ⊇ viewer', () => {
    fc.assert(
      fc.property(permissionArb, (permission) => {
        // If admin has it, owner must have it
        if (hasPermission('admin', permission)) {
          expect(hasPermission('owner', permission)).toBe(true);
        }
        // If agent has it, admin must have it
        if (hasPermission('agent', permission)) {
          expect(hasPermission('admin', permission)).toBe(true);
        }
        // If viewer has it, agent must have it
        if (hasPermission('viewer', permission)) {
          expect(hasPermission('agent', permission)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
