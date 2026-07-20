import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { chronologicalFromNewest } from '../../src/repositories/message-repository.js';

describe('limited message history properties', () => {
  it('restores the newest database tail to chronological order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (chronologicalIds, requestedLimit) => {
          const limit = Math.min(requestedLimit, chronologicalIds.length);
          const expectedTail = chronologicalIds.slice(-limit);
          const newestFirstRows = [...expectedTail].reverse();

          expect(chronologicalFromNewest(newestFirstRows)).toEqual(expectedTail);
        },
      ),
      { numRuns: 100 },
    );
  });
});
