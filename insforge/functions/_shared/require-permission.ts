/**
 * requirePermission — application-layer RBAC guard for JWT-protected
 * function entrypoints.
 *
 * Background (HIGH-1, docs/QA_BUG_HUNT.md): the `rbac` module
 * (`hasPermission` / `checkPermission`) defined a complete permission
 * matrix, was 100% unit-tested, and was re-exported from
 * `packages/support-core/src/services/index.ts` — but was NEVER imported
 * by any function entrypoint, service, or page. The net effect was that
 * any authenticated user had the full permission set: agents could
 * delete orgs, viewers could manage settings, etc. (Whether RLS caught
 * any of this at the SQL layer depended on the table — but the
 * application-layer guard was absent.)
 *
 * This helper closes that hole. It does the same two lookups as
 * `requireOrgMembership` (CRITICAL-2) — load the conversation, then
 * verify the caller is a member of its org — and then a third step
 * specific to HIGH-1: load the caller's role in that org and assert the
 * role grants the required permission. Same DB call shape as
 * `requireOrgMembership` (one conversation lookup + one member lookup)
 * plus an in-memory `hasPermission` check.
 *
 * The call site must map the discriminated result to HTTP status codes:
 *
 *   { kind: 'ok', organizationId, role }   → continue with the mutation
 *   { kind: 'conversation_not_found' }     → 404
 *   { kind: 'forbidden' }                  → 403 (caller is not a member)
 *   { kind: 'insufficient_permissions' }   → 403 (caller is a member but
 *                                             their role lacks the
 *                                             required permission)
 *
 * The helper does NOT import the InsForge SDK or the verify-jwt utility;
 * it only needs a DatabaseClient and the userId from a previous JWT check.
 *
 * IMPORTANT: callers MUST have already verified the user's JWT before
 * calling this helper. This helper assumes `userId` is trusted.
 */

import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { MemberRepository } from '../../../packages/support-core/src/repositories/member-repository.js';
import { hasPermission } from '../../../packages/support-core/src/services/rbac.js';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';
import type { MemberRole } from '../../../packages/support-core/src/types/index.js';
import type { Permission } from '../../../packages/support-core/src/services/rbac.js';

/** Result of a permission check. */
export type PermissionResult =
  /**
   * Caller is a member of the org that owns the conversation AND their
   * role grants the required permission.
   */
  | { kind: 'ok'; organizationId: string; role: MemberRole }
  /** The conversation does not exist (or caller had no way to know it did). */
  | { kind: 'conversation_not_found' }
  /** The conversation exists but the caller is not a member of its org. */
  | { kind: 'forbidden' }
  /**
   * The conversation exists, the caller is a member of its org, but
   * their role does not grant the required permission.
   *
   * `role` is included so the call site can return a clear error like
   * "your role (viewer) does not have permission (reply_conversations)".
   */
  | { kind: 'insufficient_permissions'; role: MemberRole; permission: Permission };

/**
 * Verify that the given user is a member of the org that owns the given
 * conversation AND that their role grants the required permission.
 *
 * @param db - DatabaseClient (typically service-role-key backed in functions)
 * @param userId - The verified JWT subject (the caller's user id)
 * @param conversationId - The conversation the caller wants to mutate
 * @param permission - The permission the endpoint requires
 * @returns A discriminated result indicating ok / not-found / forbidden /
 *          insufficient_permissions
 */
export async function requirePermission(
  db: DatabaseClient,
  userId: string,
  conversationId: string,
  permission: Permission,
): Promise<PermissionResult> {
  const conversationRepo = new ConversationRepository(db);
  const memberRepo = new MemberRepository(db);

  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) {
    return { kind: 'conversation_not_found' };
  }

  const membership = await memberRepo.findByOrgAndUser(conversation.organizationId, userId);
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

  return { kind: 'ok', organizationId: conversation.organizationId, role: membership.role };
}
