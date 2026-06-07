import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config';

/**
 * Property 1: Design token resolution completeness
 *
 * For any design token defined in the Stitch specification (color, fontSize,
 * spacing, or borderRadius), resolving that token key through the Tailwind
 * config theme should produce the exact value specified in the Stitch design system.
 *
 * Tag: Feature: stitch-ui-implementation, Property 1: Design token resolution completeness
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6
 */

const fullConfig = resolveConfig(tailwindConfig);

// --- Expected token definitions from the Stitch specification ---

const expectedColors: Array<{ path: string[]; value: string }> = [
  // Primary palette
  { path: ['primary', 'DEFAULT'], value: '#4F46E5' },
  { path: ['primary', '50'], value: '#EEF2FF' },
  { path: ['primary', '100'], value: '#E0E7FF' },
  { path: ['primary', '200'], value: '#C7D2FE' },
  { path: ['primary', '500'], value: '#4F46E5' },
  { path: ['primary', '600'], value: '#4338CA' },
  { path: ['primary', '700'], value: '#3730A3' },
  // AI palette
  { path: ['ai', 'DEFAULT'], value: '#8B5CF6' },
  { path: ['ai', '50'], value: '#F5F3FF' },
  { path: ['ai', '100'], value: '#EDE9FE' },
  { path: ['ai', '200'], value: '#DDD6FE' },
  { path: ['ai', '500'], value: '#8B5CF6' },
  { path: ['ai', '600'], value: '#7C3AED' },
  { path: ['ai', '700'], value: '#6D28D9' },
  // Status - open
  { path: ['status', 'open', 'light'], value: '#FFF7ED' },
  { path: ['status', 'open', 'DEFAULT'], value: '#F59E0B' },
  { path: ['status', 'open', 'dark'], value: '#C2410C' },
  // Status - escalated
  { path: ['status', 'escalated', 'light'], value: '#FEF2F2' },
  { path: ['status', 'escalated', 'DEFAULT'], value: '#EF4444' },
  { path: ['status', 'escalated', 'dark'], value: '#B91C1C' },
  // Status - resolved
  { path: ['status', 'resolved', 'light'], value: '#F0FDF4' },
  { path: ['status', 'resolved', 'DEFAULT'], value: '#10B981' },
  { path: ['status', 'resolved', 'dark'], value: '#15803D' },
  // Status - ai_draft
  { path: ['status', 'ai_draft', 'light'], value: '#F5F3FF' },
  { path: ['status', 'ai_draft', 'DEFAULT'], value: '#8B5CF6' },
  { path: ['status', 'ai_draft', 'dark'], value: '#6D28D9' },
  // Surface
  { path: ['surface', 'background'], value: '#F9FAFB' },
  { path: ['surface', 'DEFAULT'], value: '#FFFFFF' },
  { path: ['surface', 'container'], value: '#F0ECF9' },
  { path: ['surface', 'border'], value: '#E5E7EB' },
];

const expectedFontSize: Array<{
  key: string;
  value: string;
  lineHeight: string;
  fontWeight: string;
}> = [
  { key: 'display-sm', value: '1.5rem', lineHeight: '2rem', fontWeight: '600' },
  { key: 'headline-sm', value: '1.125rem', lineHeight: '1.75rem', fontWeight: '600' },
  { key: 'body-md', value: '0.875rem', lineHeight: '1.25rem', fontWeight: '400' },
  { key: 'body-sm', value: '0.8125rem', lineHeight: '1.25rem', fontWeight: '400' },
  { key: 'label-md', value: '0.75rem', lineHeight: '1rem', fontWeight: '600' },
  { key: 'label-sm', value: '0.6875rem', lineHeight: '1rem', fontWeight: '500' },
  { key: 'mono-sm', value: '0.75rem', lineHeight: '1rem', fontWeight: '400' },
];

const expectedSpacing: Array<{ key: string; value: string }> = [
  { key: 'container-margin', value: '1.5rem' },
  { key: 'section-padding', value: '1rem' },
  { key: 'element-gap', value: '0.75rem' },
  { key: 'tight-gap', value: '0.5rem' },
  { key: 'sidebar-w', value: '240px' },
  { key: 'inbox-list-w', value: '360px' },
];

const expectedBorderRadius: Array<{ key: string; value: string }> = [
  { key: 'sm', value: '0.125rem' },
  { key: 'DEFAULT', value: '0.25rem' },
  { key: 'md', value: '0.375rem' },
  { key: 'lg', value: '0.5rem' },
  { key: 'xl', value: '0.75rem' },
  { key: 'full', value: '9999px' },
];

// --- Helper to resolve a nested path on an object ---

function resolvePath(obj: Record<string, any>, path: string[]): any {
  return path.reduce((acc, key) => acc?.[key], obj);
}

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 1: Design token resolution completeness', () => {
  it('color tokens resolve to exact Stitch specification values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...expectedColors),
        (token) => {
          const resolved = resolvePath(
            fullConfig.theme.colors as Record<string, any>,
            token.path,
          );
          expect(resolved).toBe(token.value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fontSize tokens resolve to exact Stitch specification values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...expectedFontSize),
        (token) => {
          const fontSize = fullConfig.theme.fontSize as Record<string, any>;
          const entry = fontSize[token.key];
          // Tailwind resolveConfig produces [size, { lineHeight, fontWeight }]
          expect(entry).toBeDefined();
          const [size, meta] = Array.isArray(entry) ? entry : [entry, {}];
          expect(size).toBe(token.value);
          expect(meta.lineHeight).toBe(token.lineHeight);
          expect(meta.fontWeight).toBe(token.fontWeight);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('spacing tokens resolve to exact Stitch specification values', () => {
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

  it('borderRadius tokens resolve to exact Stitch specification values', () => {
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
});
