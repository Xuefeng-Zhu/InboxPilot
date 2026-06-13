import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export function useTeamMembers() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.teamMembers(),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('organization_members')
        .select()
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady,
  });
}
