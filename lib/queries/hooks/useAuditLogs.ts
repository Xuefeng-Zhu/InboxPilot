import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';

export type AuditLogRow = {
  id: string;
  organization_id: string;
  actor_id: string | null;
  actor_type: 'user' | 'system' | 'ai';
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditLogFilters = {
  actorType?: 'user' | 'system' | 'ai';
  search?: string;
};

/**
 * Escape user input for PostgREST's `ilike` operator.
 *
 * PostgREST `ilike` uses LIKE semantics where `%` and `_` are wildcards and `\`
 * is the escape character. A user typing `50%` would otherwise be interpreted
 * as a trailing wildcard; escaping ensures the literal string is matched.
 */
function escapeIlike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function useAuditLogs(filters?: AuditLogFilters) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.auditLogs(filters as Record<string, unknown> | undefined),
    queryFn: async (): Promise<AuditLogRow[]> => {
      let query = insforge.database
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filters?.actorType) {
        query = query.eq('actor_type', filters.actorType);
      }

      const search = filters?.search?.trim();
      if (search) {
        const escaped = escapeIlike(search);
        query = query.or(
          `action.ilike.%${escaped}%,resource_type.ilike.%${escaped}%`,
        );
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? (data as AuditLogRow[]) : [];
    },
    enabled: authReady,
  });
}
