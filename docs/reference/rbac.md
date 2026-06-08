# RBAC

> Role-based access control for organization members. Permission matrix and enforcement points.

## Roles

`MemberRole` is the union `'owner' | 'admin' | 'agent' | 'viewer'`. Stored in `organization_members.role` with a CHECK constraint.

| Role | Description |
|---|---|
| `owner` | Full control of the organization, including deletion. Exactly one owner enforced by `OrganizationService`. |
| `admin` | All org operations except deletion. Can manage members, settings, and knowledge. |
| `agent` | Frontline staff. Reads and replies to conversations, reads knowledge, views settings. |
| `viewer` | Read-only. Conversations and knowledge base. |

## Permission matrix

Source: `packages/support-core/src/services/rbac.ts` (`ROLE_PERMISSIONS` and `ALL_PERMISSIONS`).

| Permission | owner | admin | agent | viewer |
|---|:---:|:---:|:---:|:---:|
| `manage_org` | ✓ | ✓ | | |
| `manage_members` | ✓ | ✓ | | |
| `manage_settings` | ✓ | ✓ | | |
| `manage_knowledge` | ✓ | ✓ | | |
| `view_conversations` | ✓ | ✓ | ✓ | ✓ |
| `reply_conversations` | ✓ | ✓ | ✓ | |
| `view_knowledge` | ✓ | ✓ | ✓ | ✓ |
| `view_settings` | ✓ | ✓ | ✓ | |
| `view_analytics` | ✓ | ✓ | | |
| `delete_org` | ✓ | | | |

This is the matrix the property-based test `rbac.prop.test.ts` verifies (Property 14).

## API

```ts
import { hasPermission, checkPermission, ROLE_PERMISSIONS, ALL_PERMISSIONS, type Permission } from '@support-core/rbac';

hasPermission('agent', 'view_conversations');    // true
hasPermission('viewer', 'reply_conversations');  // false

checkPermission('agent', 'reply_conversations'); // ok
checkPermission('viewer', 'reply_conversations'); // throws Error("Insufficient permissions: role \"viewer\" does not have \"reply_conversations\" permission")
```

## Where permissions are enforced

RBAC is enforced at two layers:

### Application layer (explicit calls)

- `OrganizationService` (in `services/organization-service.ts`):
  - `inviteMember` rejects `role === 'owner'` (owners are created via the `create_organization_with_owner` RPC or via `changeMemberRole`).
  - `changeMemberRole` enforces the single-owner invariant: cannot demote the last owner; promoting to owner demotes the existing owner to admin.
  - `removeMember` refuses to remove the last owner.

### Database layer (RLS)

The `user_org_ids()` SQL function (in `003_rls_policies.sql`) returns the user's org IDs. Every tenant-scoped table has a RLS policy that filters to `organization_id IN (SELECT user_org_ids())`. This is the primary enforcement — a user can only read or modify rows in orgs they belong to, regardless of role.

### Known gaps

The Next.js API routes under `/api/functions/*` do **not** check RBAC permissions — they only verify the user is authenticated. Any authenticated org member can call any action, including:
- `escalate-conversation`, `resolve-conversation`, `reopen-conversation` (anyone can change any conversation's status)
- `approve-ai-draft` (anyone can approve any AI draft)
- `test-channel-connection` (anyone can probe provider accounts)

RLS prevents cross-org access, but intra-org RBAC is not enforced. This is tracked in [`../plans/refactor.md`](../plans/refactor.md).

## Adding a new permission

1. Add the new permission to the `Permission` union in `rbac.ts`.
2. Add it to `ALL_PERMISSIONS`.
3. Update `ROLE_PERMISSIONS` for each role that should have it.
4. Add a property-based test case in `__tests__/properties/rbac.prop.test.ts` to lock the matrix.
5. Update the table at the top of this file.

Enforcement should be added at the call site of any action that requires it. For Deno Functions, call `checkPermission` in the entrypoint. For Next.js API routes, the RBAC refactor will add a shared `withPermission` HOF (see [`../plans/refactor.md`](../plans/refactor.md)).

## Invariants

These are enforced in code (not just RLS) and worth knowing:

- **Single owner** — `OrganizationService.changeMemberRole` and `removeMember` both refuse operations that would leave an org without an owner. Promotions to `owner` automatically demote the current owner to `admin`.
- **No inviting owners** — `inviteMember` throws if `role === 'owner'`. Use `changeMemberRole` to transfer ownership.
- **Owner cannot delete their own membership** if it would leave the org with no owner.
