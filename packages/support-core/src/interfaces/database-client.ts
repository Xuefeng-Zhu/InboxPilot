/**
 * Provider-neutral database client interface.
 *
 * Repositories accept this interface via constructor injection instead of
 * importing the InsForge SDK directly, keeping business logic portable.
 */

/** Minimal query builder returned by `DatabaseClient.from()`. */
export interface QueryBuilder {
  select(columns?: string): QueryBuilder;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder;
  update(values: Record<string, unknown>): QueryBuilder;
  delete(): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  neq(column: string, value: unknown): QueryBuilder;
  gt(column: string, value: unknown): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  lt(column: string, value: unknown): QueryBuilder;
  lte(column: string, value: unknown): QueryBuilder;
  like(column: string, pattern: string): QueryBuilder;
  ilike(column: string, pattern: string): QueryBuilder;
  is(column: string, value: null | boolean): QueryBuilder;
  in(column: string, values: unknown[]): QueryBuilder;
  contains(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  single(): QueryBuilder;
  maybeSingle(): QueryBuilder;
  then<T>(
    onfulfilled?: (value: QueryResult) => T | PromiseLike<T>,
    onrejected?: (reason: unknown) => T | PromiseLike<T>,
  ): Promise<T>;
}

/** Result shape returned by query builder resolution. */
export interface QueryResult {
  data: unknown;
  error: QueryError | null;
  count?: number | null;
}

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Database client interface that abstracts the InsForge SDK.
 *
 * - `from(table)` returns a chainable query builder for CRUD operations.
 * - `rpc(functionName, args)` calls a Postgres RPC function.
 */
export interface DatabaseClient {
  from(table: string): QueryBuilder;
  rpc(functionName: string, args?: Record<string, unknown>): Promise<QueryResult>;
}
