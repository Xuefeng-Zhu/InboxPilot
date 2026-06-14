/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import { StatusBadge } from '../../components/ui/StatusBadge';

/**
 * Property 5: StatusBadge color mapping
 *
 * For any valid status value (open, pending, escalated, resolved, ai_draft,
 * connected, disconnected), the StatusBadge component should render with the
 * M03 square mono shape (rounded-[3px], px-1.5, py-px, font-mono, text-[9px],
 * uppercase) and the correct background/text color combination.
 *
 * Tag: Feature: stitch-ui-implementation, Property 5: StatusBadge color mapping
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

// --- Expected color map (M03 monochrome tokens) ---

const colorMap: Record<string, string> = {
  open: 'bg-white text-[var(--m03-fg-2)] border border-[var(--m03-line)]',
  pending: 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]',
  escalated: 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]',
  resolved: 'bg-[var(--m03-green-fill)] text-[var(--m03-green)] border border-[var(--m03-green-line)]',
  ai_draft: 'bg-[var(--m03-orange-fill)] text-[var(--m03-orange)] border border-[var(--m03-orange-line)]',
  connected: 'bg-[var(--m03-green-fill)] text-[var(--m03-green)] border border-[var(--m03-green-line)]',
  disconnected: 'bg-[var(--m03-red-fill)] text-[var(--m03-red)] border border-[var(--m03-red-line)]',
};

// M03 square-mono shape classes
const shapeClasses = ['rounded-[3px]', 'px-1.5', 'py-px', 'font-mono', 'uppercase', 'text-[9px]'];

// --- Arbitraries ---

const statusArb = fc.constantFrom(
  'open',
  'pending',
  'escalated',
  'resolved',
  'ai_draft',
  'connected',
  'disconnected',
) as fc.Arbitrary<
  'open' | 'pending' | 'escalated' | 'resolved' | 'ai_draft' | 'connected' | 'disconnected'
>;

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 5: StatusBadge color mapping', () => {
  it('renders M03 square-mono shape classes (rounded-[3px], px-1.5, py-px, font-mono, text-[9px], uppercase) for any valid status', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const { container } = render(<StatusBadge status={status} />);
        const badge = container.firstElementChild!;
        const className = badge.className;

        for (const cls of shapeClasses) {
          expect(className).toContain(cls);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('renders the correct background/text color combination for any valid status', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const { container } = render(<StatusBadge status={status} />);
        const badge = container.firstElementChild!;
        const className = badge.className;

        const expectedColors = colorMap[status];
        for (const cls of expectedColors.split(' ')) {
          expect(className).toContain(cls);
        }
      }),
      { numRuns: 100 },
    );
  });
});
