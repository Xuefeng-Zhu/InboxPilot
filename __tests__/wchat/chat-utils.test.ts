import { describe, expect, it } from 'vitest';
import {
  getWidgetRealtimeChannel,
  normalizeRealtimeMessage,
} from '../../app/wchat/[widgetId]/chat-utils';

function token(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${encoded}.signature`;
}

describe('widget chat utilities', () => {
  it('builds the realtime channel from validated JWT claims', () => {
    expect(getWidgetRealtimeChannel(token({ widget: 'widget-1', jti: 'jti-1' })))
      .toBe('widget:widget-1:jti-1');
    expect(getWidgetRealtimeChannel(token({ widget: 'widget-1' }))).toBeUndefined();
    expect(getWidgetRealtimeChannel('not-a-token')).toBeUndefined();
  });

  it('normalizes nested and direct realtime payloads', () => {
    expect(normalizeRealtimeMessage(
      { message: { id: 'message-1', body: 'Hello', sender_type: 'ai' } },
      'fallback-id',
      '2026-01-01T00:00:00.000Z',
    )).toEqual({
      id: 'message-1',
      body: 'Hello',
      sender_type: 'ai',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(normalizeRealtimeMessage(
      { body: 'Hi', senderType: 'unexpected' },
      'fallback-id',
      '2026-01-01T00:00:00.000Z',
    )).toEqual({
      id: 'fallback-id',
      body: 'Hi',
      sender_type: 'user',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(normalizeRealtimeMessage({}, 'fallback-id', 'now')).toBeNull();
  });
});
