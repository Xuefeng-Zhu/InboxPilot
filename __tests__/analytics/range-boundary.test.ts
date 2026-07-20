import { describe, expect, it } from 'vitest';
import { rangeToInterval } from '@/app/analytics/page';

describe('Analytics range boundaries', () => {
  const now = new Date(2026, 2, 8, 12, 0, 0);

  it('uses exactly seven local calendar dates across a DST boundary', () => {
    const interval = rangeToInterval('7d', now);

    expect([
      interval.startInclusive.getFullYear(),
      interval.startInclusive.getMonth(),
      interval.startInclusive.getDate(),
      interval.startInclusive.getHours(),
    ]).toEqual([2026, 2, 2, 0]);
    expect([
      interval.endExclusive.getFullYear(),
      interval.endExclusive.getMonth(),
      interval.endExclusive.getDate(),
      interval.endExclusive.getHours(),
    ]).toEqual([2026, 2, 9, 0]);
  });

  it('uses exactly thirty local calendar dates with an exclusive next-day bound', () => {
    const interval = rangeToInterval('30d', now);

    expect([
      interval.startInclusive.getFullYear(),
      interval.startInclusive.getMonth(),
      interval.startInclusive.getDate(),
      interval.startInclusive.getHours(),
    ]).toEqual([2026, 1, 7, 0]);
    expect([
      interval.endExclusive.getFullYear(),
      interval.endExclusive.getMonth(),
      interval.endExclusive.getDate(),
      interval.endExclusive.getHours(),
    ]).toEqual([2026, 2, 9, 0]);
  });
});
