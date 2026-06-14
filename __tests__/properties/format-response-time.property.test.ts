/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatResponseTime } from '../../lib/utils/format-response-time';

/**
 * Property tests for `formatResponseTime` covering every branch of the
 * helper: null `lastMessageAt`, negative diff, sub-second diff, sub-minute
 * diff, sub-hour diff, and multi-hour diff. Also verifies the structural
 * invariant (output is `—` or matches `<number><unit>`) and that the
 * formatted value is monotonically non-decreasing in `(unit, value)` as
 * the underlying diff grows.
 *
 * Reference: the function body was re-added verbatim from
 * `cb6730a:components/inbox/MessageThread.tsx`; see plan
 * `.omo/plans/restore-ai-insight-tab.md` task 1.
 */

const UNIT_RANK = { ms: 0, s: 1, m: 2, h: 3 } as const;
type Unit = keyof typeof UNIT_RANK;

const ISO_DATE_ARB: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2030-12-31T00:00:00.000Z'),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString());

function parseFormattedDuration(value: string): { value: number; unit: Unit } | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2] as Unit };
}

// Run every property 100 times per `__tests__/AGENTS.md` convention. The
// run count is logged explicitly via `assertWithLog` so the evidence
// report shows the number of iterations that were actually exercised.
const PROP_PARAMS = { numRuns: 100 } as const;

function assertWithLog(
  label: string,
  property: fc.IProperty<unknown>,
  params: fc.Parameters<unknown> = PROP_PARAMS,
): void {
  // `fc.assert` in fast-check v3.23 returns void; use `fc.check` (which
  // returns RunDetails) and manually assert that the property held. This
  // also surfaces the run count in the test report.
  const details = fc.check(property, params);
  expect(details.failed).toBe(false);
  // eslint-disable-next-line no-console
  console.log(
    `fast-check [${label}]: ${details.numRuns} runs, ${details.numShrinks} shrinks, ${details.failed ? 'FAILED' : 'ok'}`,
  );
}

describe('Feature: restore-ai-insight-tab, Property: formatResponseTime', () => {
  it('returns em-dash for any decision when lastMessageAt is null', () => {
    assertWithLog(
      'null lastMessageAt',
      fc.property(ISO_DATE_ARB, (decisionCreatedAt) => {
        expect(formatResponseTime(decisionCreatedAt, null)).toBe('—');
      }),
    );
  });

  it('returns em-dash when decisionCreatedAt precedes lastMessageAt (negative diff)', () => {
    assertWithLog(
      'negative diff',
      fc.property(
        ISO_DATE_ARB,
        fc.integer({ min: 1, max: 1_000_000_000 }),
        (decisionCreatedAt, offsetMs) => {
          const decisionTime = new Date(decisionCreatedAt).getTime();
          const lastMessageAt = new Date(decisionTime + offsetMs).toISOString();
          expect(formatResponseTime(decisionCreatedAt, lastMessageAt)).toBe('—');
        },
      ),
    );
  });

  it('formats diffs in [0, 1000) ms as a whole-millisecond value with `ms` suffix', () => {
    assertWithLog(
      'ms branch',
      fc.property(
        ISO_DATE_ARB,
        fc.integer({ min: 0, max: 999 }),
        (lastMessageAt, diffMs) => {
          const lastTime = new Date(lastMessageAt).getTime();
          const decisionCreatedAt = new Date(lastTime + diffMs).toISOString();
          expect(formatResponseTime(decisionCreatedAt, lastMessageAt)).toBe(
            `${Math.round(diffMs)}ms`,
          );
        },
      ),
    );
  });

  it('formats diffs in [1000, 60_000) ms as seconds with one decimal and `s` suffix', () => {
    assertWithLog(
      's branch',
      fc.property(
        ISO_DATE_ARB,
        fc.integer({ min: 1000, max: 59_999 }),
        (lastMessageAt, diffMs) => {
          const lastTime = new Date(lastMessageAt).getTime();
          const decisionCreatedAt = new Date(lastTime + diffMs).toISOString();
          expect(formatResponseTime(decisionCreatedAt, lastMessageAt)).toBe(
            `${(diffMs / 1000).toFixed(1)}s`,
          );
        },
      ),
    );
  });

  it('formats diffs in [60_000, 3_600_000) ms as minutes with one decimal and `m` suffix', () => {
    assertWithLog(
      'm branch',
      fc.property(
        ISO_DATE_ARB,
        fc.integer({ min: 60_000, max: 3_599_999 }),
        (lastMessageAt, diffMs) => {
          const lastTime = new Date(lastMessageAt).getTime();
          const decisionCreatedAt = new Date(lastTime + diffMs).toISOString();
          expect(formatResponseTime(decisionCreatedAt, lastMessageAt)).toBe(
            `${(diffMs / 60_000).toFixed(1)}m`,
          );
        },
      ),
    );
  });

  it('formats diffs >= 3_600_000 ms as hours with one decimal and `h` suffix', () => {
    assertWithLog(
      'h branch',
      fc.property(
        ISO_DATE_ARB,
        fc.integer({ min: 3_600_000, max: 86_400_000 }),
        (lastMessageAt, diffMs) => {
          const lastTime = new Date(lastMessageAt).getTime();
          const decisionCreatedAt = new Date(lastTime + diffMs).toISOString();
          expect(formatResponseTime(decisionCreatedAt, lastMessageAt)).toBe(
            `${(diffMs / 3_600_000).toFixed(1)}h`,
          );
        },
      ),
    );
  });

  it('output is always em-dash or matches the canonical `<number><unit>` format', () => {
    const lastMessageArb = fc.option(ISO_DATE_ARB, { nil: null, freq: 4 });
    assertWithLog(
      'format invariant',
      fc.property(ISO_DATE_ARB, lastMessageArb, (decisionCreatedAt, lastMessageAt) => {
        const result = formatResponseTime(decisionCreatedAt, lastMessageAt);
        if (result === '—') return;
        expect(result).toMatch(/^\d+(?:\.\d+)?(?:ms|s|m|h)$/);
      }),
    );
  });

  it('monotonically non-decreasing in (unit rank, value) as the diff grows', () => {
    assertWithLog(
      'monotonicity',
      fc.property(
        ISO_DATE_ARB,
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (lastMessageAt, rawA, rawB) => {
          const lastTime = new Date(lastMessageAt).getTime();
          const [a, b] = rawA <= rawB ? [rawA, rawB] : [rawB, rawA];
          const decisionA = new Date(lastTime + a).toISOString();
          const decisionB = new Date(lastTime + b).toISOString();
          const ra = parseFormattedDuration(
            formatResponseTime(decisionA, lastMessageAt),
          );
          const rb = parseFormattedDuration(
            formatResponseTime(decisionB, lastMessageAt),
          );
          expect(ra).not.toBeNull();
          expect(rb).not.toBeNull();
          if (!ra || !rb) return;
          if (ra.unit === rb.unit) {
            expect(ra.value).toBeLessThanOrEqual(rb.value);
          } else {
            expect(UNIT_RANK[ra.unit]).toBeLessThan(UNIT_RANK[rb.unit]);
          }
        },
      ),
    );
  });
});
