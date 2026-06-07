/**
 * requirePermission — application-layer RBAC enforcement for JWT-protected
 * function entrypoints.
 *
 * Background (HIGH-1, docs/QA_BUG_HUNT.md): the `hasPermission` /
 * `checkPermission` functions in `packages/support-core/src/services/rbac.ts`
 * were 100% covered by property-based tests but 0% enforced in production.
 * The permission system was effectively dead code: any authenticated user
 * could call any JWT-protected entrypoint and act as if they had every
 * permission. (The SQL-layer RLS policies in `insforge/migrations/` still
 * apply, but a viewer was able to invoke e.g. `approve-ai-draft` and force
 * an AI message to be sent on a real customer conversation.)
 *
 * This helper closes that hole. After `requireOrgMembership` (which
 * establishes *that* the caller is a member of the org that owns the
 * conversation/resource), `requirePermission` answers *what* the caller
 * is allowed to do. It looks up the caller's role in the org, then
 * delegates to the in-memory `checkPermission` for the boolean check.
 *
 * IMPORTANT: callers MUST have already verified the user's JWT AND
 * established org membership before calling this helper. The orgId is
 * not derived here — it comes from `requireOrgMembership`'s result, so
 * there is no way to accidentally use the caller's own (possibly empty)
 * orgId.
 *
 * The helper does NOT import the InsForge SDK; it only needs a
 * `DatabaseClient` and the userId/orgId from prior checks. Errors are
 * surfaced through a discriminated result that the call site must map
 * to an HTTP response:
 *
 *   { kind: 'ok' }                     → continue with the work
 *   { kind: 'role_not_found' }         → 403 (caller is a member but
 *                                         has no role row — should never
 *                                         happen; surfaced as 500 by
 *                                         call site for safety)
 *   { kind: 'forbidden', reason }      → 403 (caller lacks the permission)
 *   { kind: 'infrastructure_error' }   → thrown — call site maps to 500
 *
 * The infrastructure-error case is intentionally thrown (not returned
 * as a discriminated variant) so that a DB outage cannot be mistaken
 * for an authorization failure. This matches the pattern in
 * `requireOrgMembership`.
 */

import { MemberRepository } from '../../../packages/support-core/src/repositories/member-repository.js';
import { checkPermission } from '../../../packages/support-core/src/services/rbac.js';
import type { Permission } from '../../../packages/support-core/src/services/rbac.js';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';

/** Result of a permission check against a known orgId. */
export type PermissionResult =
  /** Caller has the required permission. Safe to proceed. */
  | { kind: 'ok' }
  /** Caller is a member of the org but has no role row — data integrity bug. */
  | { kind: 'role_not_found' }
  /** Caller's role does not grant the required permission. */
  | { kind: 'forbidden'; reason: string };

/**
 * Verify that the given user (already proven to be a member of the org)
 * has the required permission for the given orgId.
 *
 * @param db - DatabaseClient (typically service-role-key backed in functions)
 * @param userId - The verified JWT subject (the caller's user id)
 * @param orgId - The org the caller is acting against (from requireOrgMembership)
 * @param permission - The permission required for this endpoint
 * @returns A discriminated result the caller must map to an HTTP response
 * @throws Error if the membership lookup fails for an infrastructure reason
 *   (DB connection refused, etc.). Authorization failures do NOT throw.
 */
export async function requirePermission(
  db: DatabaseClient,
  userId: string,
  orgId: string,
  permission: Permission,
): Promise<PermissionResult> {
  const memberRepo = new MemberRepository(db);

  const membership = await memberRepo.findByOrgAndUser(orgId, userId);
  if (!membership) {
    // Should be unreachable — requireOrgMembership already established
    // the caller is a member. If we get here, the membership row was
    // deleted between the two calls. Treat as forbidden (do not leak
    // the fact that the row vanished mid-request).
    return { kind: 'role_not_found' };
  }

  try {
    checkPermission(membership.role, permission);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'permission denied';
    return { kind: 'forbidden', reason };
  }

  return { kind: 'ok' };
}
