/**
 * verifyOrgAnalyticsPermission — RBAC guard for org-scoped read
 * endpoints (e.g. analytics-overview) where the caller passes the
 * orgId directly instead of a conversationId.
 *
 * Background (HIGH-1 + HIGH-8, docs/QA_BUG_HUNT.md):
 *   The existing `requirePermission` helper (`require-permission.ts`)
 *   is conversation-scoped: it derives the org from a conversation
 *   the caller is trying to mutate. That's the right shape for
 *   write endpoints (send-reply, escalate, etc.) but is awkward for
 *   read endpoints that work on the org directly — the analytics
 *   page doesn't have a conversationId to anchor on; it has an orgId
 *   the user picked from a switcher.
 *
 *   This helper is the org-scoped analog: it loads the caller's
 *   membership in the target org and checks `view_analytics` (or any
 *   other permission you ask for) against the role. Same call shape
 *   as the existing helpers (DatabaseClient + userId + orgId +
 *   permission), same discriminated result the call site maps to
 *   HTTP status codes:
 *
 *     { kind: 'ok', role }                 → continue
 *     { kind: 'forbidden' }                → 403 (not a member)
 *     { kind: 'insufficient_permissions' } → 403 (member without the
 *                                             required permission)
 *
 *   The conversation-not-found case from the other helpers does not
 *   apply here — the org-not-found case is checked separately by the
 *   entrypoint via OrganizationRepository.findById before this
 *   helper is called.
 *
 *   This helper does NOT import the InsForge SDK or the verify-jwt
 *   utility; it only needs a DatabaseClient and the userId from a
 *   previous JWT check.
 *
 * IMPORTANT: callers MUST have already verified the user's JWT and
 * confirmed the org exists. This helper assumes `userId` is trusted
 * and `organizationId` is a real org id.
 */

import { MemberRepository } from '../../../packages/support-core/src/repositories/member-repository.js';
import { hasPermission } from '../../../packages/support-core/src/services/rbac.js';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';
import type { MemberRole } from '../../../packages/support-core/src/types/index.js';
import type { Permission } from '../../../packages/support-core/src/services/rbac.js';

/** Result of an org-scoped permission check. */
export type OrgPermissionResult =
  /** Caller is a member of the org AND their role grants the permission. */
  | { kind: 'ok'; role: MemberRole }
  /** The caller is not a member of the org. */
  | { kind: 'forbidden' }
  /**
   * The caller IS a member of the org but their role does not grant
   * the required permission.
   */
  | { kind: 'insufficient_permissions'; role: MemberRole; permission: Permission };

/**
 * Verify that the given user is a member of the given org AND that
 * their role grants the required permission.
 *
 * @param db - DatabaseClient (typically service-role-key backed in functions)
 * @param userId - The verified JWT subject
 * @param organizationId - The org the endpoint is acting on
 * @param permission - The permission the endpoint requires
 * @returns A discriminated result indicating ok / forbidden / insufficient_permissions
 */
export async function verifyOrgAnalyticsPermission(
  db: DatabaseClient,
  userId: string,
  organizationId: string,
  permission: Permission,
): Promise<OrgPermissionResult> {
  const memberRepo = new MemberRepository(db);

  const membership = await memberRepo.findByOrgAndUser(organizationId, userId);
  if (!membership) {
    return { kind: 'forbidden' };
  }

  if (!hasPermission(membership.role, permission)) {
    return {
      kind: 'insufficient_permissions',
      role: membership.role,
      permission,
    };
  }

  return { kind: 'ok', role: membership.role };
}
