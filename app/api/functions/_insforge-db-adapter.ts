/**
 * Adapter: InsForge Node SDK → support-core DatabaseClient.
 *
 * The InsForge Node SDK (used by Next.js API routes via `insforgeAdmin`) wraps
 * `@supabase/postgrest-js` and exposes a chainable query builder at
 * `insforgeAdmin.database.from(table)`. The `QueryBuilder` interface in
 * support-core mirrors that surface (select/insert/update/delete/eq/.../
 * single/maybeSingle) and is `await`able with a `{ data, error, count? }`
 * payload. The Postgrest builder is a strict superset of that contract, so
 * we simply expose it through the interface.
 *
 * The only intentional omission: `rpc()`. The InsForge Node SDK does not
 * expose PostgREST RPCs in a shape that matches the support-core interface
 * and none of the team management endpoints need it. If a future route does,
 * wire it here.
 */
import type {
  DatabaseClient,
  QueryBuilder,
  QueryResult,
} from '@support-core/interfaces/database-client';
import { insforgeAdmin } from '@/lib/insforge-admin';

export function createInsforgeDbAdapter(): DatabaseClient {
  return {
    from(table: string): QueryBuilder {
      // The InsForge Node SDK's PostgrestQueryBuilder is structurally
      // compatible with support-core's QueryBuilder interface (same method
      // names, same shapes, `await`-resolves to a `{ data, error }` payload
      // that is a strict superset of `QueryResult`). Cast at the boundary.
      return (insforgeAdmin.database.from(table) as unknown) as QueryBuilder;
    },
    rpc(_name: string, _args: Record<string, unknown> = {}): Promise<QueryResult> {
      // The InsForge Node SDK does not expose PostgREST RPCs in a shape that
      // matches the support-core interface and none of the team management
      // endpoints need it. Wire this up here if a future route calls into it.
      return Promise.reject(
        new Error('rpc() is not implemented for the InsForge Node SDK adapter'),
      );
    },
  };
}
