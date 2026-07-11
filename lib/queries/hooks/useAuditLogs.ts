import { useQuery } from '@tanstack/react-query';
import { insforge } from '../../insforge';
import { queryKeys } from '../keys';
import { useAuthReady } from '../helpers';
import { useAuth } from '@/lib/auth-context';
import { useOrgMembership } from './useOrganization';

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
  /**
   * Filter to a single resource type (e.g. `'conversation'`, `'ai_decision'`).
   * Backed by PostgREST `.eq('resource_type', value)`.
   */
  resourceType?: string;
  /**
   * Filter by resource id. A string matches a single id (`.eq`); an array
   * matches any id in the set (`.in`).
   */
  resourceId?: string | string[];
  /**
   * JSONB containment filter on the `metadata` column. Maps to PostgREST
   * `.contains('metadata', value)` which uses the `@>` operator. Example:
   * `{ conversationId: 'abc' }` becomes `metadata @> '{"conversationId":"abc"}'`.
   */
  metadataContains?: Record<string, string>;
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

export function useAuditLogs(
  filters?: AuditLogFilters,
  options?: { enabled?: boolean },
) {
  const authReady = useAuthReady();
  const { user } = useAuth();
  const { data: orgId } = useOrgMembership(user?.id);
  return useQuery({
    queryKey: queryKeys.auditLogs(
      orgId ?? '',
      filters as Record<string, unknown> | undefined,
    ),
    queryFn: async (): Promise<AuditLogRow[]> => {
      let query = insforge.database
        .from('audit_logs')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filters?.actorType) {
        query = query.eq('actor_type', filters.actorType);
      }

      if (filters?.resourceType) {
        query = query.eq('resource_type', filters.resourceType);
      }

      if (filters?.resourceId) {
        query = Array.isArray(filters.resourceId)
          ? query.in('resource_id', filters.resourceId)
          : query.eq('resource_id', filters.resourceId);
      }

      if (filters?.metadataContains) {
        query = query.contains('metadata', filters.metadataContains);
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
    enabled: authReady && !!orgId && (options?.enabled ?? true),
  });
}
