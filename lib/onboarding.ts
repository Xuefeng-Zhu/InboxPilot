import { insforge } from '@/lib/insforge';

export function makeWorkspaceSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'workspace';
}

export async function createOrganizationWithOwner(workspaceName: string): Promise<{
  error: string | null;
}> {
  const trimmedName = workspaceName.trim();

  if (!trimmedName) {
    return { error: 'Workspace name is required.' };
  }

  const { error } = await insforge.database.rpc('create_organization_with_owner', {
    org_name: trimmedName,
    org_slug: makeWorkspaceSlug(trimmedName),
  });

  return { error: error?.message ?? null };
}
