import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export function useContacts(filters?: { search?: string; channel?: string }) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.contacts(filters),
    queryFn: async () => {
      let query = insforge.database
        .from('contacts')
        .select('id,name,email,phone,created_at,updated_at')
        .order('created_at', { ascending: false });

      if (filters?.search?.trim()) {
        query = query.ilike('name', `%${filters.search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data : [];
    },
    enabled: authReady,
  });
}

export function useContact(contactId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.contact(contactId ?? ''),
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('contacts')
        .select('id,name,email,phone')
        .eq('id', contactId!)
        .limit(1);

      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return (rows[0] as { id: string; name: string | null; email: string | null; phone: string | null }) ?? null;
    },
    enabled: authReady && !!contactId,
  });
}
