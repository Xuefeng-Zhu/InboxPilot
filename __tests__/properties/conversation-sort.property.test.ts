import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  attachLatestMessages,
  attachLatestMessagesAndSortConversations,
  getNextPageOffset,
} from '../../lib/queries';

function parseTime(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

describe('Conversation list activity ordering', () => {
  it('orders rows by latest message timestamp when last_message_at is missing', () => {
    const rows = attachLatestMessagesAndSortConversations(
      [
        {
          id: 'old-conversation',
          last_message_at: '2026-06-09T12:00:00.000Z',
          created_at: '2026-06-09T12:00:00.000Z',
        },
        {
          id: 'fresh-webchat',
          last_message_at: null,
          created_at: '2026-06-09T12:00:00.000Z',
        },
      ],
      [
        {
          conversation_id: 'fresh-webchat',
          body: 'new visitor follow-up',
          created_at: '2026-06-13T06:20:00.000Z',
        },
      ],
    );

    expect(rows.map((row) => row.id)).toEqual(['fresh-webchat', 'old-conversation']);
  });

  it('keeps conversations sorted by their effective latest activity timestamp', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.uuid(),
            last_message_at: fc.option(
              fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }).map((date) =>
                date.toISOString(),
              ),
              { nil: null },
            ),
            created_at: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }).map((date) =>
              date.toISOString(),
            ),
          }),
          { minLength: 1, maxLength: 20, selector: (conversation) => conversation.id },
        ),
        (conversations) => {
          const messages = conversations.map((conversation) => ({
            conversation_id: conversation.id,
            body: 'preview',
            created_at: new Date(
              Math.max(
                parseTime(conversation.created_at),
                parseTime(conversation.last_message_at),
              ) + 1,
            ).toISOString(),
          }));

          const rows = attachLatestMessagesAndSortConversations(conversations, messages);
          const activityTimes = rows.map((row) => {
            const latestMessage = row.latest_message as { created_at?: unknown } | null;
            return Math.max(
              parseTime(row.last_message_at),
              parseTime(latestMessage?.created_at),
              parseTime(row.created_at),
            );
          });

          expect(activityTimes).toEqual([...activityTimes].sort((a, b) => b - a));
        },
      ),
    );
  });
});

describe('attachLatestMessages (no re-sort)', () => {
  it('preserves input order so per-page server order is not disturbed', () => {
    const order = ['a', 'b', 'c', 'd'];
    const rows = attachLatestMessages(
      order.map((id) => ({
        id,
        last_message_at: '2026-06-09T12:00:00.000Z',
        created_at: '2026-06-09T12:00:00.000Z',
      })),
      [
        { conversation_id: 'c', body: 'preview', created_at: '2026-06-13T06:20:00.000Z' },
        { conversation_id: 'a', body: 'preview', created_at: '2026-06-13T07:00:00.000Z' },
      ],
    );

    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Infinite conversation pagination', () => {
  it('continues only while a page is full', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 99 }),
        (pageSize, returnedCount) => {
          const priorPages = Array.from({ length: 3 }, () => Array.from({ length: pageSize }, (_, index) => index));
          const lastPage = Array.from({ length: returnedCount }, (_, index) => index);

          const nextOffset = getNextPageOffset(lastPage, priorPages, pageSize);

          expect(nextOffset).toBe(returnedCount < pageSize ? undefined : priorPages.length * pageSize);
        },
      ),
    );
  });
});
