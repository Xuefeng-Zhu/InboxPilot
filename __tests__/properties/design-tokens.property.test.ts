import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config';

/**
 * Property 1: Design token resolution completeness
 *
 * For any design token defined in the M03 specification (spacing widths,
 * border-radius scale, font families), resolving that token through the
 * Tailwind config theme should produce the value configured for the
 * application. The M03 color palette is exposed via CSS custom properties
 * (see app/globals.css) rather than Tailwind colors, so it is not
 * validated here.
 *
 * Tag: Feature: stitch-ui-implementation, Property 1: Design token resolution completeness
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6
 */

const fullConfig = resolveConfig(tailwindConfig);

const expectedSpacing: Array<{ key: string; value: string }> = [
  { key: 'sidebar-w', value: '220px' },
  { key: 'inbox-list-w', value: '340px' },
  { key: 'right-panel-w', value: '320px' },
];

const expectedBorderRadius: Array<{ key: string; value: string }> = [
  { key: 'sm', value: '0.125rem' },
  { key: 'DEFAULT', value: '0.25rem' },
  { key: 'md', value: '0.375rem' },
  { key: 'lg', value: '0.5rem' },
  { key: 'xl', value: '0.75rem' },
  { key: 'full', value: '9999px' },
];

const expectedFontFamilies: Array<{ key: string; contains: string }> = [
  { key: 'sans', contains: '--font-inter' },
  { key: 'mono', contains: '--font-jetbrains-mono' },
];

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 1: Design token resolution completeness', () => {
  it('spacing tokens resolve to exact M03 specification values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...expectedSpacing),
        (token) => {
          const spacing = fullConfig.theme.spacing as Record<string, any>;
          expect(spacing[token.key]).toBe(token.value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('borderRadius tokens resolve to exact M03 specification values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...expectedBorderRadius),
        (token) => {
          const radii = fullConfig.theme.borderRadius as Record<string, any>;
          expect(radii[token.key]).toBe(token.value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('font families reference the CSS custom properties exposed by app/globals.css', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...expectedFontFamilies),
        (token) => {
          const fontFamily = fullConfig.theme.fontFamily as Record<string, any>;
          const entry = fontFamily[token.key];
          const joined = Array.isArray(entry) ? entry.join(',') : String(entry);
          expect(joined).toContain(token.contains);
        },
      ),
      { numRuns: 50 },
    );
  });
});
