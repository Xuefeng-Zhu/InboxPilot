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
- Next.js API routes under `/api/functions/*`:
  - `send-reply`, `approve-ai-draft`, and `regenerate-ai-draft` verify `reply_conversations` for the target conversation's organization.
  - `escalate-conversation`, `resolve-conversation`, and `reopen-conversation` verify `reply_conversations` before changing conversation status.
  - `test-channel-connection` verifies `manage_settings` for the provider account's organization.

### Database layer (RLS)

Migration `014_role_aware_rls_and_knowledge_storage.sql` aligns organization, settings, provider, widget, knowledge, queue, audit, and private-file policies with this matrix. Owners/admins may mutate settings and knowledge; agents can read settings; all roles can read knowledge; organization deletion is owner-only. Direct organization creation is denied in favor of the onboarding RPC, and membership writes are limited to trusted team APIs so users cannot self-promote. Browser clients may only enqueue `process_knowledge_document` jobs as owner/admin and cannot update/delete jobs. Owner/admin/agent audit inserts must identify the authenticated user; viewers remain read-only.

The role helpers are `SECURITY DEFINER` functions with pinned search paths so membership lookup does not recurse through `organization_members` RLS. Trusted webhook and worker operations use the service/project-admin role at server-side boundaries.

### Secret and storage boundaries

Authenticated client SELECT grants exclude provider `credentials_secret_id` fields and `webchat_widgets.hmac_secret`. Knowledge-file keys are organization-prefixed; all organization roles can read private files, while only owners/admins can upload, replace, or delete them. Restrictive storage policies keep those role checks effective even if another permissive object policy exists. The `knowledge-files` bucket must also be configured as private in the InsForge dashboard after applying migration `014`.

## Adding a new permission

1. Add the new permission to the `Permission` union in `rbac.ts`.
2. Add it to `ALL_PERMISSIONS`.
3. Update `ROLE_PERMISSIONS` for each role that should have it.
4. Add a property-based test case in `__tests__/properties/rbac.prop.test.ts` to lock the matrix.
5. Update the table at the top of this file.

Enforcement should be added at the call site of any action that requires it. For Deno Functions, call `checkPermission` in the entrypoint. For Next.js API routes, verify the InsForge session and call `userHasOrgPermission` in `app/api/functions/_auth.ts`.

## Invariants

These are enforced in code (not just RLS) and worth knowing:

- **Single owner** — `OrganizationService.changeMemberRole` and `removeMember` both refuse operations that would leave an org without an owner. Promotions to `owner` automatically demote the current owner to `admin`.
- **No inviting owners** — `inviteMember` throws if `role === 'owner'`. Use `changeMemberRole` to transfer ownership.
- **Owner cannot delete their own membership** if it would leave the org with no owner.
