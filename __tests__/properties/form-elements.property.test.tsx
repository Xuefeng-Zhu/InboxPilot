/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';

/**
 * Property 3: Form element base styling consistency
 *
 * For any form element type (Input, Select, Textarea) rendered without error state,
 * the component should include the shared M03 base styling classes (border,
 * rounded corners, focus outline) identically.
 *
 * Tag: Feature: stitch-ui-implementation, Property 3: Form element base styling consistency
 * Validates: Requirements 4.1, 4.3, 4.4
 */

const REQUIRED_BASE_CLASSES = [
  'border',
  'border-[var(--m03-line)]',
  'rounded-md',
  'text-[13px]',
  'focus:border-[var(--m03-fg)]',
  'focus:ring-1',
  'focus:ring-[var(--m03-fg)]',
  'focus:outline-none',
] as const;

type FormElementType = 'Input' | 'Select' | 'Textarea';

function renderFormElement(elementType: FormElementType): HTMLElement {
  switch (elementType) {
    case 'Input':
      return render(<Input />), screen.getByRole('textbox');
    case 'Select':
      render(<Select options={[{ value: 'a', label: 'A' }]} />);
      return screen.getByRole('combobox');
    case 'Textarea':
      return render(<Textarea />), screen.getByRole('textbox');
  }
}

describe('Feature: stitch-ui-implementation, Property 3: Form element base styling consistency', () => {
  it('all form element types include shared base styling classes when rendered without error state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<FormElementType>('Input', 'Select', 'Textarea'),
        (elementType) => {
          const element = renderFormElement(elementType);
          const className = element.getAttribute('class') || '';

          for (const requiredClass of REQUIRED_BASE_CLASSES) {
            expect(
              className.split(/\s+/).includes(requiredClass),
              `Expected ${elementType} to have class "${requiredClass}" but className was: "${className}"`,
            ).toBe(true);
          }

          document.body.innerHTML = '';
        },
      ),
      { numRuns: 100 },
    );
  });
});
