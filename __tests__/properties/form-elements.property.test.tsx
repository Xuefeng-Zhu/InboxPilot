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
 * the component should include the shared base styling classes (border color,
 * border-radius, font-size, and focus ring styles) identically.
 *
 * Tag: Feature: stitch-ui-implementation, Property 3: Form element base styling consistency
 * Validates: Requirements 4.1, 4.3, 4.4
 */

const REQUIRED_BASE_CLASSES = [
  'border',
  'border-gray-300',
  'rounded',
  'text-body-md',
  'focus:border-primary',
  'focus:ring-2',
  'focus:ring-primary/20',
  'focus:ring-offset-1',
] as const;

type FormElementType = 'Input' | 'Select' | 'Textarea';

function renderFormElement(elementType: FormElementType): HTMLElement {
  const { unmount } = (() => {
    switch (elementType) {
      case 'Input':
        return render(<Input />);
      case 'Select':
        return render(
          <Select options={[{ value: 'a', label: 'A' }]} />
        );
      case 'Textarea':
        return render(<Textarea />);
    }
  })();

  const element = (() => {
    switch (elementType) {
      case 'Input':
        return screen.getByRole('textbox');
      case 'Select':
        return screen.getByRole('combobox');
      case 'Textarea':
        return screen.getByRole('textbox');
    }
  })();

  return element;
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
              `Expected ${elementType} to have class "${requiredClass}" but className was: "${className}"`
            ).toBe(true);
          }

          // Clean up rendered elements for next iteration
          document.body.innerHTML = '';
        },
      ),
      { numRuns: 100 },
    );
  });
});
