import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeSymphonyWindow,
  getAxisTicks,
  type Zoom,
} from '../../lib/queries/hooks/useSymphony';

const zoomArb = fc.constantFrom<Zoom>('today', 'week', 'month', 'all');
const steppedZoomArb = fc.constantFrom<Zoom>('today', 'week', 'month');
const stepArb = fc.integer({ min: -24, max: 24 });

function assertStartOfDay(date: Date): void {
  expect(date.getHours()).toBe(0);
  expect(date.getMinutes()).toBe(0);
  expect(date.getSeconds()).toBe(0);
  expect(date.getMilliseconds()).toBe(0);
}

function assertEndOfDay(date: Date): void {
  expect(date.getHours()).toBe(23);
  expect(date.getMinutes()).toBe(59);
  expect(date.getSeconds()).toBe(59);
  expect(date.getMilliseconds()).toBe(999);
}

function countInclusiveCalendarDays(start: Date, end: Date): number {
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  let count = 0;
  while (cursor <= last) {
    count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

describe('Symphony window helpers', () => {
  it('always returns an ordered, finite window with the requested zoom and step', () => {
    fc.assert(
      fc.property(zoomArb, stepArb, (zoom, step) => {
        const window = computeSymphonyWindow(zoom, step);

        expect(window.zoom).toBe(zoom);
        expect(window.step).toBe(step);
        expect(Number.isFinite(window.windowStart.getTime())).toBe(true);
        expect(Number.isFinite(window.windowEnd.getTime())).toBe(true);
        expect(window.windowStart.getTime()).toBeLessThanOrEqual(window.windowEnd.getTime());
        expect(window.label.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('uses whole local-day boundaries for day, week, and month windows', () => {
    fc.assert(
      fc.property(steppedZoomArb, stepArb, (zoom, step) => {
        const window = computeSymphonyWindow(zoom, step);

        assertStartOfDay(window.windowStart);
        assertEndOfDay(window.windowEnd);

        const expectedDays = zoom === 'today' ? 1 : zoom === 'week' ? 7 : 30;
        expect(countInclusiveCalendarDays(window.windowStart, window.windowEnd)).toBe(expectedDays);
      }),
      { numRuns: 100 },
    );
  });

  it('returns sorted axis ticks inside the computed window', () => {
    fc.assert(
      fc.property(zoomArb, stepArb, (zoom, step) => {
        const window = computeSymphonyWindow(zoom, step);
        const ticks = getAxisTicks(zoom, step);
        const expectedCount = zoom === 'today' ? 4 : zoom === 'all' ? 5 : 7;

        expect(ticks).toHaveLength(expectedCount);
        for (let i = 0; i < ticks.length; i++) {
          const tickTime = ticks[i].date.getTime();
          expect(ticks[i].label.length).toBeGreaterThan(0);
          expect(tickTime).toBeGreaterThanOrEqual(window.windowStart.getTime());
          expect(tickTime).toBeLessThanOrEqual(window.windowEnd.getTime());
          if (i > 0) {
            expect(tickTime).toBeGreaterThanOrEqual(ticks[i - 1].date.getTime());
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
