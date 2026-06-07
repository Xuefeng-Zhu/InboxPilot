/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import { Button } from '../../components/ui/Button';

/**
 * Property 2: Button variant-size-state class correctness
 *
 * For any valid combination of button variant (primary, secondary, ghost, ai),
 * size (sm, md, lg), and disabled state (true/false), the Button component should
 * render with the correct set of CSS classes matching the specification — including
 * variant-specific colors, size-specific height/text, and disabled opacity/pointer-events
 * when applicable.
 *
 * Tag: Feature: stitch-ui-implementation, Property 2: Button variant-size-state class correctness
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

// --- Expected class maps from the specification ---

const variantClassMap: Record<string, string> = {
  primary: 'bg-primary text-white',
  secondary: 'bg-white border border-surface-border text-gray-700',
  ghost: 'text-gray-600',
  ai: 'bg-ai-50 border border-ai-200 text-ai-700',
};

const sizeClassMap: Record<string, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-base',
};

const baseClasses = 'inline-flex items-center justify-center rounded font-medium transition-colors';
const disabledClasses = 'opacity-50 pointer-events-none';

// --- Arbitraries ---

const variantArb = fc.constantFrom('primary', 'secondary', 'ghost', 'ai') as fc.Arbitrary<'primary' | 'secondary' | 'ghost' | 'ai'>;
const sizeArb = fc.constantFrom('sm', 'md', 'lg') as fc.Arbitrary<'sm' | 'md' | 'lg'>;
const disabledArb = fc.boolean();

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 2: Button variant-size-state class correctness', () => {
  it('renders base classes for any variant-size-disabled combination', () => {
    fc.assert(
      fc.property(
        variantArb,
        sizeArb,
        disabledArb,
        (variant, size, disabled) => {
          const { container } = render(
            <Button variant={variant} size={size} disabled={disabled}>
              Test
            </Button>,
          );
          const button = container.querySelector('button')!;
          const className = button.className;

          // Base classes must always be present
          for (const cls of baseClasses.split(' ')) {
            expect(className).toContain(cls);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders correct variant-specific classes for any variant-size-disabled combination', () => {
    fc.assert(
      fc.property(
        variantArb,
        sizeArb,
        disabledArb,
        (variant, size, disabled) => {
          const { container } = render(
            <Button variant={variant} size={size} disabled={disabled}>
              Test
            </Button>,
          );
          const button = container.querySelector('button')!;
          const className = button.className;

          // Variant-specific classes must be present
          const expectedVariantClasses = variantClassMap[variant];
          for (const cls of expectedVariantClasses.split(' ')) {
            expect(className).toContain(cls);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders correct size-specific classes for any variant-size-disabled combination', () => {
    fc.assert(
      fc.property(
        variantArb,
        sizeArb,
        disabledArb,
        (variant, size, disabled) => {
          const { container } = render(
            <Button variant={variant} size={size} disabled={disabled}>
              Test
            </Button>,
          );
          const button = container.querySelector('button')!;
          const className = button.className;

          // Size-specific classes must be present
          const expectedSizeClasses = sizeClassMap[size];
          for (const cls of expectedSizeClasses.split(' ')) {
            expect(className).toContain(cls);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders disabled classes when disabled, omits them when not disabled', () => {
    fc.assert(
      fc.property(
        variantArb,
        sizeArb,
        disabledArb,
        (variant, size, disabled) => {
          const { container } = render(
            <Button variant={variant} size={size} disabled={disabled}>
              Test
            </Button>,
          );
          const button = container.querySelector('button')!;
          const className = button.className;

          if (disabled) {
            // Disabled classes must be present
            for (const cls of disabledClasses.split(' ')) {
              expect(className).toContain(cls);
            }
          } else {
            // Disabled classes must NOT be present
            for (const cls of disabledClasses.split(' ')) {
              expect(className).not.toContain(cls);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
