/**
 * Shared utility: creates a DatabaseClient backed by the InsForge PostgREST API.
 *
 * This bridges the InsForge REST API into the portable DatabaseClient interface
 * used by all repositories in support-core. Deno functions use this to construct
 * the database client from environment variables.
 *
 * Uses Deno.env.get() for configuration as required by InsForge serverless functions.
 */

import type {
  DatabaseClient,
  QueryBuilder,
  QueryResult,
  QueryError,
} from '../../../packages/support-core/src/interfaces/database-client.js';

interface PostgRestQueryState {
  table: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  selectColumns?: string;
  filters: Array<{ column: string; operator: string; value: unknown }>;
  orderClauses: Array<{ column: string; ascending: boolean }>;
  limitCount?: number;
  rangeFrom?: number;
  rangeTo?: number;
  body?: Record<string, unknown> | Record<string, unknown>[];
  isSingle: boolean;
  isMaybeSingle: boolean;
  returnRepresentation: boolean;
}

/**
 * A QueryBuilder implementation that accumulates query state and executes
 * against the InsForge PostgREST API when awaited (via .then()).
 */
class PostgRestQueryBuilder implements QueryBuilder {
  private state: PostgRestQueryState;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    table: string,
    baseUrl: string,
    headers: Record<string, string>,
  ) {
    this.baseUrl = baseUrl;
    this.headers = headers;
    this.state = {
      table,
      method: 'GET',
      filters: [],
      orderClauses: [],
      isSingle: false,
      isMaybeSingle: false,
      returnRepresentation: false,
    };
  }

  select(columns?: string): QueryBuilder {
    this.state.selectColumns = columns ?? '*';
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder {
    this.state.method = 'POST';
    this.state.body = values;
    this.state.returnRepresentation = true;
    return this;
  }

  update(values: Record<string, unknown>): QueryBuilder {
    this.state.method = 'PATCH';
    this.state.body = values;
    this.state.returnRepresentation = true;
    return this;
  }

  delete(): QueryBuilder {
    this.state.method = 'DELETE';
    return this;
  }

  eq(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'eq', value });
    return this;
  }

  neq(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'neq', value });
    return this;
  }

  gt(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'gt', value });
    return this;
  }

  gte(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'gte', value });
    return this;
  }

  lt(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'lt', value });
    return this;
  }

  lte(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'lte', value });
    return this;
  }

  like(column: string, pattern: string): QueryBuilder {
    this.state.filters.push({ column, operator: 'like', value: pattern });
    return this;
  }

  ilike(column: string, pattern: string): QueryBuilder {
    this.state.filters.push({ column, operator: 'ilike', value: pattern });
    return this;
  }

  is(column: string, value: null | boolean): QueryBuilder {
    this.state.filters.push({ column, operator: 'is', value });
    return this;
  }

  in(column: string, values: unknown[]): QueryBuilder {
    this.state.filters.push({ column, operator: 'in', value: values });
    return this;
  }

  contains(column: string, value: unknown): QueryBuilder {
    this.state.filters.push({ column, operator: 'cs', value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): QueryBuilder {
    this.state.orderClauses.push({
      column,
      ascending: options?.ascending ?? true,
    });
    return this;
  }

  limit(count: number): QueryBuilder {
    this.state.limitCount = count;
    return this;
  }

  range(from: number, to: number): QueryBuilder {
    this.state.rangeFrom = from;
    this.state.rangeTo = to;
    return this;
  }

  single(): QueryBuilder {
    this.state.isSingle = true;
    return this;
  }

  maybeSingle(): QueryBuilder {
    this.state.isMaybeSingle = true;
    return this;
  }

  then<T>(
    onfulfilled?: (value: QueryResult) => T | PromiseLike<T>,
    onrejected?: (reason: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    const url = new URL(`${this.baseUrl}/rest/v1/${this.state.table}`);

    // Add select columns
    if (this.state.selectColumns) {
      url.searchParams.set('select', this.state.selectColumns);
    }

    // Add filters
    for (const f of this.state.filters) {
      if (f.operator === 'in' && Array.isArray(f.value)) {
        url.searchParams.set(f.column, `in.(${(f.value as unknown[]).join(',')})`);
      } else if (f.operator === 'is') {
        url.searchParams.set(f.column, `is.${f.value}`);
      } else {
        url.searchParams.set(f.column, `${f.operator}.${f.value}`);
      }
    }

    // Add ordering
    if (this.state.orderClauses.length > 0) {
      const orderStr = this.state.orderClauses
        .map((o) => `${o.column}.${o.ascending ? 'asc' : 'desc'}`)
        .join(',');
      url.searchParams.set('order', orderStr);
    }

    // Add limit
    if (this.state.limitCount !== undefined) {
      url.searchParams.set('limit', String(this.state.limitCount));
    }

    // Build headers
    const reqHeaders: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/json',
    };

    if (this.state.isSingle || this.state.isMaybeSingle) {
      reqHeaders['Accept'] = 'application/vnd.pgrst.object+json';
    }

    if (this.state.returnRepresentation) {
      reqHeaders['Prefer'] = 'return=representation';
    }

    // Add range header
    if (this.state.rangeFrom !== undefined && this.state.rangeTo !== undefined) {
      reqHeaders['Range'] = `${this.state.rangeFrom}-${this.state.rangeTo}`;
    }

    try {
      const res = await fetch(url.toString(), {
        method: this.state.method,
        headers: reqHeaders,
        ...(this.state.body ? { body: JSON.stringify(this.state.body) } : {}),
      });

      if (!res.ok) {
        // For maybeSingle, a 406 (no rows) is not an error
        if (this.state.isMaybeSingle && res.status === 406) {
          return { data: null, error: null };
        }

        const errorBody = await res.json().catch(() => ({}));
        const error: QueryError = {
          message: (errorBody as Record<string, string>).message ?? `HTTP ${res.status}`,
          code: (errorBody as Record<string, string>).code,
          details: (errorBody as Record<string, string>).details,
          hint: (errorBody as Record<string, string>).hint,
        };
        return { data: null, error };
      }

      const data = await res.json();
      return { data, error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : 'Unknown fetch error',
        },
      };
    }
  }
}

/**
 * Create a DatabaseClient backed by the InsForge PostgREST API.
 *
 * @param baseUrl - InsForge project base URL (e.g. from INSFORGE_BASE_URL env var)
 * @param serviceRoleKey - InsForge service role key for server-side access
 */
export function createDbClient(baseUrl: string, serviceRoleKey: string): DatabaseClient {
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  return {
    from(table: string): QueryBuilder {
      return new PostgRestQueryBuilder(table, baseUrl, headers);
    },

    async rpc(
      functionName: string,
      args: Record<string, unknown> = {},
    ): Promise<QueryResult> {
      try {
        const res = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(args),
        });

        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({}));
          return {
            data: null,
            error: {
              message:
                (errorBody as Record<string, string>).message ??
                `RPC ${functionName} failed with HTTP ${res.status}`,
            },
          };
        }

        const data = await res.json();
        return { data, error: null };
      } catch (err) {
        return {
          data: null,
          error: {
            message: err instanceof Error ? err.message : 'Unknown RPC error',
          },
        };
      }
    },
  };
}
