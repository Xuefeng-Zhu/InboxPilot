/**
 * Lightweight InsForge client utility.
 *
 * Wraps the InsForge REST API (PostgREST, Auth, Realtime) using fetch
 * so the app does not depend on an external SDK package.
 *
 * Environment variables:
 *   NEXT_PUBLIC_INSFORGE_URL  – InsForge project base URL
 *   NEXT_PUBLIC_INSFORGE_ANON_KEY – InsForge anonymous/public API key
 *   INSFORGE_SERVICE_ROLE_KEY – Server-side service role key (never exposed to browser)
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const INSFORGE_URL =
  process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
const INSFORGE_ANON_KEY =
  process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsForgeAuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: InsForgeUser;
}

export interface InsForgeUser {
  id: string;
  email: string;
  email_confirmed_at?: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface InsForgeError {
  message: string;
  status?: number;
}

export interface QueryOptions {
  select?: string;
  filter?: Record<string, string>;
  order?: string;
  limit?: number;
  offset?: number;
  single?: boolean;
}

// ---------------------------------------------------------------------------
// InsForge Client
// ---------------------------------------------------------------------------

export class InsForgeClient {
  private baseUrl: string;
  private apiKey: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  // ---- Helpers -----------------------------------------------------------

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.apiKey,
      ...extra,
    };
    if (this.accessToken) {
      h['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return h;
  }

  /** Set the JWT access token for authenticated requests. */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /** Return the current access token (if any). */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  // ---- Auth --------------------------------------------------------------

  async signUp(
    email: string,
    password: string,
  ): Promise<{ data: InsForgeAuthSession | null; error: InsForgeError | null }> {
    const res = await fetch(`${this.baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email, password }),
    });
    return this.handleAuthResponse(res);
  }

  async signIn(
    email: string,
    password: string,
  ): Promise<{ data: InsForgeAuthSession | null; error: InsForgeError | null }> {
    const res = await fetch(
      `${this.baseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ email, password }),
      },
    );
    return this.handleAuthResponse(res);
  }

  async signOut(): Promise<{ error: InsForgeError | null }> {
    const res = await fetch(`${this.baseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: { message: body.msg ?? 'Sign-out failed', status: res.status } };
    }
    this.accessToken = null;
    return { error: null };
  }

  async getUser(): Promise<{ data: InsForgeUser | null; error: InsForgeError | null }> {
    if (!this.accessToken) {
      return { data: null, error: { message: 'No access token set' } };
    }
    const res = await fetch(`${this.baseUrl}/auth/v1/user`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: { message: body.msg ?? 'Failed to get user', status: res.status } };
    }
    const user = (await res.json()) as InsForgeUser;
    return { data: user, error: null };
  }

  // ---- PostgREST (database) ----------------------------------------------

  /**
   * Query a table via the PostgREST auto-generated API.
   *
   * Example:
   *   client.from('conversations', { select: '*', filter: { status: 'eq.open' }, order: 'last_message_at.desc', limit: 50 })
   */
  async from<T = unknown>(
    table: string,
    options: QueryOptions = {},
  ): Promise<{ data: T[] | T | null; error: InsForgeError | null }> {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);

    if (options.select) url.searchParams.set('select', options.select);
    if (options.order) url.searchParams.set('order', options.order);
    if (options.limit != null) url.searchParams.set('limit', String(options.limit));
    if (options.offset != null) url.searchParams.set('offset', String(options.offset));
    if (options.filter) {
      for (const [col, value] of Object.entries(options.filter)) {
        url.searchParams.set(col, value);
      }
    }

    const extraHeaders: Record<string, string> = {};
    if (options.single) {
      extraHeaders['Accept'] = 'application/vnd.pgrst.object+json';
    }

    const res = await fetch(url.toString(), { headers: this.headers(extraHeaders) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: { message: body.message ?? 'Query failed', status: res.status } };
    }
    const data = await res.json();
    return { data, error: null };
  }

  /** Insert one or more rows into a table. */
  async insert<T = unknown>(
    table: string,
    rows: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<{ data: T | null; error: InsForgeError | null }> {
    const res = await fetch(`${this.baseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: { message: body.message ?? 'Insert failed', status: res.status } };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  }

  /** Update rows matching the given filters. */
  async update<T = unknown>(
    table: string,
    values: Record<string, unknown>,
    filter: Record<string, string>,
  ): Promise<{ data: T | null; error: InsForgeError | null }> {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);
    for (const [col, value] of Object.entries(filter)) {
      url.searchParams.set(col, value);
    }
    const res = await fetch(url.toString(), {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: { message: body.message ?? 'Update failed', status: res.status } };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  }

  /** Delete rows matching the given filters. */
  async delete(
    table: string,
    filter: Record<string, string>,
  ): Promise<{ error: InsForgeError | null }> {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);
    for (const [col, value] of Object.entries(filter)) {
      url.searchParams.set(col, value);
    }
    const res = await fetch(url.toString(), {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: { message: body.message ?? 'Delete failed', status: res.status } };
    }
    return { error: null };
  }

  /** Call a Postgres RPC function. */
  async rpc<T = unknown>(
    functionName: string,
    args: Record<string, unknown> = {},
  ): Promise<{ data: T | null; error: InsForgeError | null }> {
    const res = await fetch(`${this.baseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: { message: body.message ?? 'RPC failed', status: res.status } };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  }

  // ---- Realtime (Socket.IO) ---------------------------------------------

  /**
   * Returns the realtime WebSocket URL for subscribing to channels.
   * Actual subscription logic is handled by the frontend realtime hook.
   */
  getRealtimeUrl(): string {
    return `${this.baseUrl}/realtime/v1`;
  }

  // ---- Auth response helper ----------------------------------------------

  private async handleAuthResponse(
    res: Response,
  ): Promise<{ data: InsForgeAuthSession | null; error: InsForgeError | null }> {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        data: null,
        error: { message: body.msg ?? body.error_description ?? 'Auth request failed', status: res.status },
      };
    }
    const session = (await res.json()) as InsForgeAuthSession;
    if (session.access_token) {
      this.accessToken = session.access_token;
    }
    return { data: session, error: null };
  }
}

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------

/**
 * Browser / client-side InsForge client.
 * Uses the public anon key — safe to expose in the browser.
 */
export const insforge = new InsForgeClient(INSFORGE_URL, INSFORGE_ANON_KEY);

/**
 * Server-side InsForge client with the service role key.
 * Only import this in server components, API routes, or server actions.
 */
export function createServiceClient(): InsForgeClient {
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY ?? '';
  return new InsForgeClient(INSFORGE_URL, serviceKey);
}
