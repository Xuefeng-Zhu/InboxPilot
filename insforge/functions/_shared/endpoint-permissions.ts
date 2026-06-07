/**
 * endpoint-permissions — single source of truth for which RBAC permission
 * each JWT-protected serverless function entrypoint requires.
 *
 * Background (HIGH-1, docs/QA_BUG_HUNT.md): every JWT-protected entrypoint
 * that mutates a conversation or org-level setting must call
 * `requirePermission(role, ...)` after `requireOrgMembership` returns
 * `ok`. The map below defines the permission for each endpoint, so:
 *
 *   1. The mapping is in ONE place (auditability: a reviewer can scan
 *      this file to see the whole permission model in seconds).
 *   2. The call site cannot accidentally pick the wrong permission,
 *      because it reads `ENDPOINT_PERMISSIONS[<name>]`.
 *   3. The permission set is exhaustively checked at compile time by
 *      `getRequiredPermission()` — adding a new endpoint without
 *      specifying its permission is a type error.
 *
 * Endpoint classification (matches the suggested fix in QA_BUG_HUNT.md):
 *
 *   send-reply             → reply_conversations     (agent+)
 *   approve-ai-draft       → manage_settings         (admin+)
 *   regenerate-ai-draft    → manage_settings         (admin+)
 *   escalate-conversation  → manage_conversations    (admin+, new perm)
 *   resolve-conversation   → manage_conversations    (admin+, new perm)
 *   reopen-conversation    → manage_conversations    (admin+, new perm)
 *   test-channel-connection→ manage_settings         (admin+)
 *
 * "manage_conversations" was added in this change to cover the
 * lifecycle actions (escalate / resolve / reopen) which agents were
 * not previously able to perform via the UI either, but which the
 * original QA_BUG_HUNT.md flagged as a separate concern from
 * "reply_conversations" (an agent SHOULD be able to reply but SHOULD
 * NOT be able to resolve someone else's conversation).
 */

import type { Permission } from '../../../packages/support-core/src/services/rbac.js';

/** The exhaustive list of JWT-protected entrypoint names that enforce RBAC. */
export type JwtEndpointName =
  | 'send-reply'
  | 'approve-ai-draft'
  | 'regenerate-ai-draft'
  | 'escalate-conversation'
  | 'resolve-conversation'
  | 'reopen-conversation'
  | 'test-channel-connection';

/**
 * The canonical mapping. Add new JWT-protected entrypoints here and
 * the compiler will force you to choose a permission via the
 * `getRequiredPermission` exhaustiveness check.
 */
export const ENDPOINT_PERMISSIONS: Readonly<Record<JwtEndpointName, Permission>> = {
  'send-reply': 'reply_conversations',
  'approve-ai-draft': 'manage_settings',
  'regenerate-ai-draft': 'manage_settings',
  'escalate-conversation': 'manage_conversations',
  'resolve-conversation': 'manage_conversations',
  'reopen-conversation': 'manage_conversations',
  'test-channel-connection': 'manage_settings',
};

/**
 * Look up the required permission for a given endpoint. Throws a
 * programmer-error if the endpoint name is not in the map, which
 * should be impossible at runtime (callers use the `JwtEndpointName`
 * union) but defends against typos in tests.
 */
export function getRequiredPermission(endpoint: JwtEndpointName): Permission {
  const permission = ENDPOINT_PERMISSIONS[endpoint];
  if (!permission) {
    // Unreachable at runtime; the type system prevents unknown names.
    throw new Error(`No permission registered for endpoint: ${endpoint}`);
  }
  return permission;
}
