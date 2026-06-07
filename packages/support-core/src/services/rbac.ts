/**
 * RBAC (Role-Based Access Control) — permission system for organization members.
 *
 * Defines a permission matrix mapping each MemberRole to its allowed operations.
 * Provides `hasPermission` (boolean check) and `checkPermission` (throws on denial).
 *
 * Permission matrix:
 * - owner:  full access (all permissions)
 * - admin:  all except 'delete_org' (no owner transfer or org deletion)
 * - agent:  view/reply conversations, view knowledge base, view settings, and
 *           manage conversation state (escalate/resolve/reopen) on assigned
 *           conversations
 * - viewer: read-only conversations and knowledge base
 *
 * HIGH-1 from docs/QA_BUG_HUNT.md: this matrix is now actually enforced at the
 * application layer (see insforge/functions/_shared/require-permission.ts),
 * not just unit-tested.
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
 * - admin:  all except delete_org
 * - agent:  view/reply conversations, view KB, view settings, AND manage
 *           conversation state (escalate/resolve/reopen) — agents are the
 *           day-to-day operators who triage and resolve tickets
 * - viewer: read-only conversations and knowledge base
 *
 * Note: agent intentionally does NOT include `manage_settings` (settings
 * change affects org-wide behaviour) or `manage_knowledge` (KB edits are
 * admin-level). They get `manage_conversations` so they can escalate /
 * resolve / reopen without needing admin to babysit every state change.
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
    'manage_conversations',
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
