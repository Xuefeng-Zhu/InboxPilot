import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export interface Organization {
  id: string;
  name: string;
  slug: string;
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

export function useOrganization(orgId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.organization(orgId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('organizations')
        .select('id,name,slug')
        .eq('id', orgId!)
        .single();

      if (error) throw new Error(error.message);
      return data as Organization | null;
    },
    enabled: authReady && !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
