import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';
import { useOrgMembership } from './useOrganization';
import { useAuth } from '@/lib/auth-context';

/**
 * List members of the current user's first organization.
 *
 * Previously this query ran unfiltered — RLS limited the result to orgs the
 * JWT could see, but multi-org users would see members from every org they
 * belong to, which is wrong for the team page. Now we resolve the user's
 * current org_id via `useOrgMembership` and scope the query to it.
 */
export function useTeamMembers() {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: currentOrgId } = useOrgMembership(user?.id);

  return useQuery({
    queryKey: queryKeys.teamMembers(currentOrgId ?? ''),
    queryFn: async () => {
      if (!currentOrgId) return [];
      const { data, error } = await insforge.database
        .from('organization_members')
        .select()
        .eq('organization_id', currentOrgId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady && !!currentOrgId,
  });
}
