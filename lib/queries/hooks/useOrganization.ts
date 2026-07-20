import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  sla_thresholds: { greenMs: number; amberMs: number };
}

export interface CurrentMembership {
  id: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'agent' | 'viewer';
}

export function useOrgMembership(userId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.orgMembership(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId!)
        .limit(1);

      if (error) throw new Error(error.message);
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      if (arr.length === 0) return null;
      return (arr[0] as { organization_id: string }).organization_id;
    },
    enabled: authReady && !!userId,
  });
}

/**
 * Resolve the current user's full membership record (org id + role) in their
 * first organization. Useful when a component needs to gate UI or
 * permissions based on the caller's own role.
 */
export function useCurrentMembership(userId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: [...queryKeys.orgMembership(userId ?? ''), 'full'] as const,
    queryFn: async (): Promise<CurrentMembership | null> => {
      const { data, error } = await insforge.database
        .from('organization_members')
        .select('id,organization_id,role')
        .eq('user_id', userId!)
        .limit(1);

      if (error) throw new Error(error.message);
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      if (arr.length === 0) return null;
      const row = arr[0] as {
        id: string;
        organization_id: string;
        role: CurrentMembership['role'];
      };
      return {
        id: row.id,
        organizationId: row.organization_id,
        role: row.role,
      };
    },
    enabled: authReady && !!userId,
  });
}

export function useOrganization(orgId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.organization(orgId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('organizations')
        .select('id,name,slug,sla_thresholds')
        .eq('id', orgId!)
        .single();

      if (error) throw new Error(error.message);
      return data as Organization | null;
    },
    enabled: authReady && !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
