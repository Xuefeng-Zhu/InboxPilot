/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import { MetricCard } from '../../components/ui/MetricCard';

/**
 * Property 9: MetricCard trend color mapping
 *
 * For any MetricCard with a trend indicator, a positive ("up") trend should render
 * with the success color (green-600) and a negative ("down") trend should render
 * with the error color (red-600).
 *
 * Tag: Feature: stitch-ui-implementation, Property 9: MetricCard trend color mapping
 * Validates: Requirements 10.3
 */

// --- Arbitraries ---

const directionArb = fc.constantFrom('up', 'down') as fc.Arbitrary<'up' | 'down'>;
const trendValueArb = fc.string({ minLength: 1 });
const labelArb = fc.string({ minLength: 1 });
const metricValueArb = fc.oneof(fc.string({ minLength: 1 }), fc.integer());

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 9: MetricCard trend color mapping', () => {
  it('renders text-green-600 when trend direction is up', () => {
    fc.assert(
      fc.property(
        trendValueArb,
        labelArb,
        metricValueArb,
        (trendValue, label, value) => {
          const { container } = render(
            <MetricCard
              label={label}
              value={value}
              trend={{ direction: 'up', value: trendValue }}
            />,
          );

          const trendElement = container.querySelector('.text-green-600');
          expect(trendElement).not.toBeNull();
          expect(trendElement!.className).toContain('text-green-600');
          expect(trendElement!.className).not.toContain('text-red-600');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders text-red-600 when trend direction is down', () => {
    fc.assert(
      fc.property(
        trendValueArb,
        labelArb,
        metricValueArb,
        (trendValue, label, value) => {
          const { container } = render(
            <MetricCard
              label={label}
              value={value}
              trend={{ direction: 'down', value: trendValue }}
            />,
          );

          const trendElement = container.querySelector('.text-red-600');
          expect(trendElement).not.toBeNull();
          expect(trendElement!.className).toContain('text-red-600');
          expect(trendElement!.className).not.toContain('text-green-600');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders the correct color class based on direction for any random direction', () => {
    fc.assert(
      fc.property(
        directionArb,
        trendValueArb,
        labelArb,
        metricValueArb,
        (direction, trendValue, label, value) => {
          const { container } = render(
            <MetricCard
              label={label}
              value={value}
              trend={{ direction, value: trendValue }}
            />,
          );

          const expectedClass = direction === 'up' ? 'text-green-600' : 'text-red-600';
          const unexpectedClass = direction === 'up' ? 'text-red-600' : 'text-green-600';

          const trendElement = container.querySelector(`.${expectedClass}`);
          expect(trendElement).not.toBeNull();
          expect(trendElement!.className).toContain(expectedClass);
          expect(trendElement!.className).not.toContain(unexpectedClass);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders trend value text and arrow indicator', () => {
    fc.assert(
      fc.property(
        directionArb,
        trendValueArb,
        labelArb,
        metricValueArb,
        (direction, trendValue, label, value) => {
          const { container } = render(
            <MetricCard
              label={label}
              value={value}
              trend={{ direction, value: trendValue }}
            />,
          );

          const expectedClass = direction === 'up' ? 'text-green-600' : 'text-red-600';
          const trendElement = container.querySelector(`.${expectedClass}`);
          expect(trendElement).not.toBeNull();

          const textContent = trendElement!.textContent || '';
          // Should contain the trend value
          expect(textContent).toContain(trendValue);
          // Should contain the arrow indicator
          const expectedArrow = direction === 'up' ? '↑' : '↓';
          expect(textContent).toContain(expectedArrow);
        },
      ),
      { numRuns: 100 },
    );
  });
});
