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
 */

import type { MemberRole } from '../types/index.js';

export type Permission =
  | 'manage_org'
  | 'manage_members'
  | 'manage_settings'
  | 'manage_knowledge'
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
 * - admin:  all except delete_org
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
