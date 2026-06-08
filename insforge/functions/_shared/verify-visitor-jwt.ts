/**
 * Shared utility: verifies webchat visitor JWTs.
 *
 * Visitor JWTs are signed per-widget using HS256 with the widget's hmac_secret.
 * This is separate from the user auth JWT (verify-jwt.ts) because:
 * - Visitor JWTs use per-widget secrets (not a single InsForge auth secret)
 * - The `sub` claim is a contactId, not a userId
 *
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Decode JWT header/payload (no library needed for HS256)
 * 3. Look up widget by widgetId claim to get hmac_secret
 * 4. Verify HMAC-SHA256 signature
 * 5. Check expiry
 * 6. Look up thread and verify jti matches (rotation enforcement)
 * 7. Return claims + widget + thread
 */

import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';
import type { WebchatWidget, WebchatThread } from '../../../packages/support-core/src/types/index.ts';

export interface VisitorClaims {
  contactId: string;
  organizationId: string;
  widgetId: string;
  threadId: string;
  jti: string;
}

export interface VerifiedVisitor {
  claims: VisitorClaims;
  widget: WebchatWidget;
  thread: WebchatThread;
}

/**
 * Sign a visitor JWT using HS256.
 */
export async function signVisitorJwt(
  claims: VisitorClaims,
  secret: string,
  expiresInSeconds = 86400, // 24h
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: claims.contactId,
    org: claims.organizationId,
    widget: claims.widgetId,
    thread: claims.threadId,
    jti: claims.jti,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify a visitor JWT from the Authorization header.
 * Returns null if the token is invalid, expired, or the jti doesn't match.
 */
export async function verifyVisitorJwt(
  req: Request,
  db: DatabaseClient,
): Promise<VerifiedVisitor | null> {
  // 1. Extract Bearer token
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  const token = parts[1];
  if (!token) return null;

  // 2. Decode JWT parts
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(segments[1]));
  } catch {
    return null;
  }

  const widgetId = payload.widget as string;
  const threadId = payload.thread as string;
  const jti = payload.jti as string;
  const sub = payload.sub as string;
  const org = payload.org as string;
  const exp = payload.exp as number;

  if (!widgetId || !threadId || !jti || !sub || !org) return null;

  // 3. Check expiry
  if (exp && exp < Math.floor(Date.now() / 1000)) return null;

  // 4. Look up widget to get hmac_secret
  const { data: widgetData, error: widgetError } = await db
    .from('webchat_widgets')
    .select('*')
    .eq('id', widgetId)
    .maybeSingle();

  if (widgetError || !widgetData) return null;

  const widgetRow = widgetData as Record<string, unknown>;
  const hmacSecret = widgetRow.hmac_secret as string;

  // 5. Verify HMAC-SHA256 signature
  const signingInput = `${segments[0]}.${segments[1]}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hmacSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signatureBytes = base64UrlDecodeBytes(segments[2]);
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput),
  );

  if (!isValid) return null;

  // 6. Look up thread and verify jti
  const { data: threadData, error: threadError } = await db
    .from('webchat_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();

  if (threadError || !threadData) return null;

  const threadRow = threadData as Record<string, unknown>;
  if (threadRow.visitor_token_jti !== jti) return null;

  // 7. Build result
  const widget: WebchatWidget = {
    id: widgetRow.id as string,
    organizationId: widgetRow.organization_id as string,
    name: widgetRow.name as string,
    widgetToken: widgetRow.widget_token as string,
    hmacSecret: widgetRow.hmac_secret as string,
    allowedDomains: (widgetRow.allowed_domains as string[]) ?? [],
    position: widgetRow.position as 'bottom-right' | 'bottom-left',
    primaryColor: (widgetRow.primary_color as string) ?? null,
    greeting: (widgetRow.greeting as string) ?? null,
    preChatEnabled: (widgetRow.pre_chat_enabled as boolean) ?? false,
    aiModeOverride: (widgetRow.ai_mode_override as WebchatWidget['aiModeOverride']) ?? null,
    isActive: (widgetRow.is_active as boolean) ?? true,
    createdAt: new Date(widgetRow.created_at as string),
    updatedAt: new Date(widgetRow.updated_at as string),
  };

  const thread: WebchatThread = {
    id: threadRow.id as string,
    organizationId: threadRow.organization_id as string,
    widgetId: threadRow.widget_id as string,
    conversationId: threadRow.conversation_id as string,
    contactId: threadRow.contact_id as string,
    visitorTokenJti: threadRow.visitor_token_jti as string,
    firstSeenAt: new Date(threadRow.first_seen_at as string),
    lastSeenAt: new Date(threadRow.last_seen_at as string),
    identifiedAt: threadRow.identified_at ? new Date(threadRow.identified_at as string) : null,
    pageUrl: (threadRow.page_url as string) ?? null,
    referrer: (threadRow.referrer as string) ?? null,
    userAgent: (threadRow.user_agent as string) ?? null,
    ipCountry: (threadRow.ip_country as string) ?? null,
    ipCity: (threadRow.ip_city as string) ?? null,
    metadata: (threadRow.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(threadRow.created_at as string),
    updatedAt: new Date(threadRow.updated_at as string),
  };

  const claims: VisitorClaims = {
    contactId: sub,
    organizationId: org,
    widgetId,
    threadId,
    jti,
  };

  return { claims, widget, thread };
}

// ─── Base64URL Helpers ──────────────────────────────────────────────

function base64UrlEncode(input: string | ArrayBuffer): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function base64UrlDecodeBytes(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
