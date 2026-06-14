import { describe, expect, it } from 'vitest';
import { slaTier, type SlaThresholds } from '../../../app/inbox/kanban/_lib/sla';

const THRESHOLDS: SlaThresholds = {
  greenMs: 300_000, // 5 min
  amberMs: 3_600_000, // 60 min
};

describe('slaTier', () => {
  it('returns "new" when lastMessageAt is null', () => {
    const result = slaTier(null, new Date('2026-06-14T12:00:00.000Z'), THRESHOLDS);
    expect(result).toBe('new');
  });

  it('returns "green" when delta is 60_000 ms (1 min)', () => {
    const lastMessageAt = '2026-06-14T11:59:00.000Z';
    const now = new Date('2026-06-14T12:00:00.000Z');
    const result = slaTier(lastMessageAt, now, THRESHOLDS);
    expect(result).toBe('green');
  });

  it('returns "amber" when delta is 600_000 ms (10 min)', () => {
    const lastMessageAt = '2026-06-14T11:50:00.000Z';
    const now = new Date('2026-06-14T12:00:00.000Z');
    const result = slaTier(lastMessageAt, now, THRESHOLDS);
    expect(result).toBe('amber');
  });

  it('returns "red" when delta is 7_200_000 ms (2 h)', () => {
    const lastMessageAt = '2026-06-14T10:00:00.000Z';
    const now = new Date('2026-06-14T12:00:00.000Z');
    const result = slaTier(lastMessageAt, now, THRESHOLDS);
    expect(result).toBe('red');
  });

  it('returns "green" when delta is exactly greenMs (inclusive lower bound)', () => {
    // 5 min exactly: delta === greenMs → 'green'
    const lastMessageAt = '2026-06-14T11:55:00.000Z';
    const now = new Date('2026-06-14T12:00:00.000Z');
    const result = slaTier(lastMessageAt, now, THRESHOLDS);
    expect(result).toBe('green');
  });

  it('returns "amber" when delta is exactly amberMs (inclusive lower bound)', () => {
    // 60 min exactly: delta === amberMs → 'amber'
    const lastMessageAt = '2026-06-14T11:00:00.000Z';
    const now = new Date('2026-06-14T12:00:00.000Z');
    const result = slaTier(lastMessageAt, now, THRESHOLDS);
    expect(result).toBe('amber');
  });
});
