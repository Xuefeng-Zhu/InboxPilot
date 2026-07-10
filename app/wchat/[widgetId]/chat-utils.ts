export interface ChatMessage {
  id: string;
  body: string;
  sender_type: 'contact' | 'user' | 'ai' | 'system';
  created_at: string;
}

const SENDER_TYPES = new Set<ChatMessage['sender_type']>([
  'contact',
  'user',
  'ai',
  'system',
]);

export function getWidgetRealtimeChannel(visitorToken: string): string | undefined {
  try {
    const parts = visitorToken.split('.');
    if (parts.length !== 3) return undefined;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(padded)) as { widget?: unknown; jti?: unknown };
    if (typeof payload.widget !== 'string' || !payload.widget) return undefined;
    if (typeof payload.jti !== 'string' || !payload.jti) return undefined;
    return `widget:${payload.widget}:${payload.jti}`;
  } catch {
    return undefined;
  }
}

export function normalizeRealtimeMessage(
  payload: Record<string, unknown>,
  fallbackId: string,
  fallbackCreatedAt: string,
): ChatMessage | null {
  const candidate =
    payload.message && typeof payload.message === 'object'
      ? (payload.message as Record<string, unknown>)
      : payload;
  if (typeof candidate.body !== 'string' || !candidate.body) return null;

  const rawSenderType = candidate.sender_type ?? candidate.senderType;
  const senderType =
    typeof rawSenderType === 'string' &&
    SENDER_TYPES.has(rawSenderType as ChatMessage['sender_type'])
      ? rawSenderType as ChatMessage['sender_type']
      : 'user';

  return {
    id: typeof candidate.id === 'string' ? candidate.id : fallbackId,
    body: candidate.body,
    sender_type: senderType,
    created_at:
      typeof candidate.created_at === 'string'
        ? candidate.created_at
        : fallbackCreatedAt,
  };
}
