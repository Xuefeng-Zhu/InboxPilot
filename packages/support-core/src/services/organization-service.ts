/**
 * OrganizationService — orchestrates organization and member management.
 *
 * Provides:
 * - createOrganization: creates org and assigns creator as owner
 * - inviteMember: adds a member with a specified role
 * - changeMemberRole: updates role, enforces single-owner invariant
 * - removeMember: removes member, prevents removing the last owner
 *
 * Records audit log entries for each action.
 * This service never imports InsForge SDK — all dependencies are injected.
 */

import type { OrganizationRepository } from '../repositories/organization-repository.js';
import type { MemberRepository } from '../repositories/member-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { Organization, OrganizationMember, MemberRole } from '../types/index.js';

export class OrganizationService {
  constructor(
    private orgRepo: OrganizationRepository,
    private memberRepo: MemberRepository,
    private auditLog: AuditLogRepository,
  ) {}

  /**
   * Create a new organization and assign the creating user as the owner.
   *
   * @param name - Organization display name
   * @param slug - Unique URL-friendly slug
   * @param userId - The user ID of the creator (becomes owner)
   * @returns The created organization and owner member
   */
  async createOrganization(
    name: string,
    slug: string,
    userId: string,
  ): Promise<{ organization: Organization; member: OrganizationMember }> {
    // Create the organization record
    const organization = await this.orgRepo.create({ name, slug });

    // Assign the creator as the owner
    const member = await this.memberRepo.create({
      organizationId: organization.id,
      userId,
      role: 'owner',
    });

    // Record audit log
    await this.auditLog.create({
      organizationId: organization.id,
      actorId: userId,
      actorType: 'user',
      action: 'organization_created',
      resourceType: 'organization',
      resourceId: organization.id,
    });

    return { organization, member };
  }

  /**
   * Invite a user to an organization with a specified role.
   * The invited role cannot be "owner" — ownership is assigned only at creation
   * or via changeMemberRole (which transfers ownership).
   *
   * @param orgId - Organization ID
   * @param userId - The user ID to invite
   * @param role - The role to assign (admin, agent, or viewer)
   * @returns The created member record
   */
  async inviteMember(
    orgId: string,
    userId: string,
    role: MemberRole,
  ): Promise<OrganizationMember> {
    if (role === 'owner') {
      throw new Error('Cannot invite a member as owner. Use changeMemberRole to transfer ownership.');
    }

    const member = await this.memberRepo.create({
      organizationId: orgId,
      userId,
      role,
    });

    // Record audit log
    await this.auditLog.create({
      organizationId: orgId,
      actorId: userId,
      actorType: 'user',
      action: 'member_added',
      resourceType: 'organization_member',
      resourceId: member.id,
      metadata: { role },
    });

    return member;
  }

  /**
   * Change a member's role. Enforces the single-owner invariant:
   * - If changing TO owner, the current owner is demoted to admin.
   * - If changing FROM owner, there must be another owner (handled by the
   *   transfer logic above — the caller must set a new owner first).
   *
   * @param orgId - Organization ID
   * @param memberId - The member ID whose role is being changed
   * @param newRole - The new role to assign
   * @returns The updated member record
   */
  async changeMemberRole(
    orgId: string,
    memberId: string,
    newRole: MemberRole,
  ): Promise<OrganizationMember> {
    const members = await this.memberRepo.listByOrg(orgId);
    const target = members.find((m) => m.id === memberId);

    if (!target) {
      throw new Error(`Member ${memberId} not found in organization ${orgId}`);
    }

    const currentRole = target.role;

    // If demoting the current owner, ensure there's another owner
    if (currentRole === 'owner' && newRole !== 'owner') {
      const otherOwners = members.filter(
        (m) => m.role === 'owner' && m.id !== memberId,
      );
      if (otherOwners.length === 0) {
        throw new Error(
          'Cannot change role of the only owner. Transfer ownership to another member first.',
        );
      }
    }

    // If promoting to owner, demote the current owner to admin
    if (newRole === 'owner' && currentRole !== 'owner') {
      const currentOwner = members.find(
        (m) => m.role === 'owner' && m.id !== memberId,
      );
      if (currentOwner) {
        await this.memberRepo.update(currentOwner.id, { role: 'admin' });
      }
    }

    const updated = await this.memberRepo.update(memberId, { role: newRole });

    // Record audit log
    await this.auditLog.create({
      organizationId: orgId,
      actorType: 'user',
      action: 'member_role_changed',
      resourceType: 'organization_member',
      resourceId: memberId,
      metadata: { previousRole: currentRole, newRole },
    });

    return updated;
  }

  /**
   * Remove a member from an organization.
   * Prevents removing the last owner.
   *
   * @param orgId - Organization ID
   * @param memberId - The member ID to remove
   */
  async removeMember(orgId: string, memberId: string): Promise<void> {
    const members = await this.memberRepo.listByOrg(orgId);
    const target = members.find((m) => m.id === memberId);

    if (!target) {
      throw new Error(`Member ${memberId} not found in organization ${orgId}`);
    }

    // Prevent removing the last owner
    if (target.role === 'owner') {
      const otherOwners = members.filter(
        (m) => m.role === 'owner' && m.id !== memberId,
      );
      if (otherOwners.length === 0) {
        throw new Error(
          'Cannot remove the only owner. Transfer ownership to another member first.',
        );
      }
    }

    await this.memberRepo.delete(memberId);

    // Record audit log
    await this.auditLog.create({
      organizationId: orgId,
      actorId: target.userId,
      actorType: 'user',
      action: 'member_removed',
      resourceType: 'organization_member',
      resourceId: memberId,
    });
  }
}
