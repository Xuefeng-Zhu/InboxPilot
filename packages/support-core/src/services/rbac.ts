/**
 * RBAC (Role-Based Access Control) — permission system for organization members.
 *
 * Defines a permission matrix mapping each MemberRole to its allowed operations.
 * Provides `hasPermission` (boolean check) and `checkPermission` (throws on denial).
 *
 * Permission matrix:
 * - owner:  full access (all permissions)
 * - admin:  all except 'delete_org' (no owner transfer or org deletion)
 * - agent:  view/reply conversations, view knowledge base, view settings
 * - viewer: read-only conversations and knowledge base
 *
 * HIGH-1 (docs/QA_BUG_HUNT.md): the `manage_conversations` permission was
 * added so that lifecycle actions (escalate / resolve / reopen) can be
 * granted to admin+ without giving them `manage_settings` or `manage_org`.
 * Previously, those lifecycle endpoints could not be properly RBAC-tagged
 * because there was no permission that meant "admin-tier conversation
 * mutation but not org-level config" — `manage_settings` was the only
 * "admin-only, mutating" permission in the matrix and reusing it for
 * conversation lifecycle would have over-granted the bot/test/admin tiers.
 *
 * The change is additive: agent and viewer permission sets are unchanged
 * (they still cannot escalate/resolve/reopen — the UI never let them
 * anyway). The only behavioral change for the role matrix is that admin
 * now also has `manage_conversations`. The prop tests in
 * `rbac.prop.test.ts` are data-driven off `ALL_PERMISSIONS` and
 * `ROLE_PERMISSIONS`, so adding the permission there automatically
 * updates the test coverage.
 */

import type { MemberRole } from '../types/index.js';

export type Permission =
  | 'manage_org'
  | 'manage_members'
  | 'manage_settings'
  | 'manage_knowledge'
  | 'manage_conversations'
  | 'view_conversations'
  | 'reply_conversations'
  | 'view_knowledge'
  | 'view_settings'
  | 'view_analytics'
  | 'delete_org';

/** All permissions available in the system. */
export const ALL_PERMISSIONS: readonly Permission[] = [
  'manage_org',
  'manage_members',
  'manage_settings',
  'manage_knowledge',
  'manage_conversations',
  'view_conversations',
  'reply_conversations',
  'view_knowledge',
  'view_settings',
  'view_analytics',
  'delete_org',
] as const;

/**
 * Role → Permission mapping.
 *
 * - owner:  all permissions
 * - admin:  all except delete_org (now includes `manage_conversations`
 *           so admins can escalate/resolve/reopen conversations)
 * - agent:  view_conversations, reply_conversations, view_knowledge, view_settings
 * - viewer: view_conversations, view_knowledge
 */
export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: [
    'manage_org',
    'manage_members',
    'manage_settings',
    'manage_knowledge',
    'manage_conversations',
    'view_conversations',
    'reply_conversations',
    'view_knowledge',
    'view_settings',
    'view_analytics',
  ],
  agent: [
    'view_conversations',
    'reply_conversations',
    'view_knowledge',
    'view_settings',
  ],
  viewer: [
    'view_conversations',
    'view_knowledge',
  ],
};

/**
 * Check whether a role has a specific permission.
 *
 * @param role - The member's role
 * @param permission - The permission to check
 * @returns true if the role grants the permission, false otherwise
 */
export function hasPermission(role: MemberRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes(permission);
}

/**
 * Assert that a role has a specific permission. Throws if denied.
 *
 * @param role - The member's role
 * @param permission - The required permission
 * @throws Error with "insufficient permissions" message if the role lacks the permission
 */
export function checkPermission(role: MemberRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(
      `Insufficient permissions: role "${role}" does not have "${permission}" permission`,
    );
  }
}
