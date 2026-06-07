/**
 * Unit tests for the endpoint-permissions map.
 *
 * This is the single source of truth for which RBAC permission each
 * JWT-protected entrypoint requires. The map is the linchpin of
 * HIGH-1 enforcement: if a new JWT-protected entrypoint is added
 * without a corresponding entry in the map, the call site will
 * throw at compile time (`getRequiredPermission` is typed by
 * `JwtEndpointName`). These tests pin the current mapping so a
 * reviewer can see the whole permission model in one file.
 */

import { describe, it, expect } from 'vitest';
import {
  ENDPOINT_PERMISSIONS,
  getRequiredPermission,
} from '../../../../insforge/functions/_shared/endpoint-permissions.js';
import { ROLE_PERMISSIONS, hasPermission } from '../../src/services/rbac.js';
import type { JwtEndpointName } from '../../../../insforge/functions/_shared/endpoint-permissions.js';

describe('endpoint-permissions (HIGH-1 per-endpoint map)', () => {
  it('every endpoint has a non-empty permission', () => {
    for (const [endpoint, perm] of Object.entries(ENDPOINT_PERMISSIONS)) {
      expect(perm, `${endpoint} should have a permission`).toBeTruthy();
    }
  });

  it('agents can call send-reply (reply_conversations) but not the others', () => {
    // Agents should be allowed to reply to customer conversations.
    // They must NOT be allowed to approve-ai-draft, regenerate-ai-draft,
    // escalate, resolve, reopen, or test-channel-connection — those
    // are admin+ operations.
    const agent = ROLE_PERMISSIONS.agent;
    expect(agent).toContain(ENDPOINT_PERMISSIONS['send-reply']);

    for (const endpoint of [
      'approve-ai-draft',
      'regenerate-ai-draft',
      'escalate-conversation',
      'resolve-conversation',
      'reopen-conversation',
      'test-channel-connection',
    ] as const satisfies readonly JwtEndpointName[]) {
      expect(
        agent,
        `agent must NOT have ${ENDPOINT_PERMISSIONS[endpoint]} (used by ${endpoint})`,
      ).not.toContain(ENDPOINT_PERMISSIONS[endpoint]);
    }
  });

  it('viewers cannot call any mutating endpoint', () => {
    // Viewers are read-only. Every endpoint in the map must be
    // denied for them. This is the core regression: previously,
    // viewers were effectively admins because the rbac module was
    // dead code.
    const viewer = ROLE_PERMISSIONS.viewer;
    for (const [endpoint, perm] of Object.entries(ENDPOINT_PERMISSIONS)) {
      expect(
        viewer,
        `viewer must NOT have ${perm} (used by ${endpoint})`,
      ).not.toContain(perm);
    }
  });

  it('owners can call every endpoint', () => {
    // Sanity: the highest-trust role has the full set.
    const owner = ROLE_PERMISSIONS.owner;
    for (const perm of Object.values(ENDPOINT_PERMISSIONS)) {
      expect(owner).toContain(perm);
    }
  });

  it('admins can call every endpoint except those requiring delete_org', () => {
    // None of the current endpoints require delete_org (that perm is
    // only relevant for org-level destructive actions), so admins
    // should be allowed everywhere today. This is a forward-looking
    // guard: if someone adds an endpoint that requires delete_org
    // without re-evaluating this, the test will fail and force a
    // conversation about whether admins should be allowed.
    for (const perm of Object.values(ENDPOINT_PERMISSIONS)) {
      expect(hasPermission('admin', perm)).toBe(true);
    }
  });

  it('getRequiredPermission returns the same value as ENDPOINT_PERMISSIONS', () => {
    for (const endpoint of Object.keys(ENDPOINT_PERMISSIONS) as JwtEndpointName[]) {
      expect(getRequiredPermission(endpoint)).toBe(ENDPOINT_PERMISSIONS[endpoint]);
    }
  });

  it('manage_conversations is granted to owner and admin only (escalate/resolve/reopen are admin+)', async () => {
    // The new permission added in this change. Pin the role set so
    // future changes to the role matrix don't silently widen it.
    const { ALL_PERMISSIONS } = await import('../../src/services/rbac.js');
    expect(ALL_PERMISSIONS).toContain('manage_conversations');
    expect(ROLE_PERMISSIONS.owner).toContain('manage_conversations');
    expect(ROLE_PERMISSIONS.admin).toContain('manage_conversations');
    expect(ROLE_PERMISSIONS.agent).not.toContain('manage_conversations');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('manage_conversations');
  });

  it('admin has every permission in the endpoint map', () => {
    // Pin that admins (the most common privileged role) can call every
    // current endpoint. If a new endpoint requires a permission admins
    // don't have, this test will fail and force a role-matrix review.
    for (const perm of Object.values(ENDPOINT_PERMISSIONS)) {
      expect(hasPermission('admin', perm)).toBe(true);
    }
  });
});
