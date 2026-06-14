import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/insforge';
import { useCurrentMembership } from './useOrganization';

export interface TeamMemberInfo {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Fetch public profile info (email, name, avatar_url) for every member of the
 * current user's organization, so the team panel can display meaningful
 * identifiers instead of raw InsForge auth user IDs.
 *
 * Resolves org_id via `useCurrentMembership` (same pattern as `useTeamMembers`),
 * and calls a server-side API route that batches the per-user profile lookups
 * using the InsForge admin client (avoids N+1 round trips from the browser).
 */
export function useTeamMemberInfo() {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: membership } = useCurrentMembership(user?.id);
  const orgId = membership?.organizationId;

  return useQuery({
    queryKey: queryKeys.teamMemberInfo(orgId ?? ''),
    queryFn: async (): Promise<TeamMemberInfo[]> => {
      if (!orgId) return [];
      const token = getAccessToken();

      const res = await fetch('/api/functions/team-member-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organizationId: orgId }),
      });

      if (!res.ok) {
        // Don't throw — let the UI fall back to user_id display.
        return [];
      }

      const json = (await res.json()) as { data?: TeamMemberInfo[] };
      return Array.isArray(json.data) ? json.data : [];
    },
    enabled: authReady && !!orgId,
    // The team rarely changes; refetch on focus is enough.
    staleTime: 60_000,
    // Suppress the error to keep the team panel rendering with user_id fallbacks
    // (the `useQuery` error would propagate up and break the whole panel).
    throwOnError: false,
  });
}
