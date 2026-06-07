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
 * For any valid status value (open, escalated, resolved, ai_draft, connected, disconnected),
 * the StatusBadge component should render with the pill shape (rounded-full), compact sizing
 * (text-xs, px-2, py-0.5), and the correct background/text color combination as defined
 * in the specification.
 *
 * Tag: Feature: stitch-ui-implementation, Property 5: StatusBadge color mapping
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

// --- Expected color map from the specification ---

const colorMap: Record<string, string> = {
  open: 'bg-orange-50 text-orange-700',
  escalated: 'bg-red-50 text-red-700',
  resolved: 'bg-green-50 text-green-700',
  ai_draft: 'bg-purple-50 text-purple-700',
  connected: 'bg-green-50 text-green-700',
  disconnected: 'bg-red-50 text-red-700',
};

// Base classes that define pill shape and compact sizing
const pillClasses = ['rounded-full', 'px-2', 'py-0.5', 'text-xs', 'font-medium'];

// --- Arbitraries ---

const statusArb = fc.constantFrom(
  'open',
  'escalated',
  'resolved',
  'ai_draft',
  'connected',
  'disconnected',
) as fc.Arbitrary<'open' | 'escalated' | 'resolved' | 'ai_draft' | 'connected' | 'disconnected'>;

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 5: StatusBadge color mapping', () => {
  it('renders pill shape classes (rounded-full, px-2, py-0.5, text-xs, font-medium) for any valid status', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const { container } = render(<StatusBadge status={status} />);
        const badge = container.firstElementChild!;
        const className = badge.className;

        for (const cls of pillClasses) {
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
