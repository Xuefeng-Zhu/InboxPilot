import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { flattenMessagesChronologically, getNextPageOffset } from '../../lib/queries';

function isoDateArb() {
  return fc
    .date({ min: new Date('2026-01-01T00:00:00.000Z'), max: new Date('2026-12-31T23:59:59.999Z') })
    .map((date) => date.toISOString());
}

describe('Infinite message pagination', () => {
  it('flattens newest-first fetched pages into chronological display order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.uuid(),
            created_at: isoDateArb(),
          }),
          { minLength: 1, maxLength: 100, selector: (message) => message.id },
        ),
        fc.integer({ min: 1, max: 20 }),
        (messages, pageSize) => {
          const newestFirst = [...messages].sort(
            (first, second) => Date.parse(second.created_at) - Date.parse(first.created_at),
          );
          const pages = Array.from(
            { length: Math.ceil(newestFirst.length / pageSize) },
            (_, index) => newestFirst.slice(index * pageSize, index * pageSize + pageSize),
          );

          const flattened = flattenMessagesChronologically(pages);
          const timestamps = flattened.map((message) => Date.parse(message.created_at));

          expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
          expect(flattened.map((message) => message.id).sort()).toEqual(messages.map((message) => message.id).sort());
        },
      ),
    );
  });

  it('stops pagination when the returned page is shorter than the page size', () => {
    expect(getNextPageOffset([1, 2], [[1, 2, 3]], 3)).toBeUndefined();
    expect(getNextPageOffset([1, 2, 3], [[1, 2, 3]], 3)).toBe(3);
  });
});
