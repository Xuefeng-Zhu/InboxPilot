import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';
import { useAuth } from '@/lib/auth-context';
import { useOrgMembership } from './useOrganization';

export function useContacts(filters?: { search?: string; channel?: string }) {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  return useQuery({
    queryKey: queryKeys.contacts(orgId ?? '', filters),
    queryFn: async () => {
      let query = insforge.database
        .from('contacts')
        .select('id,name,email,phone,created_at,updated_at')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false });

      if (filters?.search?.trim()) {
        query = query.ilike('name', `%${filters.search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady && !!orgId,
  });
}

export function useCustomerSelectorOptions(search: string, enabled: boolean) {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  const normalizedSearch = search.trim();

  return useQuery({
    queryKey: queryKeys.customerSelectorOptions(orgId ?? '', normalizedSearch),
    queryFn: async () => {
      let query = insforge.database
        .from('contacts')
        .select('id,name,email,phone')
        .eq('organization_id', orgId!)
        .limit(20);

      if (normalizedSearch) {
        query = query.ilike('name', `%${normalizedSearch}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return Array.isArray(data)
        ? data as Array<{
          id: string;
          name: string | null;
          email: string | null;
          phone: string | null;
        }>
        : [];
    },
    enabled: authReady && !!orgId && enabled,
  });
}

export function useContact(contactId: string | null) {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  return useQuery({
    queryKey: queryKeys.contact(orgId ?? '', contactId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('contacts')
        .select('id,name,email,phone')
        .eq('id', contactId!)
        .eq('organization_id', orgId!)
        .limit(1);

      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return (rows[0] as { id: string; name: string | null; email: string | null; phone: string | null }) ?? null;
    },
    enabled: authReady && !!orgId && !!contactId,
  });
}
